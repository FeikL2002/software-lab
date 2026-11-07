// The payment/auth handlers use D1's small prepared-statement interface. Keep
// their conditional financial SQL intact while executing it through Postgres.
const INTERNAL = Symbol("Harbor prepared query");
const INTEGER_OIDS = new Set([20, 1700]); // int8 and SUM(bigint)'s numeric result
const RETRYABLE = new Set(["40001", "40P01"]);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Translate SQLite bind markers, preserving quoted text and SQL comments. */
export function parameterize(sql) {
  if (typeof sql !== "string" || !sql.trim()) throw new TypeError("SQL is required.");
  let output = "", parameterCount = 0, cursor = 0;
  while (cursor < sql.length) {
    const char = sql[cursor];
    if (char === "'" || char === '"') {
      const quote = char;
      const escapedString = quote === "'" && /(?:^|[^A-Za-z0-9_$])[eE]$/.test(sql.slice(0, cursor));
      output += char; cursor++;
      while (cursor < sql.length) {
        const next = sql[cursor++]; output += next;
        if (escapedString && next === "\\" && cursor < sql.length) { output += sql[cursor++]; continue; }
        if (next === quote) {
          if (sql[cursor] === quote) { output += sql[cursor++]; continue; }
          break;
        }
      }
      continue;
    }
    if (char === "$" && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(cursor))) {
      const delimiter = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(cursor))[0];
      const end = sql.indexOf(delimiter, cursor + delimiter.length);
      if (end === -1) throw new TypeError("Unclosed SQL dollar quote.");
      output += sql.slice(cursor, end + delimiter.length); cursor = end + delimiter.length; continue;
    }
    if (sql.startsWith("--", cursor)) {
      const end = sql.indexOf("\n", cursor);
      if (end === -1) { output += sql.slice(cursor); break; }
      output += sql.slice(cursor, end + 1); cursor = end + 1; continue;
    }
    if (sql.startsWith("/*", cursor)) {
      let end = cursor + 2, depth = 1;
      while (end < sql.length && depth > 0) {
        if (sql.startsWith("/*", end)) { depth++; end += 2; }
        else if (sql.startsWith("*/", end)) { depth--; end += 2; }
        else end++;
      }
      if (depth) throw new TypeError("Unclosed SQL comment.");
      output += sql.slice(cursor, end); cursor = end; continue;
    }
    output += char === "?" ? `$${++parameterCount}` : char; cursor++;
  }
  return { text: output, parameterCount };
}

function safeInteger(value) {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new RangeError("A database integer exceeds the safe numeric range.");
    return value;
  }
  if (typeof value !== "bigint" && (typeof value !== "string" || !/^-?\d+$/.test(value))) throw new RangeError("A database integer is not exact.");
  const integer = BigInt(value);
  if (integer > MAX_SAFE || integer < -MAX_SAFE) throw new RangeError("A database integer exceeds the safe numeric range.");
  return Number(integer);
}
function normalize(result) {
  const integerFields = (result.fields || []).filter((field) => INTEGER_OIDS.has(field.dataTypeID)).map((field) => field.name);
  const rows = (result.rows || []).map((row) => {
    const copy = { ...row };
    for (const name of integerFields) copy[name] = safeInteger(copy[name]);
    return copy;
  });
  const changes = safeInteger(result.rowCount ?? 0);
  return { success: true, results: rows, meta: { changes } };
}
function storageError(error) {
  // The existing auth handler recognizes D1's uniqueness error. Do not retain
  // Postgres DETAIL in the replacement message: it can contain user data.
  if (error?.code === "23505") {
    const replacement = new Error("UNIQUE constraint failed");
    replacement.code = error.code; replacement.constraint = error.constraint;
    return replacement;
  }
  return error;
}
function boundValues(values, count) {
  if (values.length !== count) throw new TypeError("The SQL bind count does not match its placeholders.");
  return values.map((value) => {
    if (value === undefined || (typeof value === "number" && !Number.isSafeInteger(value))) throw new TypeError("SQL values must contain exact integers or explicit values.");
    if (typeof value === "bigint") { safeInteger(value); return value.toString(); }
    return value;
  });
}

/** pool is the native pg-compatible pool from @netlify/database. */
export function createDatabase(pool, { maxAttempts = 4, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") throw new TypeError("A Postgres connection pool is required.");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) throw new TypeError("Use between one and eight transaction attempts.");
  const owner = {};
  async function transaction(operation) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const client = await pool.connect();
      let releaseError;
      try {
        // SERIALIZABLE protects aggregate-balance predicates against concurrent
        // inserts into the payout ledger. Retrying reruns the original SQL.
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch (rollbackError) { releaseError = rollbackError; }
        if (!RETRYABLE.has(error?.code) || attempt === maxAttempts) throw storageError(error);
      } finally { client.release(releaseError); }
      await sleep(Math.min(80, 5 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 5));
    }
    throw new Error("The database transaction could not complete.");
  }
  function statement(sql, values) {
    const converted = parameterize(sql);
    const args = values === undefined ? [] : boundValues(values, converted.parameterCount);
    const query = { text: converted.text, values: args };
    // SELECT is the only read statement in Harbor; any other statement,
    // including INSERT ... RETURNING and writable WITH, uses a transaction.
    const readOnly = /^\s*SELECT\b/i.test(sql) && !/\bFOR\s+(?:UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b/i.test(sql);
    async function execute(target) {
      boundValues(args, converted.parameterCount);
      return normalize(await target.query(query.text, query.values));
    }
    async function read() {
      try { return readOnly ? await execute(pool) : await transaction(execute); }
      catch (error) { throw storageError(error); }
    }
    return {
      [INTERNAL]: { owner, execute },
      bind(...parameters) { return statement(sql, parameters); },
      async first(column) { const result = await read(); const row = result.results[0] ?? null; return column === undefined ? row : row?.[column] ?? null; },
      async all() { return read(); },
      async run() { return transaction(execute); },
    };
  }
  return {
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      if (!Array.isArray(statements) || statements.some((entry) => entry?.[INTERNAL]?.owner !== owner)) throw new TypeError("Batch statements must belong to this database.");
      return transaction(async (client) => {
        const results = [];
        for (const entry of statements) results.push(await entry[INTERNAL].execute(client));
        return results;
      });
    },
  };
}

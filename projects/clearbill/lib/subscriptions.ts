/**
 * Local, deterministic email parsing and subscription discovery.
 * Nothing in this module sends email content, renders email HTML, or follows links.
 * A receipt is evidence of billing, not a provider account-status lookup.
 */
export type EmailMessage = {
  id: string;
  from: string;
  to?: string;
  subject: string;
  date: string;
  body: string;
  account?: string;
};

export type Subscription = {
  id: string;
  name: string;
  domain: string;
  category: string;
  amount: number | null;
  currency: string;
  interval: "month" | "year" | "week" | "unknown";
  status: "likely_active" | "trial" | "cancelled" | "needs_review";
  confidence: "high" | "medium" | "low";
  lastSeen: string;
  nextBilling: string | null;
  evidence: EmailMessage[];
  billingVia?: "apple" | "google" | "direct" | "unknown";
};

const MAX_INPUT_LENGTH = 25 * 1024 * 1024;
const MAX_MESSAGES = 10000;

function hash(text: string): string {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    pound: "£", euro: "€", yen: "¥", ndash: "–", mdash: "—",
  };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (original, entity: string) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? original;
    const number = entity[1].toLowerCase() === "x"
      ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number) : "";
  });
}

/** Deliberately produces plain text. Its result must never be inserted as HTML. */
function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<(script|style|svg|head|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:br\s*\/|br|\/p|\/div|\/tr|\/li|\/h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " "))
    .replace(/[\t ]+/g, " ").replace(/\n[\t ]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function bytesToText(bytes: Uint8Array, charset = "utf-8"): string {
  try { return new TextDecoder(charset).decode(bytes); }
  catch { return new TextDecoder("utf-8").decode(bytes); }
}

function decodeBase64(value: string, charset = "utf-8"): string {
  try {
    const raw = atob(value.replace(/\s/g, ""));
    return bytesToText(Uint8Array.from(raw, c => c.charCodeAt(0)), charset);
  } catch { return value; }
}

function decodeQuotedPrintable(value: string, charset = "utf-8"): string {
  const unfolded = value.replace(/=\r?\n/g, "");
  // Preserve literal Unicode when the part was not actually byte encoded.
  if (!/=[0-9a-f]{2}/i.test(unfolded)) return unfolded;
  const bytes: number[] = [];
  for (let i = 0; i < unfolded.length; i++) {
    if (unfolded[i] === "=" && /^[0-9a-f]{2}$/i.test(unfolded.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(unfolded.slice(i + 1, i + 3), 16)); i += 2;
    } else if (unfolded.charCodeAt(i) <= 255) bytes.push(unfolded.charCodeAt(i));
    else bytes.push(...new TextEncoder().encode(unfolded[i]));
  }
  return bytesToText(Uint8Array.from(bytes), charset);
}

function decodeHeader(value: string): string {
  return value.replace(/\?=\s+(?==\?)/g, "?=")
    .replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, charset: string, type: string, content: string) =>
      type.toLowerCase() === "b" ? decodeBase64(content, charset)
        : decodeQuotedPrintable(content.replace(/_/g, " "), charset));
}

function splitHeaders(raw: string): { headers: Record<string, string>; body: string } {
  const separator = /\r?\n\r?\n/.exec(raw);
  let head: string;
  let body: string;
  const standardHeaders = separator && raw.slice(0, separator.index).split(/\r?\n/)
    .every(line => /^[\w-]+:/.test(line) || /^[\t ]/.test(line));
  if (separator && standardHeaders) {
    head = raw.slice(0, separator.index);
    body = raw.slice(separator.index + separator[0].length);
  } else {
    // A copied AOL or webmail message often omits the RFC blank line. Accept a
    // leading block of familiar headers without consuming "Total:" body lines.
    const lines = raw.split(/\r?\n/);
    let end = 0;
    const commonHeader = /^(?:from|to|subject|date|cc|bcc|sender|reply-to|message-id|mime-version|content-[\w-]+|received|return-path|delivered-to|x-[\w-]+):/i;
    while (end < lines.length && (commonHeader.test(lines[end]) || (end > 0 && /^[\t ]+/.test(lines[end])))) end++;
    if (!end) return { headers: {}, body: raw };
    head = lines.slice(0, end).join("\n");
    body = lines.slice(end).join("\n");
  }
  head = head.replace(/\r?\n[\t ]+/g, " ");
  if (!/^(?:from|subject|date|to|mime-version|content-type|message-id|received):/im.test(head))
    return { headers: {}, body: raw };
  const headers: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    const match = /^([\w-]+):\s*(.*)$/.exec(line);
    if (match && !headers[match[1].toLowerCase()]) headers[match[1].toLowerCase()] = match[2].trim();
  }
  return { headers, body };
}

function mimeBody(raw: string, depth = 0): string {
  if (depth > 12) return "";
  const { headers, body } = splitHeaders(raw);
  const type = headers["content-type"] ?? "text/plain";
  if (/attachment/i.test(headers["content-disposition"] ?? "")) return "";
  if (/^multipart\//i.test(type)) {
    const boundary = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(type);
    if (!boundary) return "";
    const marker = `--${boundary[1] ?? boundary[2]}`;
    const parts = body.split(marker).slice(1).filter(part => !part.startsWith("--"))
      .map(part => part.replace(/^\r?\n/, "").replace(/\r?\n$/, ""));
    if (/^multipart\/alternative/i.test(type)) {
      const plain = parts.find(part => /^content-type:\s*text\/plain\b/im.test(part)
        && !/^content-disposition:\s*attachment/im.test(part));
      if (plain) return mimeBody(plain, depth + 1);
    }
    return parts.map(part => mimeBody(part, depth + 1)).filter(Boolean).join("\n");
  }
  if (!/^text\/(?:plain|html)\b/i.test(type)) return "";
  const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(type)?.[1] ?? "utf-8";
  const encoding = headers["content-transfer-encoding"]?.toLowerCase();
  const decoded = encoding === "base64" ? decodeBase64(body, charset)
    : encoding === "quoted-printable" ? decodeQuotedPrintable(body, charset) : body;
  return /^text\/html\b/i.test(type) ? htmlToText(decoded) : decoded.trim();
}

function normalizedDate(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function parseRfcEmail(raw: string, filename: string, index: number): EmailMessage {
  const { headers, body } = splitHeaders(raw);
  const from = decodeHeader(headers.from ?? "Unknown sender");
  const subject = decodeHeader(headers.subject ?? filename.replace(/\.(eml|mbox|txt)$/i, ""));
  const date = normalizedDate(headers.date);
  const text = Object.keys(headers).length ? mimeBody(raw) : body.trim();
  return {
    id: headers["message-id"]?.replace(/[<>]/g, "") || `import-${hash(`${from}|${subject}|${date}|${text}`)}-${index}`,
    from, to: headers.to ? decodeHeader(headers.to) : undefined, subject, date,
    body: text.replace(/^>From /gm, "From "),
  };
}

function jsonMessage(value: unknown, index: number): EmailMessage | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const text = typeof source.body === "string" ? source.body
    : typeof source.text === "string" ? source.text : typeof source.textBody === "string" ? source.textBody : "";
  const html = typeof source.html === "string" ? source.html : "";
  if (!text && !html && typeof source.subject !== "string") return null;
  const get = (key: string) => typeof source[key] === "string" ? source[key] as string : "";
  const from = get("from") || "Unknown sender";
  const subject = get("subject") || "Imported email";
  const date = normalizedDate(source.date ?? source.receivedAt);
  const body = text || htmlToText(html);
  return { id: get("id") || `json-${hash(`${from}|${subject}|${date}|${body}`)}-${index}`,
    from, to: get("to") || undefined, subject, date, body, account: get("account") || undefined };
}

/** Accepts RFC 822 .eml, Unix .mbox, pasted text, or a JSON array of email objects. */
export function parseEmailFiles(text: string, filename: string): EmailMessage[] {
  if (text.length > MAX_INPUT_LENGTH) throw new Error("This file is too large. Import files smaller than 25 MB.");
  const input = text.replace(/^\uFEFF/, "").trim();
  if (!input) return [];
  if (/\.json$/i.test(filename) || /^[\[{]/.test(input)) {
    let json: unknown;
    try { json = JSON.parse(input); }
    catch { throw new Error("This JSON file could not be read. Use an array of email objects with from, subject, date, and body fields."); }
    const records = Array.isArray(json) ? json : json && typeof json === "object"
      && Array.isArray((json as Record<string, unknown>).messages) ? (json as { messages: unknown[] }).messages : null;
    if (!records) throw new Error("Use a JSON array of email objects, or an object containing a messages array.");
    if (records.length > MAX_MESSAGES) throw new Error("Import up to 10,000 emails at a time.");
    const messages = records.map(jsonMessage).filter((message): message is EmailMessage => Boolean(message));
    if (!messages.length && records.length) throw new Error("No readable emails were found in this JSON file.");
    return messages;
  }
  // A separator must be followed by an RFC header so a body sentence is not split.
  const chunks = input.split(/^From [^\r\n]+\r?\n(?=[\w-]+:\s)/m).filter(chunk => chunk.trim());
  if (chunks.length > MAX_MESSAGES) throw new Error("Import up to 10,000 emails at a time.");
  return chunks.map((chunk, index) => parseRfcEmail(chunk, filename, index));
}

type Merchant = { name: string; domain: string; category: string; aliases?: string[] };
const MERCHANTS: Merchant[] = [
  { name: "Netflix", domain: "netflix.com", category: "Entertainment" },
  { name: "Spotify", domain: "spotify.com", category: "Music" },
  { name: "YouTube Premium", domain: "youtube.com", category: "Entertainment", aliases: ["youtube premium"] },
  { name: "Disney+", domain: "disneyplus.com", category: "Entertainment", aliases: ["disney+", "disney plus"] },
  { name: "Hulu", domain: "hulu.com", category: "Entertainment" },
  { name: "Max", domain: "max.com", category: "Entertainment", aliases: ["hbo max"] },
  { name: "Amazon Prime", domain: "amazon.com", category: "Shopping", aliases: ["amazon prime", "prime membership"] },
  { name: "Adobe", domain: "adobe.com", category: "Software", aliases: ["creative cloud"] },
  { name: "Dropbox", domain: "dropbox.com", category: "Storage" },
  { name: "Microsoft 365", domain: "microsoft.com", category: "Software", aliases: ["microsoft 365", "office 365"] },
  { name: "Google One", domain: "one.google.com", category: "Storage", aliases: ["google one"] },
  { name: "iCloud+", domain: "icloud.com", category: "Storage", aliases: ["icloud+", "icloud storage"] },
  { name: "Apple Music", domain: "music.apple.com", category: "Music", aliases: ["apple music"] },
  { name: "Apple TV+", domain: "tv.apple.com", category: "Entertainment", aliases: ["apple tv+"] },
  { name: "Apple One", domain: "apple.com", category: "Software", aliases: ["apple one"] },
  { name: "Audible", domain: "audible.com", category: "Books & learning" },
  { name: "Kindle Unlimited", domain: "amazon.com", category: "Books & learning", aliases: ["kindle unlimited"] },
  { name: "Duolingo", domain: "duolingo.com", category: "Books & learning" },
  { name: "Calm", domain: "calm.com", category: "Health & wellness" },
  { name: "Headspace", domain: "headspace.com", category: "Health & wellness" },
  { name: "Notion", domain: "notion.so", category: "Software" },
  { name: "Canva", domain: "canva.com", category: "Software" },
  { name: "ChatGPT", domain: "openai.com", category: "Software", aliases: ["chatgpt", "openai"] },
  { name: "Grammarly", domain: "grammarly.com", category: "Software" },
  { name: "The New York Times", domain: "nytimes.com", category: "News" },
];

function senderDomain(from: string): string {
  return /@([a-z0-9.-]+\.[a-z]{2,})/i.exec(from)?.[1].toLowerCase() ?? "";
}

function emailAddress(value?: string): string {
  return value?.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0].toLowerCase() ?? value?.trim().toLowerCase() ?? "";
}

function baseDomain(domain: string): string {
  const pieces = domain.split(".");
  const count = /\.(?:co|com|org|net)\.[a-z]{2}$/i.test(domain) ? 3 : 2;
  return pieces.slice(-count).join(".");
}

function containsAlias(text: string, alias: string): boolean {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(text);
}

function identifyMerchant(message: EmailMessage): Merchant & { billingVia: Subscription["billingVia"]; known: boolean } {
  const domain = senderDomain(message.from);
  const text = `${message.subject}\n${message.body}`;
  const apple = /(^|\.)apple\.com$/.test(domain);
  const google = /(^|\.)(?:google\.com|googlemail\.com)$/.test(domain);
  const billingVia = apple ? "apple" : google ? "google" : domain ? "direct" : "unknown";
  // A named product overrides an umbrella vendor (e.g. Kindle vs Prime).
  const aliasMatch = MERCHANTS.find(merchant => (merchant.aliases ?? [merchant.name.toLowerCase()])
    .some(alias => containsAlias(message.subject, alias)))
    ?? ((apple || google) ? MERCHANTS.find(merchant => (merchant.aliases ?? [merchant.name.toLowerCase()])
      .some(alias => containsAlias(text, alias))) : undefined);
  const domainMatch = MERCHANTS.find(merchant =>
    !["amazon.com", "apple.com", "microsoft.com"].includes(merchant.domain)
    && (domain === merchant.domain || domain.endsWith(`.${merchant.domain}`)));
  const known = aliasMatch ?? domainMatch;
  if (known) return { ...known, billingVia, known: true };
  const receiptProduct = (apple || google) ? /^(?:subscription|app|product|service)\s*:\s*([^\n]{2,70})/im.exec(message.body)?.[1].trim() : undefined;
  const display = message.from.replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
  const domainName = baseDomain(domain).split(".")[0] ?? "";
  const name = receiptProduct || (display && !display.includes("@") && !/^(?:no.?reply|billing|receipts?|support)$/i.test(display)
    ? display.replace(/\s+(?:billing|receipts?|team|support|payments?)$/i, "")
    : domainName ? domainName[0].toUpperCase() + domainName.slice(1) : "Unidentified subscription");
  return { name: name.slice(0, 80), domain: baseDomain(domain), category: "Other", billingVia, known: false };
}

type Price = { amount: number; currency: string; index: number; length: number; score: number };

function parseNumber(text: string): number {
  const cleaned = text.replace(/\s/g, "");
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(cleaned)) return Number(cleaned.replace(/\./g, "").replace(",", "."));
  if (/^\d+,\d{1,2}$/.test(cleaned)) return Number(cleaned.replace(",", "."));
  return Number(cleaned.replace(/,/g, ""));
}

function findPrice(text: string): Price | null {
  const currencyNames: Record<string, string> = { "$": "USD", "US$": "USD", "C$": "CAD", "CA$": "CAD", "A$": "AUD", "AU$": "AUD", "£": "GBP", "€": "EUR", "¥": "JPY", "₹": "INR" };
  const expression = /\b(USD|EUR|GBP|CAD|AUD|NZD|JPY|INR|CHF)\s*([$£€¥₹])?\s*(\d{1,7}(?:[., ]\d{3})*(?:[.,]\d{1,2})?)|((?:US|CA|AU|C|A)?\$|[£€¥₹])\s*(\d{1,7}(?:[., ]\d{3})*(?:[.,]\d{1,2})?)|(\d{1,7}(?:[., ]\d{3})*(?:[.,]\d{1,2})?)\s*(USD|EUR|GBP|CAD|AUD|NZD|JPY|INR|CHF|€|£)(?![a-z])/gi;
  const candidates: Price[] = [];
  for (const match of text.matchAll(expression)) {
    const amount = parseNumber(match[3] ?? match[5] ?? match[6]);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) continue;
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 55), index).toLowerCase();
    const after = text.slice(index + match[0].length, index + match[0].length + 55).toLowerCase();
    const explicitFollowingCode = match[4] ? /^\s*(USD|EUR|GBP|CAD|AUD|NZD|JPY|INR|CHF)\b/i.exec(after)?.[1].toUpperCase() : undefined;
    // A bare dollar sign is interpreted as USD; explicit currency codes take priority.
    const currency = match[1]?.toUpperCase() ?? explicitFollowingCode ?? currencyNames[match[4]] ?? currencyNames[match[7]] ?? match[7]?.toUpperCase() ?? "unknown";
    let score = 0;
    if (/(?:total(?: paid| charged)?|amount (?:paid|charged|due)|charged|payment of|paid|renewal price)\s*:?\s*$/.test(before)) score += 12;
    if (/(?:subscription|membership|plan|payment|billed|billing|renewal|recurring)[^\n]{0,30}$/.test(before)) score += 5;
    if (/^\s*(?:\/\s*(?:mo(?:nth)?|yr|year|week)|per (?:month|year|week)|(?:each|every|a) (?:month|year|week)|monthly|annually)/.test(after)) score += 8;
    if (/(?:tax|discount|saving|credit|refund|subtotal|was|instead of)[^\n]{0,20}$/.test(before)) score -= 10;
    if (/(?:save|off|discount)\b/.test(after.slice(0, 15))) score -= 8;
    candidates.push({ amount, currency, index, length: match[0].length, score });
  }
  return candidates.sort((a, b) => b.score - a.score || a.index - b.index)[0] ?? null;
}

function findInterval(text: string, price: Price | null): Subscription["interval"] {
  const period = (value: string): Subscription["interval"] => {
    if (/\b(?:annual(?:ly)?|yearly|per year|every year|each year|a year|12 months)\b|\/\s*(?:yr|year)\b/i.test(value)) return "year";
    if (/\b(?:monthly|per month|every month|each month|a month)\b|\/\s*(?:mo|month)\b/i.test(value)) return "month";
    if (/\b(?:weekly|per week|every week|each week|a week)\b|\/\s*(?:wk|week)\b/i.test(value)) return "week";
    return "unknown";
  };
  if (price) {
    const nearby = text.slice(Math.max(0, price.index - 28), price.index + price.length + 35);
    const interval = period(nearby);
    if (interval !== "unknown") return interval;
  }
  return period(text);
}

function nextDate(text: string): string | null {
  const labels = /(?:next (?:billing|payment|charge|renewal)(?: date)?|renewal date|renews?(?: on)?|trial ends?(?: on)?)\s*(?::|is|on)?\s*((?:20\d{2}-\d{1,2}-\d{1,2})|(?:[A-Z][a-z]+\s+\d{1,2},?\s+20\d{2})|(?:\d{1,2}\s+[A-Z][a-z]+\s+20\d{2})|(?:\d{1,2}\/\d{1,2}\/20\d{2}))/gi;
  for (const match of text.matchAll(labels)) {
    const date = normalizedDate(match[1]);
    if (date) return date;
  }
  return null;
}

type Evidence = {
  message: EmailMessage; merchant: ReturnType<typeof identifyMerchant>; price: Price | null;
  interval: Subscription["interval"]; event: Subscription["status"]; next: string | null; strong: boolean;
};

function classify(message: EmailMessage): Evidence | null {
  const text = `${message.subject}\n${message.body}`;
  const cancellation = /\b(?:subscription|membership|plan|account)(?:\s+(?:for|to)\s+[a-z0-9+ -]{1,35})?(?:\s+(?:has been|is|was|will be))?\s+(?:successfully\s+)?cancell?ed\b|\bcancell?ation (?:confirm(?:ed|ation)|complete|successful)\b|\b(?:subscription|membership)\b[^\n.!?]{0,60}\b(?:will not|won't|does not) renew\b|\bauto[ -]?renew(?:al)?\b[^\n.!?]{0,35}\b(?:turned off|disabled)\b/i.test(text);
  const trial = /\byour (?:[\w+ -]{0,35})?(?:free )?trial (?:has (?:started|begun)|starts?|started|begins?|ends?|expires?|is active)\b|\b(?:free )?trial (?:started|activated|confirmed)\b/i.test(text);
  const failed = /\b(?:payment (?:failed|declined|overdue)|unable to (?:charge|process)|couldn['’]t (?:charge|process)|past due|billing problem)\b/i.test(text);
  const recurrence = /\b(?:subscription|membership|recurring|auto[ -]?renew(?:al)?|renew(?:al|ed|ing)|monthly|annually|annual|yearly|weekly|next (?:billing|payment|charge))\b|\/\s*(?:mo|month|yr|year|week)\b/i.test(text);
  const transaction = /\b(?:receipt|invoice|charged|billed|payment (?:received|confirmation|successful|of|for)|successfully paid|renewed|renewal (?:confirmation|notice)|subscription (?:confirmation|activated|confirmed|started)|membership (?:confirmation|activated|confirmed|started))\b/i.test(text);
  const accountSpecific = /\byour\b[^\n.!?]{0,60}\b(?:subscription|membership|plan)\b[^\n.!?]{0,60}\b(?:renews|renewed|active|will renew|next payment)\b/i.test(text);
  const promotional = /\b(?:special offer|exclusive offer|save \d|\d+% off|come back|rejoin|start your (?:free )?trial|try (?:it )?free|subscribe (?:today|now))\b/i.test(message.subject);
  if (!(cancellation || trial || (recurrence && (transaction || accountSpecific || failed)))) return null;
  if (promotional && !cancellation && !/\b(?:charged|payment received|successfully paid|renewed)\b/i.test(message.subject)) return null;
  // A one-time shop receipt plus a generic subscription offer/footer is not evidence.
  if (/\b(?:order|shipment|delivery)\b/i.test(message.subject)
    && !/\b(?:subscription|membership|recurring|renewal)\b/i.test(message.subject)
    && !/\b(?:your (?:subscription|membership) (?:has |was |is )?(?:renewed|active)|subscription (?:total|charge|payment)|recurring payment)\b/i.test(message.body)) return null;
  const price = findPrice(text);
  return { message, merchant: identifyMerchant(message), price, interval: findInterval(text, price),
    event: cancellation ? "cancelled" : failed ? "needs_review" : trial ? "trial" : "likely_active",
    next: cancellation ? null : nextDate(text), strong: cancellation || transaction || trial };
}

/**
 * Conservative signals from imported messages only. Results are candidates to verify.
 * Separate mailbox accounts and explicit currencies stay separate; no FX conversion.
 */
export function detectSubscriptions(messages: EmailMessage[], now = new Date()): Subscription[] {
  const deduped = new Set<string>();
  const groups = new Map<string, Evidence[]>();
  for (const message of messages) {
    const account = emailAddress(message.account || message.to);
    const fingerprint = hash(`${account}|${message.from.toLowerCase()}|${message.subject.trim()}|${message.date}|${message.body.replace(/\s+/g, " ").trim()}`);
    if (deduped.has(fingerprint)) continue;
    deduped.add(fingerprint);
    const evidence = classify(message);
    if (!evidence) continue;
    const merchantKey = `${evidence.merchant.domain}|${evidence.merchant.name.toLowerCase()}|${account}`;
    // Cancellation messages often omit a currency. Assign them to the existing merchant
    // group below; they must not become a second zero-cost subscription.
    const group = groups.get(merchantKey) ?? [];
    group.push(evidence); groups.set(merchantKey, group);
  }
  const results: Subscription[] = [];
  for (const [merchantKey, allEvidence] of groups) {
    const currencies = [...new Set(allEvidence.map(item => item.price?.currency).filter((currency): currency is string => Boolean(currency)))];
    for (const currency of currencies.length ? currencies : ["unknown"]) {
      const evidence = allEvidence.filter(item => !item.price || item.price.currency === currency)
        .sort((a, b) => (Date.parse(b.message.date) || 0) - (Date.parse(a.message.date) || 0));
      const latest = evidence[0];
      const priced = evidence.find(item => item.price);
      const interval = evidence.find(item => item.interval !== "unknown")?.interval ?? "unknown";
      const next = latest.next;
      let status = latest.event;
      const timestamp = Date.parse(latest.message.date);
      const ageDays = (now.getTime() - timestamp) / 86400000;
      const staleAfter = interval === "year" ? 550 : interval === "month" ? 100 : interval === "week" ? 35 : 100;
      const expiredTrial = status === "trial" && next && Date.parse(next) < now.getTime();
      if (status !== "cancelled" && (!Number.isFinite(timestamp) || ageDays > staleAfter || ageDays < -2 || expiredTrial)) status = "needs_review";
      // A move, a plan change, or two real accounts can produce different currencies.
      // Keep the evidence visible, but do not count both as current recurring costs.
      if (status !== "cancelled" && currencies.length > 1) status = "needs_review";
      const confidence: Subscription["confidence"] = !Number.isFinite(timestamp) || latest.merchant.name === "Unidentified subscription"
        ? "low" : latest.event === "cancelled" || (latest.strong && evidence.length >= 2 && status !== "needs_review")
          ? "high" : "medium";
      const billingMethods = new Set(evidence.map(item => item.merchant.billingVia));
      results.push({
        id: `sub-${hash(`${merchantKey}|${currency}`)}`,
        name: latest.merchant.name, domain: latest.merchant.domain, category: latest.merchant.category,
        amount: priced?.price?.amount ?? null, currency, interval, status, confidence,
        lastSeen: latest.message.date, nextBilling: status === "cancelled" ? null : next,
        evidence: evidence.map(item => item.message), billingVia: billingMethods.size === 1 ? latest.merchant.billingVia : "unknown",
      });
    }
  }
  return results.sort((a, b) => (Date.parse(b.lastSeen) || 0) - (Date.parse(a.lastSeen) || 0) || a.name.localeCompare(b.name));
}

/** Estimated monthly equivalent in the subscription's original currency. */
export function monthlyCost(subscription: Subscription): number | null {
  if (subscription.status === "cancelled" || subscription.status === "trial" || subscription.status === "needs_review"
    || subscription.amount === null || subscription.interval === "unknown") return null;
  return subscription.interval === "year" ? subscription.amount / 12
    : subscription.interval === "week" ? subscription.amount * 52 / 12 : subscription.amount;
}

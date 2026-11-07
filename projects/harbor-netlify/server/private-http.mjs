import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { getSessionUser, handleAuthRequest, normalizeEmail } from "./auth.mjs";
import { handleRequest } from "./harbor.mjs";
import { renderPage, unavailablePage } from "./pages.mjs";

const PRIVATE_ERROR = { code: "private_access_required", error: "Harbor is private. Use an approved email and the invitation code provided to you." };
const HEADERS = Object.freeze({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'", "Permissions-Policy": "camera=(), microphone=(), geolocation=()" });
const json = (body, status = 200) => Response.json(body, { status });

export function privatePolicy(env) {
  if (typeof env.HARBOR_ALLOWED_EMAILS !== "string" || !env.HARBOR_ALLOWED_EMAILS.trim()) return null;
  const entries = env.HARBOR_ALLOWED_EMAILS.split(",").map((entry) => normalizeEmail(entry));
  if (!entries.length || entries.some((entry) => !entry)) return null;
  const allowed = new Set(entries);
  const inviteHash = typeof env.HARBOR_INVITE_CODE_HASH === "string" ? env.HARBOR_INVITE_CODE_HASH.toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/.test(inviteHash)) return null;
  return { isEmailAllowed: (email) => allowed.has(normalizeEmail(email)), inviteHash };
}

function authorizedCode(value, expected) {
  if (typeof value !== "string" || value.length < 16 || value.length > 256) return false;
  const actual = createHash("sha256").update(value).digest();
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}

async function boundedBody(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return { error: json({ code: "json_required", error: "Send this request as application/json." }, 415) };
  const reader = request.body?.getReader(); if (!reader) return { error: json({ code: "invalid_request", error: "A request body is required." }, 400) };
  const chunks = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8192) { await reader.cancel(); return { error: json({ code: "request_too_large", error: "The request body is too large." }, 413) }; } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); return { body }; }
  catch { return { error: json({ code: "invalid_request", error: "The request body must be valid UTF-8 JSON." }, 400) }; }
}

async function ownerMapping(db, env, email) {
  const configuredEmail = normalizeEmail(env.HARBOR_OWNER_EMAIL);
  const id = env.HARBOR_OWNER_MERCHANT_ID;
  if (!configuredEmail || configuredEmail !== email || typeof id !== "string" || !id) return null;
  const merchant = await db.prepare("SELECT owner_user_id,contact_email FROM merchants WHERE id=?").bind(id).first();
  if (!merchant || normalizeEmail(merchant.contact_email) !== configuredEmail) return null;
  return { userId: merchant.owner_user_id, email: configuredEmail };
}

function withHeaders(response, request) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(HEADERS)) headers.set(key, value);
  if (new URL(request.url).protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers });
}

/** All account, dashboard, and checkout requests pass through this private gate. */
export async function handlePrivateRequest(request, env, deps = {}) {
  const url = new URL(request.url); const path = url.pathname.replace(/\/$/, "") || "/";
  let response;
  try {
    const policy = privatePolicy(env);
    if (!policy || !env.DB) response = path.startsWith("/api/") ? json({ code: "private_access_unavailable", error: "Private account access is temporarily unavailable." }, 503) : new Response(unavailablePage(), { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
    else {
      const authDeps = { now: deps.now, allowDevCookie: deps.allowDevCookie === true, clientIp: () => deps.clientIp || "unavailable", isEmailAllowed: policy.isEmailAllowed, url: url.href };
      const user = await getSessionUser(env.DB, request.headers.get("cookie"), authDeps);
      if (path === "/api/auth/context" && request.method === "GET") response = json({ legacyAccount: null });
      else if ((path === "/api/auth/signup" || path === "/api/auth/login") && request.method === "POST") {
        if (request.headers.get("origin") !== url.origin) response = json({ code: "invalid_origin", error: "This operation must be requested from the app's own origin." }, 403);
        else {
          const parsed = await boundedBody(request);
          if (parsed.error) response = parsed.error;
          else {
            const body = parsed.body; const email = normalizeEmail(body?.email); const signup = path.endsWith("/signup");
            if (!body || typeof body !== "object" || Array.isArray(body)) response = json({ code: "invalid_request", error: "The request fields do not match this operation." }, 400);
            else if (!policy.isEmailAllowed(email) || (signup && !authorizedCode(body.inviteCode, policy.inviteHash))) response = json(PRIVATE_ERROR, 403);
            else {
              const coreBody = { ...body }; if (signup) delete coreBody.inviteCode;
              const headers = new Headers(request.headers); headers.delete("content-length");
              const coreRequest = new Request(request.url, { method: "POST", headers, body: JSON.stringify(coreBody) });
              response = await handleAuthRequest(coreRequest, env, { ...authDeps, getLegacyIdentity: signup ? () => ownerMapping(env.DB, env, email) : undefined });
            }
          }
        }
      }
      else if (path.startsWith("/api/auth/")) response = await handleAuthRequest(request, env, authDeps);
      else if (path.startsWith("/api/webhooks/")) response = json({ code: "provider_disabled", error: "Payment provider callbacks are disabled in this private preview." }, 503);
      else if (path.startsWith("/api/")) response = user ? await handleRequest(request, env, { ...deps, getUser: async () => user }) : json({ code: "auth_missing", error: "Sign in to access this private Harbor workspace." }, 401);
      else if (!["GET", "HEAD"].includes(request.method)) response = json({ code: "method_not_allowed", error: "This operation is not supported." }, 405);
      else if (["/login", "/signup", "/logout"].includes(path)) response = new Response(renderPage(path.slice(1)), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      else if (path === "/" || /^\/pay\/[a-z0-9]+$/.test(path)) {
        if (!user) response = new Response(null, { status: 303, headers: { Location: `/login?return_to=${encodeURIComponent(path + url.search)}` } });
        else response = new Response(renderPage(path === "/" ? "dashboard" : "checkout"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      else response = new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  } catch {
    // Do not log cookies, submitted credentials, invitation codes, or DB rows.
    console.error("Harbor private request failed.");
    response = json({ code: "service_unavailable", error: "Harbor is temporarily unavailable. Please try again." }, 503);
  }
  return withHeaders(response, request);
}

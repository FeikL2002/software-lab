/** Server-only mailbox access. Never import this module from a client component. */
export type MailProvider = "google" | "microsoft";
export type MailMessage = { id: string; from: string; to?: string; subject: string; date: string; body: string; account?: string };
type Env = Record<string, string | undefined>;
type MailConfig = { origin: string; key: string; clientId: string; clientSecret: string; provider: MailProvider; secure: boolean };
type Session = { provider: MailProvider; accessToken: string; email: string; expiresAt: number };
type OAuthState = { provider: MailProvider; state: string; verifier: string; email: string; expiresAt: number };
const PROVIDERS: MailProvider[] = ["google", "microsoft"];
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const MICROSOFT_SCOPE = "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read";
const NO_CACHE = { "Cache-Control": "no-store, private", Pragma: "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const COOKIE_CHUNK_SIZE = 3200;
const COOKIE_CHUNKS = 4;
const encoder = new TextEncoder();
class MailError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}

export function isMailProvider(value: unknown): value is MailProvider { return value === "google" || value === "microsoft"; }
export function normalizedOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}
export function isSameOrigin(request: Request, origin: string): boolean {
  return request.headers.get("Origin") === origin && !["cross-site", "none"].includes(request.headers.get("Sec-Fetch-Site") ?? "");
}
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64url(value: string): Uint8Array {
  if (!/^[\w-]+$/.test(value)) throw new Error("Invalid encoded value");
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
function validKey(value: string | undefined): value is string {
  try { return !!value && fromBase64url(value).length === 32; } catch { return false; }
}
export async function sealMailValue(value: unknown, secret: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", fromBase64url(secret) as BufferSource, "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(context) }, key, encoder.encode(JSON.stringify(value)));
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}
export async function openMailValue<T>(value: string, secret: string, context: string): Promise<T | null> {
  try {
    const parts = value.split(".");
    if (parts.length !== 3 || parts[0] !== "v1" || value.length > COOKIE_CHUNKS * COOKIE_CHUNK_SIZE) return null;
    const key = await crypto.subtle.importKey("raw", fromBase64url(secret) as BufferSource, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64url(parts[1]) as BufferSource, additionalData: encoder.encode(context) }, key, fromBase64url(parts[2]) as BufferSource);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch { return null; }
}
async function environment(): Promise<Env> {
  let bindings: Env = {};
  try { const workerRuntime = await import("cloudflare:workers"); bindings = workerRuntime.env as unknown as Env; } catch { /* Node development/test runtime. */ }
  return { ...(typeof process !== "undefined" ? process.env : {}), ...bindings };
}
function configFor(provider: MailProvider, env: Env): MailConfig | null {
  const origin = normalizedOrigin(env.APP_ORIGIN);
  const prefix = provider === "google" ? "GOOGLE" : "MICROSOFT";
  const clientId = env[`${prefix}_CLIENT_ID`];
  const clientSecret = env[`${prefix}_CLIENT_SECRET`];
  if (!origin || !validKey(env.MAIL_SESSION_KEY) || !clientId || !clientSecret) return null;
  if (env.NODE_ENV === "production" && !origin.startsWith("https://")) return null;
  return { origin, key: env.MAIL_SESSION_KEY, clientId, clientSecret, provider, secure: origin.startsWith("https://") };
}
function requiredConfig(provider: MailProvider, env: Env): MailConfig {
  const config = configFor(provider, env);
  if (!config) throw new MailError("NOT_CONFIGURED", "Secure inbox connection is not configured yet. You can still import email files privately on this device.", 503);
  return config;
}
function cookieName(config: MailConfig, kind: "session" | "oauth"): string { return `${config.secure ? "__Secure-" : ""}unsub_${config.provider}_${kind}`; }
function cookies(request: Request): Map<string, string> {
  return new Map((request.headers.get("Cookie") ?? "").split(";").map((part) => {
    const at = part.indexOf("="); return at < 0 ? [part.trim(), ""] : [part.slice(0, at).trim(), part.slice(at + 1)];
  }));
}
function readCookie(request: Request, config: MailConfig, kind: "session" | "oauth"): string | null {
  const jar = cookies(request); const name = cookieName(config, kind);
  const first = jar.get(name); if (!first) return null;
  const marker = first.match(/^chunks:(\d)$/);
  if (!marker) return first;
  const count = Number(marker[1]); if (count < 1 || count > COOKIE_CHUNKS) return null;
  let result = "";
  for (let i = 0; i < count; i++) { const chunk = jar.get(`${name}.${i}`); if (!chunk) return null; result += chunk; }
  return result;
}
function appendCookie(headers: Headers, config: MailConfig, name: string, value: string, seconds: number): void {
  headers.append("Set-Cookie", `${name}=${value}; Path=/api/mail; Max-Age=${Math.max(0, seconds)}; HttpOnly; SameSite=Lax${config.secure ? "; Secure" : ""}`);
}
function clearCookie(headers: Headers, config: MailConfig, kind: "session" | "oauth"): void {
  const name = cookieName(config, kind);
  appendCookie(headers, config, name, "", 0);
  for (let i = 0; i < COOKIE_CHUNKS; i++) appendCookie(headers, config, `${name}.${i}`, "", 0);
}
async function writeCookie(headers: Headers, config: MailConfig, kind: "session" | "oauth", value: unknown, seconds: number): Promise<void> {
  const name = cookieName(config, kind);
  const sealed = await sealMailValue(value, config.key, `${config.origin}:${name}`);
  if (sealed.length > COOKIE_CHUNKS * COOKIE_CHUNK_SIZE) throw new MailError("CONNECTION_FAILED", "This provider returned credentials that are too large. Please try again.", 502);
  clearCookie(headers, config, kind);
  if (sealed.length <= COOKIE_CHUNK_SIZE) { appendCookie(headers, config, name, sealed, seconds); return; }
  const count = Math.ceil(sealed.length / COOKIE_CHUNK_SIZE);
  appendCookie(headers, config, name, `chunks:${count}`, seconds);
  for (let i = 0; i < count; i++) appendCookie(headers, config, `${name}.${i}`, sealed.slice(i * COOKIE_CHUNK_SIZE, (i + 1) * COOKIE_CHUNK_SIZE), seconds);
}
async function readSession(request: Request, config: MailConfig): Promise<Session | null> {
  const cookie = readCookie(request, config, "session"); if (!cookie) return null;
  const session = await openMailValue<Session>(cookie, config.key, `${config.origin}:${cookieName(config, "session")}`);
  if (!session || session.provider !== config.provider || typeof session.accessToken !== "string" || typeof session.email !== "string" || typeof session.expiresAt !== "number" || session.expiresAt <= Date.now()) return null;
  return session;
}
export function validOAuthState(value: unknown, provider: MailProvider, state: string | null, now = Date.now()): value is OAuthState {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<OAuthState>;
  return item.provider === provider && typeof item.state === "string" && item.state.length >= 32 && item.state === state && typeof item.verifier === "string" && item.verifier.length >= 43 && typeof item.expiresAt === "number" && item.expiresAt > now && item.expiresAt <= now + 10 * 60_000 && typeof item.email === "string";
}
function json(data: unknown, status = 200, headers = new Headers()): Response {
  Object.entries(NO_CACHE).forEach(([key, value]) => headers.set(key, value));
  return Response.json(data, { status, headers });
}
function errorResponse(error: unknown, headers = new Headers()): Response {
  if (error instanceof MailError) return json({ error: error.message, code: error.code }, error.status, headers);
  return json({ error: "The email provider could not complete this request. Please reconnect and try again.", code: "PROVIDER_ERROR" }, 502, headers);
}
async function payload(request: Request, env: Env): Promise<Record<string, unknown>> {
  const origin = normalizedOrigin(env.APP_ORIGIN);
  if (!origin) throw new MailError("NOT_CONFIGURED", "Secure inbox connection is not configured yet. Email file import is available on this device.", 503);
  if (!isSameOrigin(request, origin)) throw new MailError("ORIGIN_REJECTED", "Please open this app directly and try again.", 403);
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) throw new MailError("INVALID_REQUEST", "A JSON request is required.", 415);
  const text = await boundedText(request, 4096, new MailError("INVALID_REQUEST", "Request is too large.", 413));
  try { const parsed: unknown = JSON.parse(text); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); return parsed as Record<string, unknown>; }
  catch { throw new MailError("INVALID_REQUEST", "Please check the request and try again."); }
}
async function boundedText(source: { headers: Headers; body: ReadableStream<Uint8Array> | null }, limit: number, error: MailError): Promise<string> {
  if (Number(source.headers.get("Content-Length")) > limit) {
    await source.body?.cancel();
    throw error;
  }
  if (!source.body) return "";
  const reader = source.body.getReader();
  const decoder = new TextDecoder();
  const pieces: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw error; }
      pieces.push(decoder.decode(chunk.value, { stream: true }));
    }
    pieces.push(decoder.decode());
    return pieces.join("");
  } finally { reader.releaseLock(); }
}
async function providerFetch<T>(url: string | URL, token?: string, init: RequestInit = {}, maxBytes = 2 * 1024 * 1024): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    if (response.status === 401) throw new MailError("RECONNECT_REQUIRED", "Your secure email connection expired. Please reconnect your account.", 401);
    if (response.status === 429) throw new MailError("RATE_LIMITED", "Your email provider is busy. Please wait a minute, then try again.", 429);
    if (response.status === 403) throw new MailError("PERMISSION_REQUIRED", "Your email provider did not allow read-only inbox access. Please reconnect and approve that permission.", 403);
    throw new MailError("PROVIDER_ERROR", "The email provider could not complete the search. Please try again later.", 502);
  }
  const text = await boundedText(response, maxBytes, new MailError("PROVIDER_RESPONSE_TOO_LARGE", "These email messages are too large to scan safely. Import smaller receipt files instead.", 502));
  try { return JSON.parse(text) as T; }
  catch { throw new MailError("PROVIDER_ERROR", "The email provider returned an unreadable response. Please try again.", 502); }
}
export async function mailStatus(request: Request): Promise<Response> {
  try {
    const env = await environment();
    const providers = await Promise.all(PROVIDERS.map(async (id) => {
      const config = configFor(id, env); const session = config ? await readSession(request, config) : null;
      return { id, configured: !!config, connected: !!session, ...(session ? { email: session.email, expiresAt: new Date(session.expiresAt).toISOString() } : {}) };
    }));
    return json({ providers });
  } catch (error) { return errorResponse(error); }
}
export async function mailConnect(request: Request): Promise<Response> {
  try {
    const env = await environment(); const data = await payload(request, env);
    if (!isMailProvider(data.provider)) throw new MailError("INVALID_PROVIDER", "Choose Google or Microsoft to connect an inbox.");
    const config = requiredConfig(data.provider, env);
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new MailError("INVALID_EMAIL", "Please enter a valid email address.");
    const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
    const url = new URL(data.provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    const params: Record<string, string> = { client_id: config.clientId, redirect_uri: `${config.origin}/api/mail/callback/${data.provider}`, response_type: "code", scope: data.provider === "google" ? GOOGLE_SCOPE : MICROSOFT_SCOPE, state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" };
    if (data.provider === "google") params.access_type = "online";
    if (data.provider === "microsoft") params.response_mode = "query";
    if (email) params.login_hint = email;
    Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value));
    const headers = new Headers();
    await writeCookie(headers, config, "oauth", { provider: data.provider, state, verifier, email, expiresAt: Date.now() + 600_000 } satisfies OAuthState, 600);
    return json({ url: url.href }, 200, headers);
  } catch (error) { return errorResponse(error); }
}
export async function mailCallback(request: Request, provider: string): Promise<Response> {
  const headers = new Headers(NO_CACHE);
  let config: MailConfig | null = null;
  try {
    if (!isMailProvider(provider)) throw new MailError("INVALID_PROVIDER", "Unsupported email provider.");
    config = requiredConfig(provider, await environment());
    clearCookie(headers, config, "oauth"); // Consume the browser's pending state on every callback attempt.
    const url = new URL(request.url);
    const stateCookie = readCookie(request, config, "oauth");
    const pending = stateCookie ? await openMailValue<OAuthState>(stateCookie, config.key, `${config.origin}:${cookieName(config, "oauth")}`) : null;
    if (!validOAuthState(pending, provider, url.searchParams.get("state"))) throw new MailError("STATE_EXPIRED", "This sign-in request expired. Please start the connection again.", 400);
    if (url.searchParams.has("error")) throw new MailError("CONSENT_DECLINED", "Inbox connection was not approved. You can connect again whenever you are ready.", 400);
    const code = url.searchParams.get("code");
    if (!code || code.length > 4096) throw new MailError("INVALID_CALLBACK", "No valid sign-in code was received.");
    const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code", code, code_verifier: pending.verifier, redirect_uri: `${config.origin}/api/mail/callback/${provider}` });
    if (provider === "microsoft") body.set("scope", MICROSOFT_SCOPE);
    const tokens = await providerFetch<{ access_token?: string; expires_in?: number; scope?: string }>(provider === "google" ? "https://oauth2.googleapis.com/token" : "https://login.microsoftonline.com/common/oauth2/v2.0/token", undefined, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!tokens.access_token || typeof tokens.expires_in !== "number" || tokens.expires_in <= 0) throw new MailError("INVALID_TOKEN", "The provider did not return a valid short-lived connection.", 502);
    const granted = (tokens.scope ?? "").toLowerCase().split(/\s+/);
    if (provider === "google" && !granted.includes(GOOGLE_SCOPE.toLowerCase())) throw new MailError("PERMISSION_REQUIRED", "Read-only Gmail access was not approved. Please connect again and approve it.", 403);
    if (provider === "microsoft" && !granted.some((scope) => scope === "mail.read" || scope === "https://graph.microsoft.com/mail.read")) throw new MailError("PERMISSION_REQUIRED", "Read-only Microsoft mail access was not approved. Please connect again and approve it.", 403);
    let email: string;
    if (provider === "google") {
      const profile = await providerFetch<{ emailAddress?: string }>("https://gmail.googleapis.com/gmail/v1/users/me/profile", tokens.access_token);
      email = profile.emailAddress ?? "";
    } else {
      const profile = await providerFetch<{ mail?: string; userPrincipalName?: string }>("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", tokens.access_token);
      email = profile.mail || profile.userPrincipalName || "";
    }
    if (!email || !email.includes("@")) throw new MailError("PROFILE_UNAVAILABLE", "The provider did not identify the connected mailbox.", 502);
    // Provider-owned profile is authoritative; a typed address is only a sign-in hint.
    const seconds = Math.max(1, Math.floor(Math.min(tokens.expires_in, 3600)) - 30);
    await writeCookie(headers, config, "session", { provider, accessToken: tokens.access_token, email, expiresAt: Date.now() + seconds * 1000 } satisfies Session, seconds);
    headers.set("Location", `${config.origin}/?mail_connected=${provider}`);
    return new Response(null, { status: 303, headers });
  } catch (error) {
    if (config) {
      const code = error instanceof MailError ? error.code.toLowerCase() : "connection_failed";
      headers.set("Location", `${config.origin}/?mail_error=${encodeURIComponent(code)}`);
      return new Response(null, { status: 303, headers });
    }
    return errorResponse(error, headers);
  }
}

export function plainEmailHtml(value: string): string {
  // Text only; HTML is never rendered and no remote resources are loaded.
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\s*(?:br|\/p|\/div|\/tr|\/li)\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39|#x27);/gi, (entity) => ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&#x27;": "'" }[entity.toLowerCase()] ?? " "))
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, num: string) => { const code = num[0].toLowerCase() === "x" ? parseInt(num.slice(1), 16) : parseInt(num, 10); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " "; })
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n\s*\n/g, "\n").trim().slice(0, 40_000);
}
type GmailPart = { mimeType?: string; filename?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: { name: string; value: string }[] };
function gmailText(part: GmailPart, depth = 0): string {
  if (depth > 12 || part.filename) return "";
  const pieces: string[] = [];
  if (part.body?.data && ["text/plain", "text/html"].includes(part.mimeType ?? "")) {
    try {
      const text = new TextDecoder().decode(fromBase64url(part.body.data));
      pieces.push(part.mimeType === "text/html" ? plainEmailHtml(text) : text);
    } catch { /* Malformed or unsupported body is skipped; do not request attachments. */ }
  }
  const children = part.parts ?? [];
  const plain = children.filter((child) => child.mimeType === "text/plain" && !child.filename);
  for (const child of plain.length ? plain : children) pieces.push(gmailText(child, depth + 1));
  return pieces.join("\n").slice(0, 40_000);
}
async function scanGoogle(session: Session, since: Date): Promise<{ messages: MailMessage[]; hasMore: boolean }> {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", `after:${Math.floor(since.getTime() / 1000)} {subscription subscriptions membership renewal invoice receipt recurring billed payment trial}`);
  url.searchParams.set("maxResults", "150"); url.searchParams.set("includeSpamTrash", "false");
  const list = await providerFetch<{ messages?: { id: string }[]; nextPageToken?: string }>(url, session.accessToken);
  const ids = (list.messages ?? []).slice(0, 150);
  const messages: MailMessage[] = [];
  // Bounded parallel reads, with no attachment downloads or mailbox mutations.
  for (let i = 0; i < ids.length; i += 8) {
    const group = await Promise.all(ids.slice(i, i + 8).map(async ({ id }) => {
      const message = await providerFetch<{ id: string; internalDate?: string; snippet?: string; payload?: GmailPart }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, session.accessToken);
      const headers = message.payload?.headers ?? [];
      const header = (name: string) => headers.find((item) => item.name.toLowerCase() === name)?.value ?? "";
      const received = Number(message.internalDate);
      const date = Number.isFinite(received) && received > 0 ? new Date(received).toISOString() : header("date");
      return { id: message.id, from: header("from"), to: header("to"), subject: header("subject"), date, body: message.payload ? gmailText(message.payload) || message.snippet || "" : message.snippet || "", account: session.email };
    }));
    messages.push(...group);
  }
  return { messages, hasMore: !!list.nextPageToken };
}
async function scanMicrosoft(session: Session, since: Date): Promise<{ messages: MailMessage[]; hasMore: boolean }> {
  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.searchParams.set("$search", `"received>=${since.toISOString().slice(0, 10)} AND (subscription OR membership OR renewal OR invoice OR receipt OR recurring OR billed OR payment OR trial)"`);
  url.searchParams.set("$top", "150");
  url.searchParams.set("$select", "id,from,toRecipients,subject,receivedDateTime,body,bodyPreview");
  type Address = { emailAddress?: { name?: string; address?: string } };
  type Message = { id: string; from?: Address; toRecipients?: Address[]; subject?: string; receivedDateTime?: string; body?: { contentType?: string; content?: string }; bodyPreview?: string };
  const list = await providerFetch<{ value?: Message[]; "@odata.nextLink"?: string }>(url, session.accessToken, {}, 8 * 1024 * 1024);
  const address = (value: Address | undefined) => value?.emailAddress?.name ? `${value.emailAddress.name} <${value.emailAddress.address ?? ""}>` : value?.emailAddress?.address ?? "";
  const raw = list.value ?? [];
  const messages = raw.slice(0, 150).filter((item) => Date.parse(item.receivedDateTime ?? "") >= since.getTime()).map((item) => ({ id: item.id, from: address(item.from), to: item.toRecipients?.map(address).join(", "), subject: item.subject ?? "", date: item.receivedDateTime ?? "", body: item.body?.contentType?.toLowerCase() === "html" ? plainEmailHtml(item.body.content ?? "") : (item.body?.content || item.bodyPreview || "").slice(0, 40_000), account: session.email }));
  return { messages, hasMore: !!list["@odata.nextLink"] || raw.length >= 150 };
}
export async function mailScan(request: Request): Promise<Response> {
  const headers = new Headers();
  let config: MailConfig | null = null;
  try {
    const env = await environment(); const data = await payload(request, env);
    if (!isMailProvider(data.provider)) throw new MailError("INVALID_PROVIDER", "Choose a connected inbox first.");
    if (data.months !== 12 && data.months !== 24) throw new MailError("INVALID_LOOKBACK", "Choose a search period of 12 or 24 months.");
    config = requiredConfig(data.provider, env);
    const session = await readSession(request, config);
    if (!session) throw new MailError("RECONNECT_REQUIRED", "Connect your email account before searching its inbox.", 401);
    const since = new Date(); since.setUTCMonth(since.getUTCMonth() - data.months);
    const result = data.provider === "google" ? await scanGoogle(session, since) : await scanMicrosoft(session, since);
    return json({ ...result, scanned: result.messages.length, account: session.email, provider: data.provider, lookbackMonths: data.months }, 200, headers);
  } catch (error) {
    if (config && error instanceof MailError && error.code === "RECONNECT_REQUIRED") clearCookie(headers, config, "session");
    return errorResponse(error, headers);
  }
}
export async function mailDisconnect(request: Request): Promise<Response> {
  const headers = new Headers();
  try {
    const env = await environment(); const data = await payload(request, env);
    if (!isMailProvider(data.provider)) throw new MailError("INVALID_PROVIDER", "Choose an inbox to disconnect.");
    const config = requiredConfig(data.provider, env);
    const session = await readSession(request, config);
    clearCookie(headers, config, "session"); clearCookie(headers, config, "oauth");
    let revoked = false;
    if (session && data.provider === "google") {
      try {
        const response = await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", body: new URLSearchParams({ token: session.accessToken }), headers: { "Content-Type": "application/x-www-form-urlencoded" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
        revoked = response.ok;
      } catch { /* Local credentials are removed even if provider revocation is unavailable. */ }
    }
    return json({ disconnected: true, provider: data.provider, revoked }, 200, headers);
  } catch (error) { return errorResponse(error, headers); }
}

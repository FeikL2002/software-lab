import assert from "node:assert/strict";
import { after, test } from "node:test";
// @ts-expect-error Node's built-in TypeScript runner needs the source extension.
import { base64url, sealMailValue, openMailValue, normalizedOrigin, isSameOrigin, validOAuthState, plainEmailHtml, mailStatus, mailConnect, mailCallback, mailScan, mailDisconnect } from "../lib/mail-auth.ts";

const key = base64url(crypto.getRandomValues(new Uint8Array(32)));
const origin = "https://clearbill.example";
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
after(() => { process.env = originalEnv; globalThis.fetch = originalFetch; });

test("encrypted session values authenticate content, key, and origin", async () => {
  const value = { accessToken: "private-provider-token", email: "dad@example.com" };
  const first = await sealMailValue(value, key, `${origin}:session`);
  const second = await sealMailValue(value, key, `${origin}:session`);
  assert.notEqual(first, second, "each encryption uses a unique random IV");
  assert.equal(first.includes(value.accessToken), false);
  assert.deepEqual(await openMailValue(first, key, `${origin}:session`), value);
  assert.equal(await openMailValue(first, key, "https://attacker.example:session"), null);
  assert.equal(await openMailValue(first, base64url(crypto.getRandomValues(new Uint8Array(32))), `${origin}:session`), null);
  const pieces = first.split("."); pieces[2] = `${pieces[2][0] === "A" ? "B" : "A"}${pieces[2].slice(1)}`;
  assert.equal(await openMailValue(pieces.join("."), key, `${origin}:session`), null);
});

test("configured origin and POST validation reject cross-site and ambiguous origins", () => {
  assert.equal(normalizedOrigin("https://clearbill.example"), origin);
  assert.equal(normalizedOrigin("http://localhost:3000"), "http://localhost:3000");
  for (const value of ["http://clearbill.example", "https://user:pass@clearbill.example", "https://clearbill.example/path", "https://clearbill.example?x=1", "//clearbill.example"]) assert.equal(normalizedOrigin(value), null);
  assert.equal(isSameOrigin(new Request(origin, { headers: { Origin: origin, "Sec-Fetch-Site": "same-origin" } }), origin), true);
  assert.equal(isSameOrigin(new Request(origin, { headers: { Origin: "https://attacker.example" } }), origin), false);
  assert.equal(isSameOrigin(new Request(origin), origin), false);
  assert.equal(isSameOrigin(new Request(origin, { headers: { Origin: origin, "Sec-Fetch-Site": "cross-site" } }), origin), false);
});

test("OAuth state enforces provider, verifier, exact state and ten-minute expiry", () => {
  const now = Date.now(); const state = "s".repeat(43);
  const valid = { provider: "google", state, verifier: "v".repeat(64), email: "dad@example.com", expiresAt: now + 600_000 };
  assert.equal(validOAuthState(valid, "google", state, now), true);
  assert.equal(validOAuthState(valid, "microsoft", state, now), false);
  assert.equal(validOAuthState(valid, "google", "incorrect", now), false);
  assert.equal(validOAuthState(valid, "google", state, now + 600_000), false);
  assert.equal(validOAuthState({ ...valid, expiresAt: now + 600_001 }, "google", state, now), false);
  assert.equal(validOAuthState({ ...valid, verifier: "short" }, "google", state, now), false);
});

test("mail HTML extraction does not render scripts or fetch remote content", () => {
  assert.equal(plainEmailHtml('<p>Renewal &amp; receipt</p><script>alert("bad")</script><img src="https://tracker.example/pixel"><p>$10&#46;00</p>'), "Renewal & receipt\n$10.00");
});

test("mail routes fail closed with absent config, enforce origin, use PKCE and reject callback replay", async () => {
  for (const name of ["APP_ORIGIN", "MAIL_SESSION_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"]) delete process.env[name];
  const status = await mailStatus(new Request(`${origin}/api/mail/status`));
  assert.equal(status.headers.get("Cache-Control"), "no-store, private");
  assert.deepEqual(await status.json(), { providers: [{ id: "google", configured: false, connected: false }, { id: "microsoft", configured: false, connected: false }] });
  const request = (body: object, headers: Record<string, string> = {}) => new Request(`${origin}/api/mail/connect`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await mailConnect(request({ provider: "google" }))).status, 503);
  Object.assign(process.env, { APP_ORIGIN: origin, MAIL_SESSION_KEY: key, GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret" });
  assert.equal((await mailConnect(request({ provider: "google" }, { Origin: "https://attacker.example" }))).status, 403);
  const response = await mailConnect(request({ provider: "google", email: "dad@example.com" }));
  assert.equal(response.status, 200);
  const result = await response.json() as { url: string };
  const login = new URL(result.url);
  assert.equal(login.origin, "https://accounts.google.com");
  assert.equal(login.searchParams.get("code_challenge_method"), "S256");
  assert.equal(login.searchParams.get("access_type"), "online");
  assert.equal(login.searchParams.get("scope"), "https://www.googleapis.com/auth/gmail.readonly");
  assert.equal(login.searchParams.get("redirect_uri"), `${origin}/api/mail/callback/google`);
  const pending = response.headers.getSetCookie().find((value) => value.startsWith("__Secure-unsub_google_oauth=v1."));
  assert.ok(pending); assert.match(pending, /HttpOnly; SameSite=Lax; Secure/);
  assert.equal(pending.includes("test-secret"), false);
  const state = login.searchParams.get("state");
  let fetchCalls = 0;
  globalThis.fetch = async (input, init) => {
    fetchCalls++;
    const url = input.toString();
    if (url === "https://oauth2.googleapis.com/token") {
      const posted = init?.body as URLSearchParams;
      assert.equal(posted.get("grant_type"), "authorization_code");
      assert.ok((posted.get("code_verifier")?.length ?? 0) >= 43);
      return Response.json({ access_token: "never-to-client", expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.readonly" });
    }
    if (url.endsWith("/profile")) return Response.json({ emailAddress: "actual@example.com" });
    if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) return Response.json({ messages: [{ id: "message-1" }] });
    if (url.includes("messages/message-1?")) return Response.json({ id: "message-1", internalDate: String(Date.now()), payload: { mimeType: "text/plain", headers: [{ name: "From", value: "billing@example.com" }, { name: "Subject", value: "Your subscription renewed" }], body: { data: base64url(new TextEncoder().encode("Your monthly plan renewed for $10.00.")) } } });
    if (url === "https://oauth2.googleapis.com/revoke") return new Response(null, { status: 200 });
    throw new Error("Unexpected external request");
  };
  const callback = await mailCallback(new Request(`${origin}/api/mail/callback/google?state=${state}&code=valid-code`, { headers: { Cookie: pending.split(";")[0] } }), "google");
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get("Location"), `${origin}/?mail_connected=google`);
  assert.equal(fetchCalls, 2);
  const sessionCookie = callback.headers.getSetCookie().find((value) => value.startsWith("__Secure-unsub_google_session=v1."));
  assert.ok(sessionCookie);
  assert.equal(sessionCookie.includes("never-to-client"), false);
  const cookie = sessionCookie.split(";")[0];
  const connectedStatus = await (await mailStatus(new Request(`${origin}/api/mail/status`, { headers: { Cookie: cookie } }))).json() as { providers: { email?: string }[] };
  assert.equal(connectedStatus.providers[0].email, "actual@example.com", "provider profile, not typed address, identifies mailbox");
  assert.equal(JSON.stringify(connectedStatus).includes("never-to-client"), false);
  const scan = await mailScan(request({ provider: "google", months: 12 }, { Cookie: cookie }));
  assert.equal(scan.status, 200);
  const scanned = await scan.json() as { messages: { account: string; body: string }[] };
  assert.equal(scanned.messages[0].account, "actual@example.com");
  assert.equal(scanned.messages[0].body, "Your monthly plan renewed for $10.00.");
  const callsBeforeReplay = fetchCalls;
  const replay = await mailCallback(new Request(`${origin}/api/mail/callback/google?state=${state}&code=valid-code`), "google");
  assert.equal(replay.headers.get("Location"), `${origin}/?mail_error=state_expired`);
  assert.equal(fetchCalls, callsBeforeReplay, "callback without consumed browser state never exchanges a code");
  const disconnected = await mailDisconnect(request({ provider: "google" }, { Cookie: cookie }));
  assert.equal(disconnected.status, 200);
  assert.deepEqual(await disconnected.json(), { disconnected: true, provider: "google", revoked: true });
  assert.ok(disconnected.headers.getSetCookie().some((value) => value.startsWith("__Secure-unsub_google_session=;") && value.includes("Max-Age=0")));
});

test("Microsoft flow uses delegated read-only scopes, selected fields and bounded search", async () => {
  Object.assign(process.env, { APP_ORIGIN: origin, MAIL_SESSION_KEY: key, MICROSOFT_CLIENT_ID: "ms-client", MICROSOFT_CLIENT_SECRET: "ms-secret" });
  const request = (body: object, cookie = "") => new Request(`${origin}/api/mail/connect`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  const connected = await mailConnect(request({ provider: "microsoft" }));
  const login = new URL((await connected.json() as { url: string }).url);
  assert.equal(login.origin, "https://login.microsoftonline.com");
  assert.equal(login.searchParams.get("scope"), "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read");
  assert.equal(login.searchParams.get("scope")?.includes("offline_access"), false);
  const pending = connected.headers.getSetCookie().find((value) => value.startsWith("__Secure-unsub_microsoft_oauth=v1."));
  assert.ok(pending);
  globalThis.fetch = async (input, init) => {
    const url = new URL(input.toString());
    if (url.pathname.endsWith("/token")) return Response.json({ access_token: "ms-access-only", expires_in: 3600, scope: "Mail.Read User.Read" });
    if (url.pathname === "/v1.0/me") return Response.json({ mail: "owner@example.com" });
    if (url.pathname === "/v1.0/me/messages") {
      assert.equal(init?.method ?? "GET", "GET");
      assert.equal(url.searchParams.get("$top"), "150");
      assert.ok(url.searchParams.get("$search")?.includes("received>="));
      assert.equal(url.searchParams.get("$select")?.includes("body"), true);
      return Response.json({ value: [{ id: "ms-1", from: { emailAddress: { address: "billing@example.com" } }, subject: "Subscription receipt", receivedDateTime: new Date().toISOString(), body: { contentType: "html", content: "<p>Monthly membership $8.99</p>" } }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?$skip=150" });
    }
    throw new Error("Unexpected provider request");
  };
  const callback = await mailCallback(new Request(`${origin}/api/mail/callback/microsoft?state=${login.searchParams.get("state")}&code=ms-code`, { headers: { Cookie: pending.split(";")[0] } }), "microsoft");
  assert.equal(callback.headers.get("Location"), `${origin}/?mail_connected=microsoft`);
  const session = callback.headers.getSetCookie().find((value) => value.startsWith("__Secure-unsub_microsoft_session=v1."));
  assert.ok(session);
  const scan = await mailScan(request({ provider: "microsoft", months: 24 }, session.split(";")[0]));
  const data = await scan.json() as { messages: { body: string }[]; hasMore: boolean; lookbackMonths: number };
  assert.equal(scan.status, 200);
  assert.equal(data.messages[0].body, "Monthly membership $8.99");
  assert.equal(data.hasMore, true);
  assert.equal(data.lookbackMonths, 24);
  const disconnected = await mailDisconnect(request({ provider: "microsoft" }, session.split(";")[0]));
  assert.deepEqual(await disconnected.json(), { disconnected: true, provider: "microsoft", revoked: false });
});

test("oversize request streams are cancelled and oversize provider responses fail closed", async () => {
  Object.assign(process.env, { APP_ORIGIN: origin, MAIL_SESSION_KEY: key, GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret" });
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(4097)); },
    cancel() { cancelled = true; },
  });
  const oversized = new Request(`${origin}/api/mail/connect`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit & { duplex: string });
  const rejected = await mailConnect(oversized);
  assert.equal(rejected.status, 413);
  assert.equal(cancelled, true);
  const connected = await mailConnect(new Request(`${origin}/api/mail/connect`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "google" }) }));
  const login = new URL((await connected.json() as { url: string }).url);
  const pending = connected.headers.getSetCookie().find((value) => value.startsWith("__Secure-unsub_google_oauth=v1."));
  assert.ok(pending);
  globalThis.fetch = async () => new Response("oversize", { headers: { "Content-Length": "9999999", "Content-Type": "application/json" } });
  const callback = await mailCallback(new Request(`${origin}/api/mail/callback/google?state=${login.searchParams.get("state")}&code=test`, { headers: { Cookie: pending.split(";")[0] } }), "google");
  assert.equal(callback.headers.get("Location"), `${origin}/?mail_error=provider_response_too_large`);
  assert.equal(callback.headers.getSetCookie().some((value) => value.startsWith("__Secure-unsub_google_session=v1.")), false);
});

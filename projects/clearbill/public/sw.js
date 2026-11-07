/* No mailbox data, pages, API responses, or tokens are cached by this worker. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate" || new URL(event.request.url).origin !== self.location.origin) return;
  if (new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).catch(() => new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Clearbill · Offline</title><body style="font:17px/1.6 system-ui;background:#fafbf8;color:#245a40;max-width:420px;margin:15vh auto;padding:28px"><h1>You’re offline.</h1><p>Connect to the internet, then reopen Clearbill.</p><p>No mailbox data is saved for offline use. Any unsaved workspace from a previous session may need to be imported again.</p><a href="/" style="color:#245a40">Try again</a></body></html>',{status:503,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}})));
});

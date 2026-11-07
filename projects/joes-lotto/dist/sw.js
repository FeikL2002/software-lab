/* Offline shell only. Ticket records remain in localStorage, never this cache. */
const CACHE_NAME="joes-lotto-2bceccfd44383a";
const ASSETS=["__forms.html","app.css","app.js","data/ohio-games.json","data/ohio-recent-draws.json","data/ohio-winners.json","draw-ticket.js","feedback.css","feedback.js","icon-192.png","icon-512.png","icon.svg","index.html","insights.css","install.css","install.js","lewis.css","lewis.js","manifest.webmanifest","maps.css","maps.js","recent-picks.js","scan-details.css","scanner.js","ticket-desk.css","ticket-desk.js","ticket-images.js","ticket-intelligence.js","ticket-text-match.js","ticket-text-reader.js","vendor/fonts/dm-sans-latin-variable.woff2","vendor/fonts/manrope-latin-variable.woff2","vendor/images/layers-2x.png","vendor/images/layers.png","vendor/images/marker-icon-2x.png","vendor/images/marker-icon.png","vendor/images/marker-shadow.png","vendor/leaflet.css","vendor/leaflet.js","vendor/zxing-browser.min.js"];
const OPTIONAL_ASSETS=["vendor/ocr/core/tesseract-core-lstm.wasm.js","vendor/ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js","vendor/ocr/core/tesseract-core-simd-lstm.wasm.js","vendor/ocr/lang/eng.traineddata.gz","vendor/ocr/worker.min.js"];
const URLS=ASSETS.map(path=>new URL(path,self.registration.scope).href);
const OPTIONAL_URLS=OPTIONAL_ASSETS.map(path=>new URL(path,self.registration.scope).href);
const NAVIGATION_KEY=new URL('index.html',self.registration.scope).href;
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE_NAME);await cache.addAll(URLS);await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('joes-lotto-')&&name!==CACHE_NAME)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin)return;
  if(req.mode==='navigate'){
    event.respondWith((async()=>{try{const response=await fetch(req);if(response.ok&&!response.redirected&&response.headers.get('content-type')?.includes('text/html')){const text=await response.clone().text();if(text.includes('id="ticketDialog"')){const cache=await caches.open(CACHE_NAME);await cache.put(NAVIGATION_KEY,response.clone());}}return response;}catch(error){const cached=await caches.match(NAVIGATION_KEY);if(cached)return cached;throw error;}})());return;
  }
  if(!URLS.includes(url.href)&&!OPTIONAL_URLS.includes(url.href))return;
  event.respondWith((async()=>{try{const response=await fetch(req);if(response.ok&&!response.redirected){const cache=await caches.open(CACHE_NAME);await cache.put(req,response.clone());}return response;}catch(error){const cached=await caches.match(req);if(cached)return cached;throw error;}})());
});

// These are availability notices only; no winner assertion or private ticket data.
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const client=windows.find(c=>new URL(c.url).origin===self.location.origin);if(client){await client.focus();client.postMessage({type:'joe-open-tickets'});}else await self.clients.openWindow(new URL('./?tickets=1',self.registration.scope).href);})());});

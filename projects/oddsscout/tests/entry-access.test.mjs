import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import access,{config as accessConfig,clearEntryAttemptsForTests} from '../netlify/functions/access.mjs';
import gate,{config as edgeConfig,validEdgeSession} from '../netlify/edge-functions/entry-gate.js';
import {ENTRY_TTL_SECONDS,entryConfigured,accessCodeMatches,createEntrySession,getEntrySession,validateEntrySession,entryCookie,clearEntryCookie} from '../server/entry-session.mjs';
import {entryPage} from '../server/entry-page.mjs';

const CODE='test-only-amber-cove',SIGNING='test-only-random-session-secret-9da15236141e62a1976677a19c388a29';
const originalEnv={ACCESS_CODE:process.env.ACCESS_CODE,ENTRY_SESSION_SECRET:process.env.ENTRY_SESSION_SECRET},originalNetlify=globalThis.Netlify;
const now=Date.parse('2026-10-15T12:00:00Z');
beforeEach(()=>{
 process.env.ACCESS_CODE=CODE;process.env.ENTRY_SESSION_SECRET=SIGNING;
 globalThis.Netlify={env:{get:key=>process.env[key]}};
 clearEntryAttemptsForTests();
});
afterEach(()=>{
 for(const [key,value] of Object.entries(originalEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;
 if(originalNetlify===undefined)delete globalThis.Netlify;else globalThis.Netlify=originalNetlify;
});
const req=(path='/',options={})=>new Request(`https://preview.example${path}`,options);
const withCookie=(path,token,extra={})=>req(path,{...extra,headers:{cookie:`os_entry=${token}`,...extra.headers}});
const issue=options=>createEntrySession(req('/'),CODE,{signingSecret:SIGNING,...options});
const post=(body={code:CODE},options={})=>req('/api/access',{method:'POST',body:JSON.stringify(body),...options,headers:{'content-type':'application/json',origin:'https://preview.example',...options.headers}});
const read=async response=>({status:response.status,body:await response.json(),headers:response.headers});

test('Entry needs both an access code and an independent strong signing secret',()=>{
 assert.equal(entryConfigured('',SIGNING),false);assert.equal(entryConfigured(CODE,''),false);assert.equal(entryConfigured(CODE,'short'),false);
 assert.equal(entryConfigured(CODE,SIGNING),true);assert.equal(entryConfigured('x'.repeat(257),SIGNING),false);
 assert.equal(accessCodeMatches(CODE,CODE),true);assert.equal(accessCodeMatches(`${CODE} `,CODE),false);assert.equal(accessCodeMatches('',CODE),false);assert.equal(accessCodeMatches(123,CODE),false);
});

test('Issued entry cookie contains no access code and has a bounded secure lifetime',()=>{
 const session=issue({now,ttlSeconds:Infinity});
 assert.equal(session.ttlSeconds,ENTRY_TTL_SECONDS);assert.equal(session.expiresAt,'2026-10-15T20:00:00.000Z');
 assert.ok(!session.token.includes(CODE));assert.match(entryCookie(session.token),/Path=\/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax$/);
 assert.notEqual(session.token,issue({now}).token);assert.throws(()=>issue({now,ttlSeconds:NaN}));
 assert.throws(()=>entryCookie('bad; injected=value'));
});

test('Node and Edge verify the same host-bound session and expiration',async()=>{
 const {token,expiresAt}=issue({now}),request=withCookie('/api/board',token);
 assert.equal(validateEntrySession(request,CODE,{signingSecret:SIGNING,now}),true);
 assert.deepEqual(getEntrySession(request,CODE,{signingSecret:SIGNING,now}),{expiresAt});
 assert.equal(await validEdgeSession(request,CODE,SIGNING,now),true);
 assert.equal(await validEdgeSession(request,CODE,SIGNING,now+ENTRY_TTL_SECONDS*1000-1),true);
 assert.equal(validateEntrySession(request,CODE,{signingSecret:SIGNING,now:now+ENTRY_TTL_SECONDS*1000}),false);
 assert.equal(await validEdgeSession(request,CODE,SIGNING,now+ENTRY_TTL_SECONDS*1000),false);
});

test('Rotating either the access code or signing secret invalidates every previous session',async()=>{
 const {token}=issue({now}),request=withCookie('/',token);
 for(const [code,secret] of [[`${CODE}-rotated`,SIGNING],[CODE,`${SIGNING}-rotated`]]) {
  assert.equal(validateEntrySession(request,code,{signingSecret:secret,now}),false);
  assert.equal(await validEdgeSession(request,code,secret,now),false);
 }
});

test('Forgery, duplicate cookies, future issuance and a different origin fail in both runtimes',async()=>{
 const {token}=issue({now}),parts=token.split('.');
 const modified=parts.slice();modified[2]=(parseInt(modified[2],36)+100).toString(36);
 const future=issue({now:now+31000}).token;
 const requests=[
  req('/',{headers:{cookie:`os_entry=${token}; os_entry=${token}`}}),
  withCookie('/',`${token.slice(0,-8)}aaaaaaaa`),withCookie('/',modified.join('.')),
  withCookie('/',future),withCookie('/','x'.repeat(500)),req('/'),
  new Request('https://another-preview.example/',{headers:{cookie:`os_entry=${token}`}})
 ];
 for(const request of requests) {
  assert.equal(validateEntrySession(request,CODE,{signingSecret:SIGNING,now}),false);
  assert.equal(await validEdgeSession(request,CODE,SIGNING,now),false);
 }
});

test('Entry settings are private flags and never contain either secret',async()=>{
 const result=await read(await access(req('/api/access')));
 assert.equal(result.status,200);assert.deepEqual(result.body,{authenticated:false,configured:true,expiresAt:null});
 assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.equal(result.headers.get('Netlify-CDN-Cache-Control'),'no-store');
 assert.ok(!JSON.stringify(result.body).includes(CODE));assert.ok(!JSON.stringify(result.body).includes(SIGNING));
});

test('Access endpoint fails closed when the signing secret or code is missing',async()=>{
 delete process.env.ENTRY_SESSION_SECRET;
 let result=await read(await access(post()));assert.equal(result.status,503);assert.equal(result.body.configured,false);assert.equal(result.headers.get('Set-Cookie'),null);
 process.env.ENTRY_SESSION_SECRET=SIGNING;delete process.env.ACCESS_CODE;
 result=await read(await access(req('/api/access')));assert.equal(result.status,503);assert.equal(result.body.code,'ACCESS_NOT_CONFIGURED');
});

test('Successful code entry yields a private HttpOnly cookie verifiable by the Edge gate',async()=>{
 const response=await access(post(),{ip:'test-success'}),result=await read(response);
 assert.equal(result.status,200);assert.equal(result.body.authenticated,true);assert.equal(result.body.configured,true);assert.ok(Date.parse(result.body.expiresAt)>Date.now());
 const cookie=result.headers.get('Set-Cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Lax/);assert.ok(!cookie.includes(CODE));
 const token=cookie.split(';')[0].slice('os_entry='.length),request=withCookie('/',token);
 assert.equal(validateEntrySession(request,CODE),true);assert.equal(await validEdgeSession(request,CODE,SIGNING),true);
 const settings=await read(await access(withCookie('/api/access',token)));
 assert.equal(settings.body.authenticated,true);assert.equal(settings.body.expiresAt,result.body.expiresAt);
});

test('Incorrect code is never echoed, never saved and never issues a session',async()=>{
 const wrong='incorrect-private-code';const result=await read(await access(post({code:wrong}),{ip:'test-wrong'}));
 assert.equal(result.status,401);assert.equal(result.body.code,'ACCESS_DENIED');assert.equal(result.headers.get('Set-Cookie'),null);assert.ok(!JSON.stringify(result.body).includes(wrong));
});

test('Mutation origin checks reject cross-site entry and logout',async()=>{
 for(const request of [post({code:CODE},{headers:{origin:'https://evil.example'}}),post({code:CODE},{headers:{origin:'null'}}),post({code:CODE},{headers:{'sec-fetch-site':'cross-site'}}),req('/api/access',{method:'DELETE',headers:{origin:'https://evil.example'}})]) {
  const result=await read(await access(request));assert.equal(result.status,403);assert.equal(result.body.code,'ORIGIN_DENIED');assert.equal(result.headers.get('Set-Cookie'),null);
 }
});

test('Entry request parsing rejects ambiguous, oversized, non-JSON and query-based codes',async()=>{
 const requests=[post({code:CODE,extra:'unexpected'}),post({code:12}),post({}),post([]),post({code:'x'.repeat(1500)}),req('/api/access?code=never-in-urls',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),req('/api/access',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:`code=${CODE}`}),req('/api/access',{method:'POST',headers:{'content-type':'application/json'},body:'{broken'})];
 for(const request of requests) {
  const result=await read(await access(request,{ip:'test-parsing'}));assert.ok([400,413,415].includes(result.status));assert.equal(result.headers.get('Set-Cookie'),null);assert.ok(!JSON.stringify(result.body).includes(CODE));
 }
});

test('A configured platform limiter and warm-IP cooldown bound incorrect guesses',async()=>{
 assert.deepEqual(accessConfig.rateLimit,{action:'rate_limit',windowLimit:12,windowSize:60,aggregateBy:['domain','ip']});
 for(let i=0;i<5;i++)assert.equal((await access(post({code:'wrong'}),{ip:'test-limited'})).status,401);
 const result=await read(await access(post(),{ip:'test-limited'}));assert.equal(result.status,429);assert.ok(Number(result.headers.get('Retry-After'))>0);assert.equal(result.headers.get('Set-Cookie'),null);
 assert.equal((await access(post(),{ip:'test-separate'})).status,200);
});

test('Logout expires only the entry cookie and methods are explicit',async()=>{
 const result=await read(await access(req('/api/access',{method:'DELETE',headers:{origin:'https://preview.example'}})));
 assert.equal(result.status,200);assert.equal(result.body.authenticated,false);assert.equal(result.headers.get('Set-Cookie'),clearEntryCookie());assert.match(result.headers.get('Set-Cookie'),/Max-Age=0/);
 const unsupported=await access(req('/api/access',{method:'PUT'}));assert.equal(unsupported.status,405);assert.equal(unsupported.headers.get('Allow'),'GET, POST, DELETE');
});

test('Edge gate covers every path, fails closed and bypasses only the exact entry assets',async()=>{
 assert.equal(edgeConfig.path,'/*');assert.equal(edgeConfig.onError,'fail');
 for(const path of ['/api/access','/.netlify/functions/access','/entry.css','/entry.mjs','/icon.svg'])assert.equal(await gate(req(path),{}),undefined);
 for(const path of ['/api/board','/.netlify/functions/board','/.netlify/identity/settings','/app.mjs','/lib/odds.mjs','/api/access/','/.netlify/functions/access/']) {
  const response=await gate(req(path),{});assert.equal(response.status,401);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 }
 delete process.env.ENTRY_SESSION_SECRET;
 const result=await read(await gate(req('/api/board'),{}));assert.equal(result.status,503);assert.equal(result.body.code,'ACCESS_NOT_CONFIGURED');
});

test('Unauthenticated HTML gets only an accessible code dialog and no application source',async()=>{
 for(const path of ['/','/index.html','/%69ndex.html','//index.html']) {
  const response=await gate(req(path,{headers:{accept:'text/html'}}),{}),html=await response.text();
  assert.equal(response.status,200);assert.match(html,/id="entry-form" method="post" action="\/api\/access"/);assert.match(html,/role="dialog" aria-modal="true"/);assert.match(html,/type="password"/);assert.ok(!html.includes('/app.mjs'));assert.ok(!html.includes(CODE));
 }
 const response=await gate(req('/'),{});assert.ok(!response.headers.get('Content-Security-Policy').includes('unsafe-inline'));
 delete process.env.ACCESS_CODE;
 const missing=await gate(req('/'),{}),html=await missing.text();assert.equal(missing.status,503);assert.match(html,/data-entry-configured="false"/);assert.match(html,/id="entry-submit"[^>]+disabled/);
});

test('A valid session opens private resources without allowing CDN caching',async()=>{
 const {token}=issue(),next=()=>new Response('private app',{headers:{'cache-control':'public, max-age=600','netlify-cdn-cache-control':'public, max-age=600',vary:'Accept-Encoding'}});
 const response=await gate(withCookie('/app.mjs',token),{next});assert.equal(response.status,200);assert.equal(await response.text(),'private app');assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Netlify-CDN-Cache-Control'),'no-store');assert.equal(response.headers.get('Vary'),'Accept-Encoding, Cookie');
});

test('Legacy room-code header is restricted to APIs and cannot unlock HTML or modules',async()=>{
 const headers={'x-room-code':CODE},next=()=>new Response('authorized',{status:200});
 assert.equal((await gate(req('/api/board',{headers}),{next})).status,200);
 assert.equal((await gate(req('/app.mjs',{headers}),{next})).status,401);
 const html=await (await gate(req('/',{headers}),{next})).text();assert.match(html,/id="entry-form"/);
 assert.equal((await gate(req('/api/board',{headers:{'x-room-code':'wrong'}}),{next})).status,401);
});

test('Entry renderer provides a safe no-JavaScript submission fallback',()=>{
 const html=entryPage({configured:false});assert.match(html,/<noscript>/);assert.match(html,/method="post" action="\/api\/access"/);assert.ok(!html.includes('onsubmit='));assert.ok(!html.includes('<script>'));
});

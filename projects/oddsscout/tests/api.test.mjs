import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import configFn from '../netlify/functions/config.mjs';
import boardFn from '../netlify/functions/board.mjs';
import sportsFn from '../netlify/functions/sports.mjs';
import askFn from '../netlify/functions/ask.mjs';
import {clearCacheForTests} from '../server/common.mjs';
import {makeDemo,DEMO_SPORTS} from './fixtures/demo.mjs';
import {compareGroups} from '../public/lib/odds.mjs';
const originalFetch=globalThis.fetch;
const keys=['ODDS_API_KEY','OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL','ACCESS_CODE','ODDS_BOOKMAKERS'];
const originalEnv=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
beforeEach(()=>{clearCacheForTests();for(const k of keys)delete process.env[k];});
afterEach(()=>{globalThis.fetch=originalFetch;for(const k of keys){if(originalEnv[k]===undefined)delete process.env[k];else process.env[k]=originalEnv[k];}});
const request=(path,options={})=>new Request(`https://test.local${path}`,options);
const post=body=>request('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const read=async response=>({status:response.status,body:await response.json(),headers:response.headers});
function installProviderMock({scoresFail=false,aiFail=false}={}){
 const source=makeDemo();let providerCalls=0,aiCalls=0;
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);
  if(u.hostname==='api.openai.com'){
   aiCalls++;const body=JSON.parse(options.body);assert.equal(body.store,false);assert.ok(body.instructions.includes('ONLY'));assert.equal(new Headers(options.headers).get('authorization'),'Bearer test-ai-key');
   return aiFail?new Response('{}',{status:500}):Response.json({output:[{type:'message',content:[{type:'output_text',text:'The returned best price is a comparison, not a prediction.'}]}]});
  }
  providerCalls++;assert.equal(u.searchParams.get('apiKey'),'test-odds-key');
  const headers={'x-requests-remaining':'480','x-requests-last':'1'};
  if(u.pathname.endsWith('/sports'))return Response.json(DEMO_SPORTS.map(s=>({...s,active:true,has_outrights:false})),{headers});
  if(u.pathname.endsWith('/scores')){if(scoresFail)return new Response('{}',{status:422});const sport=u.pathname.split('/')[3];return Response.json(source.events.filter(e=>e.sport_key===sport).map(e=>({id:e.id,completed:false,scores:e.scores,last_update:e.scoreUpdatedAt})),{headers});}
  if(u.pathname.endsWith('/odds')){assert.equal(u.searchParams.get('oddsFormat'),'decimal');assert.equal(u.searchParams.get('regions'),'us,us2');return Response.json(source.events,{headers});}
  throw new Error('Unexpected mock path');
 };
 return {source,calls:()=>({providerCalls,aiCalls})};
}
function questionBody(board){const event=board.events[0];const group=compareGroups(event,'h2h')[0];return {eventId:event.id,groupId:group.id,question:'Explain the price.',market:'h2h',league:'upcoming',stake:25};}
test('Missing odds key returns setup error, never implicit demo data',async()=>{const r=await read(await boardFn(request('/api/board')));assert.equal(r.status,503);assert.equal(r.body.code,'ODDS_NOT_CONFIGURED');assert.equal(r.body.events,undefined);});
test('Public config exposes flags, never secrets',async()=>{process.env.ODDS_API_KEY='secret-odds';process.env.OPENAI_API_KEY='secret-ai';const r=await read(await configFn(request('/api/config')));assert.equal(r.body.mode,'configured');assert.equal(r.body.oddsConfigured,true);assert.equal(r.body.providerVerified,false);assert.equal(r.body.aiEnabled,true);assert.ok(!JSON.stringify(r.body).includes('secret-'));});
test('Room code rejects unauthorized data requests',async()=>{process.env.ACCESS_CODE='long-test-code';const r=await read(await boardFn(request('/api/board')));assert.equal(r.status,401);assert.equal(r.body.code,'ROOM_LOCKED');});
test('Authorized room data is never CDN cached',async()=>{process.env.ODDS_API_KEY='test-odds-key';installProviderMock();process.env.ACCESS_CODE='long-test-code';const r=await read(await boardFn(request('/api/board',{headers:{'X-Room-Code':'long-test-code'}})));assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Netlify-CDN-Cache-Control'),null);});
test('Public board uses durable caching with a finite TTL',async()=>{process.env.ODDS_API_KEY='test-odds-key';installProviderMock();const r=await read(await boardFn(request('/api/board')));assert.match(r.headers.get('Netlify-CDN-Cache-Control'),/public, durable, max-age=\d+/);});
test('Extra and repeated query parameters are rejected',async()=>{for(const suffix of ['?random=123','?market=h2h&market=totals','?league=../../bad','?market=player_points'])assert.equal((await boardFn(request('/api/board'+suffix))).status,400);});
test('Wrong API method is rejected',async()=>{assert.equal((await boardFn(request('/api/board',{method:'POST'}))).status,405);assert.equal((await askFn(request('/api/ask'))).status,405);});
test('Configured live feed is normalized with scores and no secret leaks',async()=>{process.env.ODDS_API_KEY='test-odds-key';installProviderMock();const r=await read(await boardFn(request('/api/board')));assert.equal(r.body.mode,'live');assert.equal(r.body.events.filter(e=>e.status==='live').length,5);assert.equal(r.body.events.find(e=>e.id==='demo-mma-1').status,'unknown');assert.ok(!JSON.stringify(r.body).includes('test-odds-key'));assert.equal(r.body.usage.remaining,480);});
test('A provider outage returns an error, not demo data',async()=>{process.env.ODDS_API_KEY='test-odds-key';globalThis.fetch=async()=>new Response('{}',{status:500});const r=await read(await boardFn(request('/api/board')));assert.equal(r.status,502);assert.equal(r.body.mode,undefined);assert.equal(r.body.code,'PROVIDER_UNAVAILABLE');});
test('Exhausted or invalid provider key has a sanitized error',async()=>{process.env.ODDS_API_KEY='very-secret';globalThis.fetch=async()=>new Response('very-secret',{status:401});const r=await read(await boardFn(request('/api/board')));assert.equal(r.status,503);assert.ok(!JSON.stringify(r.body).includes('very-secret'));});
test('Partial score outage keeps odds but marks started games unconfirmed',async()=>{process.env.ODDS_API_KEY='test-odds-key';installProviderMock({scoresFail:true});const r=await read(await boardFn(request('/api/board')));assert.equal(r.status,200);assert.equal(r.body.events.filter(e=>e.status==='live').length,0);assert.ok(r.body.warnings.length>0);});
test('Repeated board fetches reuse the server snapshot',async()=>{process.env.ODDS_API_KEY='test-odds-key';const mock=installProviderMock();await boardFn(request('/api/board'));const a=mock.calls().providerCalls;await boardFn(request('/api/board'));assert.equal(mock.calls().providerCalls,a);});
test('Active-sport catalog returns only supported event leagues',async()=>{process.env.ODDS_API_KEY='test-odds-key';installProviderMock();const r=await read(await sportsFn(request('/api/sports')));assert.equal(r.body.sports.length,DEMO_SPORTS.length);});
test('Unknown league is rejected before an odds call',async()=>{process.env.ODDS_API_KEY='test-odds-key';const mock=installProviderMock();assert.equal((await boardFn(request('/api/board?league=not_a_league'))).status,400);assert.equal(mock.calls().providerCalls,1);});
test('Missing AI key returns a genuinely rules-based explanation of provider data',async()=>{process.env.ODDS_API_KEY='test-odds-key';installProviderMock();const board=(await read(await boardFn(request('/api/board')))).body;const r=await read(await askFn(post(questionBody(board))));assert.equal(r.status,200);assert.equal(r.body.mode,'rules');assert.match(r.body.note,/No AI key is configured/);assert.match(r.body.text,/highest payout/);});
test('Genuine AI request uses server-verified odds and parsed Responses output',async()=>{process.env.ODDS_API_KEY='test-odds-key';process.env.OPENAI_API_KEY='test-ai-key';const mock=installProviderMock();const board=(await read(await boardFn(request('/api/board')))).body;const payload=questionBody(board);payload.fakeOdds=99999;const r=await read(await askFn(post(payload)));assert.equal(r.status,200);assert.equal(r.body.mode,'ai');assert.equal(mock.calls().aiCalls,1);assert.equal(r.body.verified.bestOdds,'+140');});
test('Failed AI request falls back with a truthful label',async()=>{process.env.ODDS_API_KEY='test-odds-key';process.env.OPENAI_API_KEY='test-ai-key';installProviderMock({aiFail:true});const board=(await read(await boardFn(request('/api/board')))).body;const r=await read(await askFn(post(questionBody(board))));assert.equal(r.body.mode,'rules');assert.match(r.body.note,/temporarily unavailable/);});
test('Cross-origin AI use is rejected',async()=>{const r=await askFn(request('/api/ask',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'}));assert.equal(r.status,403);});
test('Oversized AI requests are rejected before spending',async()=>{const r=await askFn(post({x:'a'.repeat(5000)}));assert.equal(r.status,413);});
test('Invalid question and unavailable event are rejected',async()=>{process.env.ODDS_API_KEY='test-odds-key';installProviderMock();assert.equal((await askFn(post({question:123}))).status,400);const body=questionBody(makeDemo());body.eventId='not-present';assert.equal((await askFn(post(body))).status,409);});
test('Unsafe bookmaker configuration does not silently query other books',async()=>{process.env.ODDS_BOOKMAKERS='../../not_a_book';assert.equal((await configFn(request('/api/config'))).status,503);});

test('Configuration flags distinguish missing keys from verified connections',async()=>{const r=await read(await configFn(request('/api/config')));assert.equal(r.status,200);assert.equal(r.body.mode,'unconfigured');assert.equal(r.body.apiVersion,3);assert.equal(r.body.providerVerified,false);assert.equal(r.body.aiEnabled,false);});
test('Missing sports key returns configuration error JSON',async()=>{const r=await read(await sportsFn(request('/api/sports')));assert.equal(r.status,503);assert.equal(r.body.code,'ODDS_NOT_CONFIGURED');assert.match(r.headers.get('Content-Type'),/application\/json/);});
test('Missing odds key does not allow server-side fictional AI answers',async()=>{const r=await read(await askFn(post(questionBody(makeDemo()))));assert.equal(r.status,503);assert.equal(r.body.code,'ODDS_NOT_CONFIGURED');assert.equal(r.body.text,undefined);});
test('Provider 429 forwards Retry-After and is negatively cached',async()=>{process.env.ODDS_API_KEY='test-odds-key';let calls=0;globalThis.fetch=async()=>{calls++;return new Response('secret upstream text',{status:429,headers:{'Retry-After':'90'}});};const a=await read(await boardFn(request('/api/board')));const b=await read(await boardFn(request('/api/board')));assert.equal(a.status,429);assert.equal(a.headers.get('Retry-After'),'90');assert.equal(a.body.retryAfter,90);assert.equal(b.status,429);assert.equal(calls,1);assert.ok(!JSON.stringify(a.body).includes('secret upstream'));});
test('Provider 429 without a usable delay gets a 60-second cooldown',async()=>{process.env.ODDS_API_KEY='test-odds-key';globalThis.fetch=async()=>new Response('',{status:429,headers:{'Retry-After':'nonsense'}});const r=await read(await boardFn(request('/api/board')));assert.equal(r.body.retryAfter,60);});
test('Only JSON error responses escape unexpected provider failures',async()=>{process.env.ODDS_API_KEY='test-odds-key';globalThis.fetch=async()=>new Response('<html>secret</html>',{status:200});const r=await read(await boardFn(request('/api/board')));assert.equal(r.status,502);assert.equal(r.body.code,'BAD_FEED');assert.ok(!JSON.stringify(r.body).includes('secret'));});
test('Malformed event dates cannot crash the browser',async()=>{process.env.ODDS_API_KEY='test-odds-key';globalThis.fetch=async()=>Response.json([{id:'bad-date',sport_key:'basketball_nba',home_team:'H',away_team:'A',commence_time:'broken',bookmakers:[]}]);const r=await read(await boardFn(request('/api/board')));assert.equal(r.status,200);assert.deepEqual(r.body.events,[]);});
test('Whitespace-only questions are rejected without an AI call',async()=>{const body=questionBody(makeDemo());body.question='  ';assert.equal((await askFn(post(body))).status,400);});
test('No fresh selection does not invoke configured AI',async()=>{process.env.ODDS_API_KEY='test-odds-key';process.env.OPENAI_API_KEY='test-ai-key';const mock=installProviderMock();for(const e of mock.source.events)for(const b of e.bookmakers)for(const m of b.markets)m.last_update=new Date(Date.now()-240000).toISOString();const board=(await read(await boardFn(request('/api/board')))).body;const r=await read(await askFn(post(questionBody(board))));assert.equal(r.body.mode,'rules');assert.match(r.body.note,/No fresh quote/);assert.equal(mock.calls().aiCalls,0);});
test('Unknown API routes return JSON 404, not an HTML shell',async()=>{const handler=(await import('../netlify/functions/api-not-found.mjs')).default;const r=await read(await handler(request('/api/not-here')));assert.equal(r.status,404);assert.equal(r.body.code,'API_NOT_FOUND');});

test('Provider suspension flags survive normalization and cannot rank as available odds',async()=>{
 process.env.ODDS_API_KEY='test-odds-key';const mock=installProviderMock();const e=mock.source.events[0];
 for(const b of e.bookmakers)for(const m of b.markets){m.suspended=true;for(const o of m.outcomes)o.suspended=true;}
 const result=(await read(await boardFn(request('/api/board')))).body;const normalized=result.events.find(x=>x.id===e.id);
 assert.equal(normalized.bookmakers[0].markets[0].suspended,true);assert.equal(normalized.bookmakers[0].markets[0].outcomes[0].suspended,true);assert.deepEqual(compareGroups(normalized,'h2h'),[]);
});

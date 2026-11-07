import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import eventFn from '../netlify/functions/event.mjs';
import boardFn from '../netlify/functions/board.mjs';
import {configuredBooks,coverageParameters,loadBoard,loadEventDetails} from '../server/provider.mjs';
import {adaptOddsEvent,normalizeEvents,safeProviderLink} from '../server/adapters.mjs';
import {observeQuotes,movementsForEvent,clearObservationsForTests} from '../server/observations.mjs';
import {clearCacheForTests} from '../server/common.mjs';
import {compareGroups} from '../public/lib/odds.mjs';

const originalFetch=globalThis.fetch;
const envKeys=['ODDS_API_KEY','ODDS_BOOKMAKERS','ODDS_REGIONS','ACCESS_CODE'];
const originalEnv=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
beforeEach(()=>{clearCacheForTests();clearObservationsForTests();for(const key of envKeys)delete process.env[key];process.env.ODDS_API_KEY='mock-only-server-secret';});
afterEach(()=>{globalThis.fetch=originalFetch;for(const key of envKeys){if(originalEnv[key]===undefined)delete process.env[key];else process.env[key]=originalEnv[key];}});
const iso=offset=>new Date(Date.now()+offset).toISOString();
function fixture({live=false,stale=false,suspended=false}={}) {
 const timestamp=iso(stale?-600000:-15000);
 return {id:'event-a',sport_key:'basketball_nba',sport_title:'NBA',commence_time:iso(live?-600000:7200000),home_team:'Home Team',away_team:'Away Team',bookmakers:['fanduel','draftkings','hardrockbet_oh','futurebook'].map((key,i)=>({key,title:key,last_update:iso(-10000),markets:[{key:'h2h',last_update:timestamp,suspended,outcomes:[{name:'Home Team',price:1.8+i/10},{name:'Away Team',price:2.2+i/10}]}]}))};
}
function installMock({event=fixture(),failOdds=0,failDiscovery=0,scoreFail=false}={}) {
 const calls=[];
 globalThis.fetch=async url=>{
  const u=new URL(url);calls.push(u);assert.equal(u.searchParams.get('apiKey'),'mock-only-server-secret');
  const headers={'x-requests-remaining':'1200','x-requests-last':'2'};
  if(u.pathname==='/v4/sports')return Response.json([{key:'basketball_nba',title:'NBA',group:'Basketball',active:true,has_outrights:false}],{headers});
  if(u.pathname.endsWith('/markets'))return failDiscovery?new Response('private upstream',{status:failDiscovery}):Response.json({id:event.id,bookmakers:event.bookmakers.map(b=>({key:b.key,markets:[{key:'h2h',last_update:iso(-10000)},{key:'player_points',last_update:iso(-10000)}]}))},{headers});
  if(u.pathname.endsWith('/events'))return Response.json([event],{headers});
  if(u.pathname.endsWith('/scores'))return scoreFail?new Response('private upstream',{status:500}):Response.json([{id:event.id,completed:false,scores:[{name:event.home_team,score:'10'},{name:event.away_team,score:'9'}],last_update:iso(-10000)}],{headers});
  if(u.pathname.endsWith('/odds')) {
   if(failOdds)return new Response('private upstream',{status:failOdds,headers:{'retry-after':'70'}});
   return Response.json(u.pathname.includes('/events/')?event:[event,event],{headers});
  }
  throw new Error('Unexpected test transport path');
 };
 return {calls,event};
}
const req=query=>new Request('https://example.test/api/event'+query);

test('Default configuration covers ten known Ohio provider keys and both US regions',()=>{
 const keys=configuredBooks();assert.equal(keys.length,10);assert.ok(keys.includes('espnbet'));assert.ok(keys.includes('hardrockbet_oh'));assert.ok(!keys.includes('hardrockbet'));assert.deepEqual(coverageParameters(),{regions:'us,us2'});
});
test('Explicit provider keys are unique, support new books and have no ten-book cap',()=>{
 process.env.ODDS_BOOKMAKERS=Array.from({length:15},(_,i)=>'providerbook_'+i).join(',')+',providerbook_1';assert.equal(configuredBooks().length,15);assert.equal(coverageParameters().bookmakers.split(',').length,15);
});
test('Invalid override fails rather than silently using another region',()=>{
 process.env.ODDS_BOOKMAKERS='fanduel,../../secret';assert.throws(configuredBooks,{code:'BAD_CONFIG'});process.env.ODDS_BOOKMAKERS='';process.env.ODDS_REGIONS='us,nonsense';assert.throws(coverageParameters,{code:'BAD_CONFIG'});
});
test('Multiple returned books including an unknown one survive normalization',async()=>{
 const mock=installMock();const board=await loadBoard();assert.equal(board.events.length,1);assert.deepEqual(board.returnedBookKeys,['draftkings','fanduel','futurebook','hardrockbet_oh']);assert.equal(board.normalized.books.length,4);assert.equal(board.normalized.quotes.length,8);assert.ok(mock.calls[0].searchParams.get('regions'));assert.equal(mock.calls[0].searchParams.get('bookmakers'),null);assert.ok(!JSON.stringify(board).includes('mock-only-server-secret'));
});
test('Book override is sent to provider without a downstream hard filter',async()=>{
 process.env.ODDS_BOOKMAKERS='draftkings,new_book';const mock=installMock();const result=await loadBoard();assert.equal(mock.calls[0].searchParams.get('bookmakers'),'draftkings,new_book');assert.equal(mock.calls[0].searchParams.get('regions'),null);assert.ok(result.returnedBookKeys.includes('futurebook'));
});
test('Player descriptions and market timestamps survive adapter without invented timestamps',()=>{
 const raw=fixture();raw.bookmakers[0].markets=[{key:'player_points',last_update:iso(-20000),outcomes:[{name:'Over',description:'Player Name',point:24.5,price:1.9},{name:'Under',description:'Player Name',point:24.5,price:1.95}]}];const event=adaptOddsEvent(raw,null,['player_points']);const quotes=normalizeEvents([event]).quotes;assert.equal(quotes[0].subject,'Player Name');assert.equal(quotes[0].line,24.5);assert.equal(quotes[0].timestamp,raw.bookmakers[0].markets[0].last_update);assert.equal(quotes.length,2);
});
test('Suspended and stale prices remain visible as unavailable and never best',()=>{
 for(const options of [{stale:true},{suspended:true}]){const event=adaptOddsEvent(fixture(options));const normalized=normalizeEvents([event]);assert.ok(normalized.quotes.every(q=>!q.available));assert.ok(compareGroups(event).every(g=>g.best===null));}
});
test('Live data preserves fresh scores and uses 30-second refresh',async()=>{
 installMock({event:fixture({live:true})});const board=await loadBoard();assert.equal(board.events[0].status,'live');assert.equal(board.refreshSeconds,30);assert.ok(board.normalized.quotes.every(q=>q.fresh));
});
test('Score failure leaves in-play status unconfirmed without fabricated score or clock',async()=>{
 installMock({event:fixture({live:true}),scoreFail:true});const board=await loadBoard();assert.equal(board.events[0].status,'unknown');assert.equal(board.events[0].scores,null);assert.equal(board.events[0].period,null);assert.equal(board.events[0].clock,null);assert.ok(board.warnings.length);
});
test('On-demand extended market details discover available keys and preserve explicit missing capabilities',async()=>{
 const mock=installMock();const detail=await loadEventDetails('basketball_nba','event-a',['h2h']);assert.ok(detail.availableMarkets.includes('player_points'));assert.equal(detail.event.id,'event-a');assert.equal(detail.normalized.quotes.length,8);assert.ok(detail.movements.every(s=>s.openingPriceVerified===false));assert.ok(detail.limitations.some(l=>l.includes('Combined parlay')));assert.ok(mock.calls.some(u=>u.pathname.endsWith('/event-a/odds')));assert.ok(mock.calls.some(u=>u.pathname.endsWith('/markets')));
});
test('Market discovery failure retains actual prices and labels the partial response',async()=>{
 installMock({failDiscovery:500});const result=await loadEventDetails('basketball_nba','event-a',['h2h']);assert.equal(result.normalized.quotes.length,8);assert.deepEqual(result.availableMarkets,['h2h']);assert.ok(result.limitations.some(l=>l.includes('Market discovery is unavailable')));
});
test('Event route rejects malformed/repeated queries before provider calls',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;throw new Error();};for(const query of ['?league=basketball_nba&eventId=../../bad','?league=basketball_nba&eventId=event-a&eventId=event-b','?league=upcoming&eventId=event-a','?league=basketball_nba&eventId=event-a&markets=h2h,,totals','?league=basketball_nba&eventId=event-a&extra=yes'])assert.equal((await eventFn(req(query))).status,400);assert.equal(calls,0);
});
test('Event responses vary CDN cache on event id and markets',async()=>{
 installMock();const response=await eventFn(req('?league=basketball_nba&eventId=event-a&markets=h2h'));assert.equal(response.status,200);assert.match(response.headers.get('Netlify-Vary'),/eventId\|markets/);assert.match(response.headers.get('Netlify-CDN-Cache-Control'),/durable/);
});
test('Provider errors expose sanitized unavailable JSON and never sample prices',async()=>{
 for(const status of [401,403,429,500]){clearCacheForTests();installMock({failOdds:status});const response=await boardFn(new Request('https://example.test/api/board'));const body=await response.json();assert.ok(response.status>=400);assert.equal(body.events,undefined);assert.equal(body.normalized,undefined);assert.ok(!JSON.stringify(body).includes('private upstream'));assert.ok(!JSON.stringify(body).includes('mock-only-server-secret'));}
});
test('Missing key gives setup state without making any upstream request',async()=>{
 delete process.env.ODDS_API_KEY;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error();};const response=await eventFn(req('?league=basketball_nba&eventId=event-a'));assert.equal(response.status,503);assert.equal((await response.json()).code,'ODDS_NOT_CONFIGURED');assert.equal(calls,0);
});
test('Duplicate books, markets, outcomes and events cannot create duplicate quote rows',()=>{
 const raw=fixture();raw.bookmakers[0].markets[0].outcomes.push({...raw.bookmakers[0].markets[0].outcomes[0]});raw.bookmakers.push(structuredClone(raw.bookmakers[0]));const event=adaptOddsEvent(raw);const result=normalizeEvents([event,event]);assert.equal(event.bookmakers.length,4);assert.equal(result.events.length,1);assert.equal(result.quotes.length,8);assert.equal(new Set(result.quotes.map(q=>q.id)).size,8);
});
test('Repeated snapshots are cached and observed source points are not fabricated',async()=>{
 const mock=installMock();await loadEventDetails('basketball_nba','event-a',['h2h']);const count=mock.calls.length;await loadEventDetails('basketball_nba','event-a',['h2h']);assert.equal(mock.calls.length,count);assert.ok(movementsForEvent('event-a').every(s=>s.points.length===1));
});
test('Observed movement contains only supplied snapshots and a transparent first observed label',()=>{
 const now=Date.now(),event=adaptOddsEvent(fixture()),quote=normalizeEvents([event]).quotes[0];quote.timestamp=new Date(now-40000).toISOString();observeQuotes([quote],new Date(now).toISOString());observeQuotes([{...quote,timestamp:new Date(now-10000).toISOString(),price:quote.price+0.2}],new Date(now).toISOString());const movement=movementsForEvent(event.id)[0];assert.equal(movement.points.length,2);assert.equal(movement.openingPriceVerified,false);assert.equal(movement.label,'Price improving');assert.ok(Math.abs(movement.priceChange-0.2)<1e-9);
});
test('Unsafe deep links are dropped; provider HTTPS links remain usable',()=>{
 assert.equal(safeProviderLink('javascript:alert(1)'),null);assert.equal(safeProviderLink('https://secret:secret@example.com'),null);assert.equal(safeProviderLink('http://example.com'),null);assert.equal(safeProviderLink('https://sportsbook.example/event/a'),'https://sportsbook.example/event/a');
});
test('Closed or settled upstream markets cannot become available quotes',()=>{
 for(const status of ['closed','settled']){const raw=fixture();for(const book of raw.bookmakers)book.markets[0].status=status;const event=adaptOddsEvent(raw);assert.ok(normalizeEvents([event]).quotes.every(q=>q.suspended&&!q.available));assert.deepEqual(compareGroups(event),[]);}
});
test('A live quote without a market timestamp is unavailable even with a bookmaker timestamp',()=>{
 const raw=fixture({live:true});for(const book of raw.bookmakers)book.markets[0].last_update=null;const event=adaptOddsEvent(raw,{completed:false,scores:[{name:raw.home_team,score:10},{name:raw.away_team,score:9}],last_update:iso(-10000)});assert.equal(event.status,'live');assert.ok(normalizeEvents([event]).quotes.every(q=>q.timestamp===null&&!q.available));
});
test('Futures retain tournament title, real outcomes and unknown start time without invented teams',async()=>{
 const raw={id:'future-a',sport_key:'golf_pga_championship_winner',sport_title:'PGA Championship Winner',commence_time:null,home_team:null,away_team:null,bookmakers:[{key:'draftkings',title:'DraftKings',last_update:iso(-10000),markets:[{key:'outrights',last_update:iso(-10000),outcomes:[{name:'Player One',price:6},{name:'Player Two',price:8}]}]}]};
 const calls=[];globalThis.fetch=async url=>{const u=new URL(url);calls.push(u.pathname);if(u.pathname==='/v4/sports')return Response.json([{key:raw.sport_key,title:raw.sport_title,group:'Golf',active:true,has_outrights:true}]);if(u.pathname.endsWith('/events'))return Response.json([]);if(u.pathname.endsWith('/odds'))return Response.json([raw]);throw new Error('Futures must not request scores');};
 const board=await loadBoard(raw.sport_key,'outrights');assert.equal(board.events.length,1);const event=board.events[0];assert.equal(event.kind,'future');assert.equal(event.title,raw.sport_title);assert.equal(event.home_team,null);assert.equal(event.away_team,null);assert.equal(event.commence_time,null);assert.equal(event.status,'unknown');assert.equal(board.normalized.quotes.length,2);assert.equal(compareGroups(event,'outrights').length,2);assert.ok(!calls.some(p=>p.endsWith('/scores')));
});
test('A newer duplicate book without the old market cannot silently refresh that old quote',()=>{
 const raw=fixture();raw.bookmakers=raw.bookmakers.slice(0,1);raw.bookmakers[0].last_update=iso(-600000);raw.bookmakers[0].markets[0].last_update=null;raw.bookmakers.push({key:'fanduel',title:'FanDuel',last_update:iso(-10000),markets:[]});const event=adaptOddsEvent(raw);assert.ok(normalizeEvents([event]).quotes.every(q=>!q.available));assert.ok(compareGroups(event).every(g=>g.best===null));
});
test('Same-key markets with distinct settlement descriptions retain separate normalized groups',()=>{
 const raw=fixture();raw.bookmakers=raw.bookmakers.slice(0,1);const original=raw.bookmakers[0].markets[0];original.description='Regulation only';raw.bookmakers[0].markets.push({...structuredClone(original),description:'Including overtime'});const event=adaptOddsEvent(raw),normalized=normalizeEvents([event]);assert.equal(event.bookmakers[0].markets.length,2);assert.equal(normalized.quotes.length,4);assert.equal(new Set(normalized.quotes.map(q=>q.groupId)).size,4);assert.deepEqual(new Set(compareGroups(event).map(g=>g.id)),new Set(normalized.quotes.map(q=>q.groupId)));
});

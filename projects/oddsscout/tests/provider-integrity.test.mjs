import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {loadSports,loadAllBoardPage,loadEventDetails,configuredBooks,loadBoard} from '../server/provider.mjs';
import {adaptOddsEvent,adaptMarketAvailability,normalizeEvents} from '../server/adapters.mjs';
import {clearCacheForTests} from '../server/common.mjs';
import {clearObservationsForTests,observeQuotes,movementsForEvent} from '../server/observations.mjs';
import {BOOKS,canonicalSportsbookId} from '../public/lib/sportsbooks.mjs';
import boardRoute from '../netlify/functions/board.mjs';

const originalFetch=globalThis.fetch,keys=['ODDS_API_KEY','ODDS_BOOKMAKERS','ODDS_REGIONS','ACCESS_CODE'];
const originalEnv=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
beforeEach(()=>{clearCacheForTests();clearObservationsForTests();for(const key of keys)delete process.env[key];process.env.ODDS_API_KEY='provider-integrity-test-only';});
afterEach(()=>{globalThis.fetch=originalFetch;for(const key of keys){if(originalEnv[key]===undefined)delete process.env[key];else process.env[key]=originalEnv[key];}});
const iso=offset=>new Date(Date.now()+offset).toISOString();
const sports=[{key:'basketball_nba',title:'NBA',group:'Basketball',active:true,has_outrights:false}];
function event(){return {id:'integrity-event',sport_key:'basketball_nba',sport_title:'NBA',commence_time:iso(3600000),home_team:'Home',away_team:'Away',bookmakers:[{key:'espnbet',title:'Legacy name',last_update:iso(-10000),markets:[{key:'h2h',last_update:iso(-10000),outcomes:[{name:'Home',price:1.9},{name:'Away',price:2.1}]}]}]};}
function transport({catalog=sports,discoveryId='integrity-event',status=0,completed=false}={}){
 const fixture=event(),calls=[];if(completed)fixture.commence_time=iso(-3*3600000);
 globalThis.fetch=async url=>{
  const u=new URL(url);calls.push(u);
  if(u.pathname==='/v4/sports')return Response.json(catalog);
  if(u.pathname.endsWith('/markets'))return Response.json({id:discoveryId,sport_key:'basketball_nba',bookmakers:[{key:'thescore',markets:[{key:'player_points',last_update:iso(-20000)}]}]});
  if(u.pathname.endsWith('/events'))return Response.json([fixture]);
  if(u.pathname.endsWith('/scores'))return Response.json([{id:fixture.id,completed,scores:[{name:'Home',score:'100'},{name:'Away',score:'98'}],last_update:iso(-10000)}]);
  if(u.pathname.endsWith('/odds'))return status?new Response('private-error-with-secret',{status,headers:{'Retry-After':'75'}}):Response.json(u.pathname.includes('/events/')?fixture:[fixture]);
  throw new Error('Unexpected contract transport');
 };return {calls,fixture};
}

test('Catalog deduplicates identical active sports and rejects unsafe or conflicting identities',async()=>{
 transport({catalog:[...sports,...sports]});assert.equal((await loadSports()).sports.length,1);
 for(const catalog of [[{...sports[0],key:'../../unsafe'}],[sports[0],{...sports[0],has_outrights:true}],[{...sports[0],has_outrights:'false'}]]){
  clearCacheForTests();transport({catalog});await assert.rejects(loadSports(),{code:'BAD_FEED'});
 }
});
test('Provider aliases are one canonical book without merging state-specific Hard Rock feeds',()=>{
 const raw=event(),alias=structuredClone(raw.bookmakers[0]);alias.key='thescorebet';alias.markets[0].last_update=iso(-5000);alias.markets[0].outcomes[0].price=2;raw.bookmakers.push(alias);
 const result=adaptOddsEvent(raw),normalized=normalizeEvents([result]);assert.equal(result.bookmakers.length,1);assert.equal(result.bookmakers[0].title,'theScore Bet');assert.equal(normalized.books.length,1);assert.equal(normalized.quotes.length,2);assert.equal(normalized.quotes[0].sportsbookId,'espnbet');assert.equal(normalized.quotes[0].price,2);assert.deepEqual(result.bookmakers[0].providerKeys,['espnbet','thescorebet']);
 assert.equal(canonicalSportsbookId('hardrockbet'),'hardrockbet');assert.equal(canonicalSportsbookId('hardrockbet_oh'),'hardrockbet_oh');assert.equal(canonicalSportsbookId('constructor'),'constructor');
});
test('Explicit configuration aliases cannot request theScore twice',()=>{
 process.env.ODDS_BOOKMAKERS='espnbet,thescore,thescorebet,caesars,williamhill_us';assert.deepEqual(configuredBooks(),['espnbet','williamhill_us']);assert.equal(BOOKS.fanatics.providerPlan,'paid_subscription_required');assert.equal(BOOKS.williamhill_us.providerPlan,'paid_subscription_required');
});
test('Actual returned prices override a dated unsupported registry label without inventing state eligibility',async()=>{
 const raw=event();raw.bookmakers[0].key='bet365';const normalized=normalizeEvents([adaptOddsEvent(raw)]);assert.equal(normalized.books[0].providerCoverage,'returned_by_provider');assert.equal(normalized.books[0].registryProviderCoverage,'unsupported');assert.equal(normalized.quotes.length,2);
 transport();const board=await loadBoard();assert.deepEqual(board.sportsbookCoverage.map(row=>({id:row.sportsbookId,count:row.availableQuotes})),[{id:'espnbet',count:2}]);assert.ok(board.sportsbookCoverage[0].oldestSourceTimestamp);assert.equal(board.movementStorage.durable,false);
});
test('Score identities and nonblank values are required before a game becomes live',()=>{
 const raw=event();raw.commence_time=iso(-600000);
 const score={id:raw.id,completed:false,last_update:iso(-10000),scores:[{name:'Home',score:'10'},{name:'Away',score:'9'}]};
 assert.equal(adaptOddsEvent(raw,score).status,'live');
 for(const invalid of [{...score,id:'other'},{...score,sport_key:'baseball_mlb'},{...score,scores:[{name:'Wrong',score:'10'},{name:'Away',score:'9'}]},{...score,scores:[{name:'Home',score:'10'},{name:'Home',score:'9'}]},{...score,scores:[{name:'Home',score:''},{name:'Away',score:'9'}]}]){
  const normalized=adaptOddsEvent(raw,invalid);assert.equal(normalized.status,'unknown');assert.equal(normalized.scores,null);
 }
});
test('Market availability validates keys, merges aliases and preserves newest actual timestamp',()=>{
 const old=iso(-30000),recent=iso(-10000),rows=adaptMarketAvailability({bookmakers:[{key:'espnbet',markets:[{key:'h2h',last_update:old}]},{key:'thescore',markets:[{key:'h2h',last_update:recent},{key:'../unsafe',last_update:recent}]},{key:'../unsafe',markets:[{key:'totals'}]}]});
 assert.deepEqual(rows,[{sportsbookId:'espnbet',market:'h2h',timestamp:recent}]);
});
test('Mismatched market discovery cannot introduce another event markets into current prices',async()=>{
 transport({discoveryId:'another-event'});const detail=await loadEventDetails('basketball_nba','integrity-event',['h2h']);assert.deepEqual(detail.availableMarkets,['h2h']);assert.ok(detail.limitations.some(s=>s.includes('Market discovery is unavailable')));assert.equal(detail.normalized.quotes.length,2);
 clearCacheForTests();transport({discoveryId:'another-event'});await assert.rejects(loadEventDetails('basketball_nba','integrity-event',['available']),{code:'BAD_FEED'});
});
test('All upstream league failures produce a real API error without an empty live success',async()=>{
 for(const status of [500,403,429]){
  clearCacheForTests();transport({status});const response=await boardRoute(new Request('https://example.test/api/board?league=all'));assert.equal(response.status,status===500?502:status===403?503:429);const body=await response.json();assert.equal(body.mode,undefined);assert.equal(body.events,undefined);assert.ok(!JSON.stringify(body).includes('private-error-with-secret'));if(status===429)assert.equal(response.headers.get('Retry-After'),'75');
 }
});
test('Recently completed games are recognized and excluded from board polling',async()=>{
 const {calls}=transport({completed:true});const board=await loadBoard('basketball_nba');assert.deepEqual(board.events,[]);assert.ok(calls.some(url=>url.pathname.endsWith('/scores')&&url.searchParams.get('daysFrom')==='1'));
 const detail=await loadEventDetails('basketball_nba','integrity-event',['h2h']);assert.equal(detail.event.status,'completed');assert.equal(detail.refreshSeconds,null);assert.ok(detail.normalized.quotes.every(q=>!q.available));
});
test('Invalid event identity and blank or matching team names never become fixture records',()=>{
 const raw=event();for(const changed of [{id:'../../unsafe'},{home_team:''},{away_team:'Home'},{sport_key:'../../unsafe'}])assert.equal(adaptOddsEvent({...raw,...changed}),null);
});
test('All-futures pages use the discovered futures catalog rather than event-only leagues',async()=>{
 const futureKey='basketball_nba_championship_winner',fixture={id:'future-integrity',sport_key:futureKey,sport_title:'NBA Championship Winner',bookmakers:[{key:'draftkings',markets:[{key:'outrights',last_update:iso(-10000),outcomes:[{name:'Real provider selection',price:6}]}]}]},calls=[];
 globalThis.fetch=async url=>{const u=new URL(url);calls.push(u);if(u.pathname==='/v4/sports')return Response.json([...sports,{key:futureKey,title:'NBA Championship Winner',active:true,has_outrights:true}]);if(u.pathname.endsWith('/events'))return Response.json([]);if(u.pathname.endsWith('/odds'))return Response.json([fixture]);throw new Error('Futures must not request scores');};
 const result=await loadAllBoardPage('outrights');assert.equal(result.events.length,1);assert.equal(result.events[0].kind,'future');assert.deepEqual(result.batch.loaded.map(s=>s.key),[futureKey]);assert.ok(calls.filter(u=>u.pathname.endsWith('/odds')).every(u=>u.pathname.includes(futureKey)));
});
test('Movement source update and first server observation timestamps remain distinct',()=>{
 const quote=normalizeEvents([adaptOddsEvent(event())]).quotes[0],observedAt=iso(0);observeQuotes([quote],observedAt);const series=movementsForEvent(quote.eventId)[0];assert.equal(series.firstSourceTimestamp,quote.timestamp);assert.equal(series.firstObservedAt,observedAt);assert.notEqual(series.firstSourceTimestamp,series.firstObservedAt);observeQuotes([{...quote,timestamp:iso(-20000)}],'invalid-observation-time');assert.equal(movementsForEvent(quote.eventId)[0].points.length,1);
});

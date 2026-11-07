import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {loadBoard,LIVE_ENRICHMENT_LIMIT} from '../server/provider.mjs';
import {clearCacheForTests} from '../server/common.mjs';
import {clearObservationsForTests} from '../server/observations.mjs';

const originalFetch=globalThis.fetch,keys=['ODDS_API_KEY','ODDS_BOOKMAKERS','ODDS_REGIONS','ACCESS_CODE'];
const originalEnv=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
beforeEach(()=>{clearCacheForTests();clearObservationsForTests();for(const key of keys)delete process.env[key];process.env.ODDS_API_KEY='isolated-live-contract-key';});
afterEach(()=>{globalThis.fetch=originalFetch;for(const key of keys){if(originalEnv[key]===undefined)delete process.env[key];else process.env[key]=originalEnv[key];}});
const iso=offset=>new Date(Date.now()+offset).toISOString();
function makeEvent(id='live-0',{live=true,marketTimestamp=null}={}) {
 return {id,sport_key:'basketball_nba',sport_title:'NBA',commence_time:iso(live?-600000:3600000),home_team:`Contract home ${id}`,away_team:`Contract away ${id}`,bookmakers:[{key:'fanduel',title:'FanDuel',last_update:iso(-10000),markets:[{key:'h2h',last_update:marketTimestamp,outcomes:[{name:`Contract home ${id}`,price:1.9},{name:`Contract away ${id}`,price:2.1}]}]}]};
}
function transport({events=[makeEvent()],detailTimestamp=iso(-15000),detailFail=0,scoreFail=false,mismatch=false,detailDelay=0,stillMissing=false}={}) {
 const calls=[];let active=0,maxActive=0;
 globalThis.fetch=async url=>{
  const u=new URL(url);calls.push(u);assert.equal(u.searchParams.get('apiKey'),'isolated-live-contract-key');
  const headers={'x-requests-remaining':'300','x-requests-last':'2'};
  if(u.pathname==='/v4/sports')return Response.json([{key:'basketball_nba',title:'NBA',group:'Basketball',active:true,has_outrights:false}],{headers});
  if(u.pathname.endsWith('/events'))return Response.json(events,{headers});
  if(u.pathname.endsWith('/scores'))return scoreFail?new Response('{}',{status:500}):Response.json(events.map(event=>({id:event.id,completed:false,last_update:iso(-10000),scores:[{name:event.home_team,score:'10'},{name:event.away_team,score:'9'}]})),{headers});
  if(u.pathname.includes('/events/')&&u.pathname.endsWith('/odds')) {
   active++;maxActive=Math.max(maxActive,active);
   try {
    if(detailDelay)await new Promise(resolve=>setTimeout(resolve,detailDelay));
    if(detailFail)return new Response('{}',{status:detailFail,headers:{'retry-after':'65'}});
    const event=structuredClone(events.find(event=>u.pathname.includes(`/${event.id}/`)));
    for(const book of event.bookmakers){delete book.last_update;for(const market of book.markets)market.last_update=stillMissing?null:detailTimestamp;}
    if(mismatch)event.id='different-provider-event';
    return Response.json(event,{headers});
   }finally{active--;}
  }
  if(u.pathname.endsWith('/odds'))return Response.json(events,{headers});
  throw new Error('Unexpected isolated transport request');
 };
 return {calls,detailCalls:()=>calls.filter(u=>u.pathname.includes('/events/')&&u.pathname.endsWith('/odds')),maxActive:()=>maxActive};
}

test('Confirmed live broad odds lacking market timestamps load actual event-level timestamps',async()=>{
 const sourceTimestamp=iso(-25000),mock=transport({detailTimestamp:sourceTimestamp});
 const board=await loadBoard('basketball_nba');
 assert.equal(mock.detailCalls().length,1);assert.equal(board.events[0].status,'live');
 assert.ok(board.normalized.quotes.every(quote=>quote.available&&quote.timestamp===sourceTimestamp&&quote.timestampSource==='market'));
 const request=mock.detailCalls()[0];assert.equal(request.searchParams.get('markets'),'h2h');assert.equal(request.searchParams.get('regions'),'us,us2');
 assert.equal(request.searchParams.get('oddsFormat'),'decimal');assert.equal(board.refreshSeconds,30);
 assert.ok(!JSON.stringify(board).includes('isolated-live-contract-key'));
});
test('Failed event enrichment leaves missing-time quotes unavailable with an explicit warning',async()=>{
 transport({detailFail:500});const board=await loadBoard('basketball_nba');
 assert.equal(board.events[0].status,'live');assert.ok(board.normalized.quotes.every(quote=>!quote.available&&quote.timestamp===null));
 assert.ok(board.warnings.some(warning=>warning.includes('Live market timestamps unavailable')));
});
test('Pregame missing market timestamps do not consume extra event-detail requests',async()=>{
 const mock=transport({events:[makeEvent('pregame',{live:false})]});const board=await loadBoard('basketball_nba');
 assert.equal(mock.detailCalls().length,0);assert.equal(board.events[0].status,'upcoming');
 assert.ok(board.normalized.quotes.every(quote=>quote.available&&quote.timestampSource==='bookmaker'));
});
test('Already supplied live market timestamps are preserved without enrichment',async()=>{
 const sourceTimestamp=iso(-20000),mock=transport({events:[makeEvent('already-timed',{marketTimestamp:sourceTimestamp})]});
 const board=await loadBoard('basketball_nba');assert.equal(mock.detailCalls().length,0);
 assert.ok(board.normalized.quotes.every(quote=>quote.timestamp===sourceTimestamp&&quote.available));
});
test('Unconfirmed started games are not enriched or relabeled live after scores fail',async()=>{
 const mock=transport({scoreFail:true});const board=await loadBoard('basketball_nba');
 assert.equal(mock.detailCalls().length,0);assert.equal(board.events[0].status,'unknown');assert.equal(board.events[0].scores,null);
});
test('Live enrichment has deterministic six-event limit and concurrency of at most two',async()=>{
 const events=Array.from({length:LIVE_ENRICHMENT_LIMIT+2},(_,index)=>makeEvent(`live-${index}`)).reverse();
 const mock=transport({events,detailDelay:5});const board=await loadBoard('basketball_nba');
 assert.equal(mock.detailCalls().length,LIVE_ENRICHMENT_LIMIT);assert.equal(mock.maxActive(),2);
 assert.deepEqual(mock.detailCalls().map(u=>u.pathname.split('/').at(-2)),Array.from({length:LIVE_ENRICHMENT_LIMIT},(_,index)=>`live-${index}`));
 assert.equal(board.events.length,events.length);assert.equal(board.normalized.quotes.filter(quote=>quote.available).length,LIVE_ENRICHMENT_LIMIT*2);
 assert.ok(board.warnings.some(warning=>warning.includes('2 live games exceeded')));
});
test('Stale event timestamps retain their source age and never become fresh at response time',async()=>{
 const oldTimestamp=iso(-180000);transport({detailTimestamp:oldTimestamp});const board=await loadBoard('basketball_nba');
 assert.ok(board.normalized.quotes.every(quote=>quote.timestamp===oldTimestamp&&!quote.available));
 assert.notEqual(board.fetchedAt,oldTimestamp);
});
test('Event response still missing market timestamps stays unavailable without a bookmaker fallback',async()=>{
 transport({stillMissing:true});const board=await loadBoard('basketball_nba');
 assert.ok(board.normalized.quotes.every(quote=>quote.timestamp===null&&!quote.available));
 assert.ok(board.warnings.some(warning=>warning.includes('still omitted')));
});
test('Mismatched event-detail responses cannot substitute another game or source snapshot',async()=>{
 transport({mismatch:true});const board=await loadBoard('basketball_nba');
 assert.equal(board.events[0].id,'live-0');assert.ok(board.normalized.quotes.every(quote=>!quote.available));
 assert.ok(board.warnings.some(warning=>warning.includes('Live market timestamps unavailable')));
});
test('Repeated live board requests reuse the snapshot without changing quote source timestamps',async()=>{
 const sourceTimestamp=iso(-20000),mock=transport({detailTimestamp:sourceTimestamp});
 const first=await loadBoard('basketball_nba'),count=mock.calls.length,second=await loadBoard('basketball_nba');
 assert.equal(mock.calls.length,count);assert.equal(mock.detailCalls().length,1);assert.equal(first.fetchedAt,second.fetchedAt);
 assert.ok(second.normalized.quotes.every(quote=>quote.timestamp===sourceTimestamp));
});

import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import boardFn from '../netlify/functions/board.mjs';
import {loadAllBoardPage,loadBoard} from '../server/provider.mjs';
import {clearCacheForTests} from '../server/common.mjs';
import {mergeLeaguePage,matchesDate} from '../public/lib/board.mjs';
import {makeDemo,DEMO_SPORTS} from './fixtures/demo.mjs';
import {compareGroups,bestAppVerdict} from '../public/lib/odds.mjs';
const originalFetch=globalThis.fetch,originalKey=process.env.ODDS_API_KEY;
beforeEach(()=>{clearCacheForTests();process.env.ODDS_API_KEY='test-all-key-not-valid';});
afterEach(()=>{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.ODDS_API_KEY;else process.env.ODDS_API_KEY=originalKey;});
function mock({failure=null,empty=false,scoreFail=false}={}) {
 const source=makeDemo('all'),calls=[];
 globalThis.fetch=async url=>{
  const u=new URL(url);calls.push(u);const sport=u.pathname.split('/')[3];
  const headers={'x-requests-remaining':'400','x-requests-last':'1'};
  if(u.pathname.endsWith('/sports'))return Response.json(empty?[]:DEMO_SPORTS.map(s=>({...s,active:true,has_outrights:false})),{headers});
  if(failure?.sport===sport&&u.pathname.endsWith('/odds'))return new Response('{}',{status:failure.status,headers:{'retry-after':'90'}});
  const events=source.events.filter(e=>e.sport_key===sport);
  if(u.pathname.endsWith('/events'))return Response.json(events.map(({bookmakers,...e})=>e),{headers});
  if(u.pathname.endsWith('/odds'))return Response.json(events.filter(e=>e.bookmakers.length),{headers});
  if(u.pathname.endsWith('/scores'))return scoreFail?new Response('{}',{status:422}):Response.json(events.map(e=>({id:e.id,completed:false,scores:e.scores,last_update:e.scoreUpdatedAt})),{headers});
  throw new Error('Unexpected provider request');
 };
 return {source,calls};
}
const req=query=>new Request('https://example.test/api/board'+query);
test('All leagues are loaded across every page, without the upcoming shortcut',async()=>{
 const {source,calls}=mock();let next=0,merged=null,pages=0;
 while(next!==null){const part=await loadAllBoardPage('h2h',next);merged=mergeLeaguePage(merged,part);next=part.batch.nextPage;pages++;}
 assert.equal(pages,3);assert.equal(merged.events.length,source.events.length);
 assert.equal(merged.coverageInfo.loaded.length,DEMO_SPORTS.length);assert.equal(merged.coverageInfo.finished,true);
 assert.ok(calls.every(u=>!u.pathname.includes('/upcoming/')));
 assert.equal(calls.filter(u=>u.pathname.endsWith('/odds')).length,DEMO_SPORTS.length);
});
test('Specific league has no artificial 48-hour date cap',async()=>{
 const {calls}=mock();const b=await loadBoard('americanfootball_ncaaf');
 assert.equal(b.events.length,2);assert.ok(b.events.every(e=>Date.parse(e.commence_time)>Date.now()+48*3600000));
 assert.ok(calls.filter(u=>u.pathname.endsWith('/odds')).every(u=>!u.searchParams.has('commenceTimeTo')));
});
test('A listed fixture without selected-book odds remains on the board',async()=>{
 mock();const b=await loadBoard('icehockey_nhl');const event=b.events.find(e=>e.id==='demo-nhl-no-odds');
 assert.ok(event);assert.deepEqual(event.bookmakers,[]);assert.deepEqual(compareGroups(event),[]);
});
test('A failed league is named, other leagues are retained, and later pages remain loadable',async()=>{
 mock({failure:{sport:'americanfootball_ncaaf',status:500}});const b=await loadAllBoardPage('h2h',0);
 assert.equal(b.batch.failed[0].key,'americanfootball_ncaaf');assert.equal(b.batch.loaded.length,2);assert.equal(b.batch.nextPage,1);assert.ok(b.events.length>0);
});
test('Quota cooldown stops further page scanning without pretending coverage is complete',async()=>{
 mock({failure:{sport:'americanfootball_ncaaf',status:429}});const b=await loadAllBoardPage('h2h',0);
 assert.equal(b.batch.nextPage,null);assert.equal(b.batch.halted.code,'PROVIDER_LIMIT');assert.equal(b.batch.halted.retryAfter,90);
 assert.ok(b.batch.failed.length);assert.ok(b.batch.loaded.length<DEMO_SPORTS.length);
});
test('Live-score failures do not make a scheduled start into confirmed live status',async()=>{
 mock({scoreFail:true});const b=await loadBoard('americanfootball_nfl');assert.ok(b.warnings.length);
 assert.equal(b.events.find(e=>e.id==='demo-nfl-1').status,'unknown');
});
test('All-league route varies CDN cache by page as well as market and league',async()=>{
 mock();const r=await boardFn(req('?league=all&market=h2h&page=0'));
 assert.equal(r.status,200);assert.match(r.headers.get('Netlify-Vary'),/page/);assert.ok((await r.json()).batch);
});
test('Invalid and repeated page values are rejected',async()=>{
 mock();for(const q of ['?league=all&page=-1','?league=all&page=1.5','?league=all&page=01','?league=all&page=0&page=1','?league=all&page=9999','?league=baseball_mlb&page=1'])assert.equal((await boardFn(req(q))).status,400,q);
});
test('All-league response never leaks credentials',async()=>{
 mock();const body=await (await boardFn(req('?league=all'))).text();assert.ok(!body.includes(process.env.ODDS_API_KEY));
});
test('Repeated batch requests are cached',async()=>{
 const {calls}=mock();await loadAllBoardPage('h2h',0);const count=calls.length;await loadAllBoardPage('h2h',0);assert.equal(calls.length,count);
});
test('Empty sports catalog returns a complete zero-league scan',async()=>{
 mock({empty:true});const b=await loadAllBoardPage();assert.equal(b.batch.totalLeagues,0);assert.equal(b.batch.nextPage,null);assert.deepEqual(b.events,[]);
});
test('Page merging deduplicates event ids and preserves the oldest snapshot time',()=>{
 const old='2026-10-13T10:00:00Z',recent='2026-10-13T10:01:00Z';
 const a={events:[{id:'a',value:1}],fetchedAt:old,batch:{loaded:[{key:'one'}],failed:[],totalLeagues:2,nextPage:1}};
 const b={events:[{id:'a',value:2},{id:'b'}],fetchedAt:recent,batch:{loaded:[{key:'two'}],failed:[],totalLeagues:2,nextPage:null}};
 const merged=mergeLeaguePage(mergeLeaguePage(null,a),b);assert.equal(merged.events.length,2);assert.equal(merged.events[0].value,2);assert.equal(merged.fetchedAt,old);assert.equal(merged.coverageInfo.loaded.length,2);
});
test('The best app can differ for each side of the same game',()=>{
 const e=makeDemo().events[0],groups=compareGroups(e);
 assert.notEqual(groups[0].best.book,groups[1].best.book);assert.equal(bestAppVerdict(groups[0]).kind,'best');
});
test('Tied best quotes list every tied app',()=>{
 const e=makeDemo('all').events.find(e=>e.id==='demo-tennis-2');const g=compareGroups(e)[0];
 const v=bestAppVerdict(g);assert.equal(v.kind,'tie');assert.equal(v.books.length,3);
});
test('One fresh app is not advertised as a cross-app winner',()=>{
 const g=compareGroups(makeDemo().events[0],'h2h',{bookKeys:['fanduel']})[0];assert.equal(bestAppVerdict(g).kind,'single');
});
test('Stale prices have no winning app',()=>{
 const e=makeDemo().events[0],g=compareGroups(e,'h2h',{now:Date.now()+181000})[0];
 assert.equal(bestAppVerdict(g).kind,'unavailable');assert.deepEqual(bestAppVerdict(g).books,[]);
});
test('All dates does not hide future fixtures',()=>{
 const now=new Date(2026,9,13,12).getTime();assert.equal(matchesDate({commence_time:new Date(now+30*86400000).toISOString()},'all',now),true);
});
test('Today and Tomorrow use local calendar boundaries, not rolling 24 hours',()=>{
 const now=new Date(2026,9,13,23).getTime();const e={commence_time:new Date(2026,9,14,1).toISOString(),status:'upcoming'};
 assert.equal(matchesDate(e,'today',now),false);assert.equal(matchesDate(e,'tomorrow',now),true);
});
test('A game still confirmed live after midnight remains in Today',()=>{
 const now=new Date(2026,9,14,0,15).getTime(),e={commence_time:new Date(2026,9,13,23).toISOString(),status:'live'};
 assert.equal(matchesDate(e,'today',now),true);
});

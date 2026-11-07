import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import calendarFn from '../netlify/functions/calendar.mjs';
import {loadCalendar,readCalendarScope} from '../server/calendar.mjs';
import {clearCacheForTests} from '../server/common.mjs';

const originalFetch=globalThis.fetch,keys=['ODDS_API_KEY','ACCESS_CODE'],originalEnv=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
beforeEach(()=>{clearCacheForTests();for(const key of keys)delete process.env[key];});
afterEach(()=>{globalThis.fetch=originalFetch;for(const key of keys){if(originalEnv[key]===undefined)delete process.env[key];else process.env[key]=originalEnv[key];}});
const request=(query='',options={})=>new Request(`https://test.local/api/calendar${query}`,options);
const read=async response=>({status:response.status,headers:response.headers,body:await response.json()});
const league=(key,title=key)=>({key,title,active:true,has_outrights:false});
const nfl=league('americanfootball_nfl','NFL');
const future=hours=>new Date(Date.now()+hours*3600000).toISOString();
const fixture=(sport=nfl,{id='upcoming-1',time=future(24),...changes}={})=>({id,sport_key:sport.key,sport_title:sport.title,commence_time:time,home_team:'Home Team',away_team:'Away Team',...changes});

function installMock({sports=[nfl],schedules={},failure={},raw=null}={}) {
  process.env.ODDS_API_KEY='private-test-key';
  const calls=[];
  globalThis.fetch=async input=>{
    const url=new URL(input);calls.push(url);
    assert.equal(url.hostname,'api.the-odds-api.com');assert.equal(url.searchParams.get('apiKey'),'private-test-key');
    const headers={'x-requests-remaining':'500','x-requests-last':'0'};
    if(url.pathname==='/v4/sports')return Response.json(sports,{headers});
    assert.match(url.pathname,/^\/v4\/sports\/[a-z][a-z0-9_]*\/events$/,'Calendar only requests schedule events, never odds/scores/markets.');
    assert.deepEqual([...url.searchParams.keys()].sort(),['apiKey','dateFormat']);
    assert.equal(url.searchParams.get('dateFormat'),'iso');
    const key=url.pathname.split('/')[3],status=failure[key];
    if(status)return new Response('DO-NOT-LEAK-THIS-UPSTREAM-BODY',{status,headers:status===429?{'Retry-After':'91'}:{}});
    if(raw!==null)return new Response(raw,{status:200});
    return Response.json(schedules[key]??[fixture(sports.find(s=>s.key===key))],{headers});
  };
  return calls;
}

test('calendar requires the server odds key and never fabricates fixtures',async()=>{
  const r=await read(await calendarFn(request()));assert.equal(r.status,503);assert.equal(r.body.code,'ODDS_NOT_CONFIGURED');assert.equal(r.body.events,undefined);assert.equal(r.body.mode,undefined);
});
test('calendar accepts schedule query scope only',()=>{
  assert.deepEqual(readCalendarScope(new URL('https://test.local/api/calendar?league=all&page=1')),{league:'all',page:1});
  for(const suffix of ['?league=','?league=all&page=','?league=../../bad','?league=upcoming','?league=all&page=-1','?league=all&page=1.5','?league=all&page=01','?league=all&page=10000','?league=all&page=0&page=1','?league=americanfootball_nfl&page=0','?league=americanfootball_nfl&market=h2h','?timezone=America/New_York','?league=all&league=all'])assert.throws(()=>readCalendarScope(new URL('https://test.local/api/calendar'+suffix)),error=>error.code==='BAD_QUERY',suffix);
});
test('calendar rejects unsupported methods before any provider work',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('unexpected');};
  for(const method of ['POST','PUT','DELETE','HEAD'])assert.equal((await calendarFn(request('',{method}))).status,405);
  assert.equal(calls,0);
});
test('calendar room guard protects schedule data',async()=>{
  process.env.ACCESS_CODE='room-secret';assert.equal((await calendarFn(request())).status,401);
});
test('calendar normalizes real provider fixture IDs and ISO start times without prices',async()=>{
  const calls=installMock({schedules:{americanfootball_nfl:[fixture(nfl,{time:future(24).replace('Z','+00:00')})]}});
  const r=await read(await calendarFn(request('?league=americanfootball_nfl')));
  assert.equal(r.status,200);assert.equal(r.body.mode,'live');assert.equal(r.body.source,'The Odds API');assert.equal(r.body.refreshSeconds,300);assert.equal(r.body.events.length,1);
  assert.deepEqual(Object.keys(r.body.events[0]).sort(),['away_team','bookmakers','commence_time','home_team','id','sport_key','sport_title','status']);
  assert.equal(r.body.events[0].status,'upcoming');assert.equal(r.body.events[0].sport_title,'NFL');assert.match(r.body.events[0].commence_time,/Z$/);assert.deepEqual(r.body.events[0].bookmakers,[]);assert.equal(r.body.usage.cost,0);assert.equal(calls.length,2);
  assert.ok(!JSON.stringify(r.body).includes('private-test-key'));assert.match(r.body.coverage,/not a complete season calendar/);assert.match(r.body.limitations.join(' '),/not a promise that odds are available/);
});
test('schedule listings are sorted, deduplicated and exclude already-started games',async()=>{
  const a=fixture(nfl,{id:'later',time:future(40)}),b=fixture(nfl,{id:'earlier',time:future(10)});
  installMock({schedules:{americanfootball_nfl:[a,b,a,fixture(nfl,{id:'past',time:future(-3)})]}});
  const r=await loadCalendar(nfl.key);assert.deepEqual(r.events.map(e=>e.id),['earlier','later']);
});
test('valid empty schedule remains an honest empty result',async()=>{
  installMock({schedules:{americanfootball_nfl:[]}});const r=await read(await calendarFn(request()));assert.equal(r.status,200);assert.deepEqual(r.body.events,[]);assert.deepEqual(r.body.warnings,[]);
});
test('schedule with only past fixtures has no upcoming events, not invented replacements',async()=>{
  installMock({schedules:{americanfootball_nfl:[fixture(nfl,{time:future(-20)})]}});assert.deepEqual((await loadCalendar()).events,[]);
});
test('partially malformed feed explains dropped rows and preserves valid future fixtures',async()=>{
  installMock({schedules:{americanfootball_nfl:[fixture(),fixture(nfl,{id:'broken',time:'not-a-date'}),fixture(nfl,{id:'wrong-sport',sport_key:'basketball_nba'})]}});
  const r=await loadCalendar();assert.equal(r.events.length,1);assert.match(r.warnings[0],/2 invalid schedule rows were omitted/);
});
test('wholly invalid schedule rows cannot become a successful empty calendar',async()=>{
  for(const invalid of [fixture(nfl,{id:'bad/id'}),fixture(nfl,{time:'broken'}),fixture(nfl,{home_team:''}),fixture(nfl,{away_team:'Home Team'}),fixture(nfl,{home_team:'x'.repeat(181)})]){
    clearCacheForTests();installMock({schedules:{americanfootball_nfl:[invalid]}});const r=await read(await calendarFn(request()));assert.equal(r.status,502);assert.equal(r.body.code,'BAD_FEED');assert.equal(r.body.events,undefined);
  }
});
test('conflicting event identifiers fail rather than silently choosing one fixture',async()=>{
  installMock({schedules:{americanfootball_nfl:[fixture(),fixture(nfl,{away_team:'Different Team'})]}});const r=await read(await calendarFn(request()));assert.equal(r.status,502);assert.equal(r.body.code,'BAD_FEED');
});
test('schedule errors preserve access status and never leak the upstream body',async()=>{
  for(const [status,expected] of [[500,502],[401,503],[403,503],[422,422],[429,429]]){
    clearCacheForTests();installMock({failure:{americanfootball_nfl:status}});const r=await read(await calendarFn(request()));assert.equal(r.status,expected);assert.equal(r.body.events,undefined);assert.ok(!JSON.stringify(r.body).includes('DO-NOT-LEAK'));assert.ok(!JSON.stringify(r.body).includes('private-test-key'));if(status===429)assert.equal(r.headers.get('Retry-After'),'91');
  }
});
test('bad JSON and non-array schedules return JSON unavailable errors',async()=>{
  for(const raw of ['<html>error</html>','{}']){
    clearCacheForTests();installMock({raw});const r=await read(await calendarFn(request()));assert.equal(r.status,502);assert.equal(r.body.code,'BAD_FEED');assert.equal(r.body.events,undefined);
  }
});
test('unknown and futures-only leagues are rejected before schedule calls',async()=>{
  const calls=installMock({sports:[nfl,{...league('americanfootball_nfl_super_bowl_winner'),has_outrights:true}]});
  for(const key of ['not_a_league','americanfootball_nfl_super_bowl_winner'])assert.equal((await calendarFn(request(`?league=${key}`))).status,400);
  assert.equal(calls.length,1);
});
test('all-league schedule batches are bounded and use the active catalog',async()=>{
  const sports=[nfl,league('basketball_nba','NBA'),league('icehockey_nhl','NHL'),league('soccer_epl','EPL')];
  const calls=installMock({sports});const a=await loadCalendar('all',0),b=await loadCalendar('all',1);
  assert.equal(a.batch.totalPages,2);assert.equal(a.batch.nextPage,1);assert.equal(a.batch.loaded.length,3);assert.equal(a.batch.totalLeagues,4);assert.equal(a.events.length,3);assert.equal(b.events.length,1);assert.equal(b.batch.nextPage,null);assert.equal(calls.filter(u=>u.pathname.endsWith('/events')).length,4);
});
test('out-of-range batch does not fetch any schedule',async()=>{
  const calls=installMock();const r=await read(await calendarFn(request('?league=all&page=1')));assert.equal(r.status,400);assert.equal(r.body.code,'BAD_PAGE');assert.equal(calls.length,1);
});
test('partial all-league failure is visible and does not cache incomplete coverage at the CDN',async()=>{
  installMock({sports:[nfl,league('basketball_nba','NBA')],failure:{basketball_nba:500}});
  const r=await read(await calendarFn(request('?league=all')));assert.equal(r.status,200);assert.equal(r.body.events.length,1);assert.equal(r.body.batch.loaded.length,1);assert.deepEqual(r.body.batch.failed.map(f=>f.key),['basketball_nba']);assert.match(r.body.warnings.join(' '),/not represented by empty dates/);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Netlify-CDN-Cache-Control'),null);
});
test('all-league complete outage returns an error instead of apparent empty success',async()=>{
  installMock({sports:[nfl,league('basketball_nba','NBA')],failure:{americanfootball_nfl:500,basketball_nba:500}});
  const r=await read(await calendarFn(request('?league=all')));assert.equal(r.status,502);assert.equal(r.body.events,undefined);assert.equal(r.body.mode,undefined);
});
test('all-league cooldown stops subsequent league requests and retains successful coverage',async()=>{
  const sports=[nfl,league('basketball_nba','NBA'),league('icehockey_nhl','NHL')];
  const calls=installMock({sports,failure:{americanfootball_nfl:429}});const r=await read(await calendarFn(request('?league=all')));
  assert.equal(r.status,200);assert.equal(r.body.batch.halted.code,'PROVIDER_LIMIT');assert.equal(r.body.batch.halted.retryAfter,91);assert.equal(r.body.batch.nextPage,null);assert.ok(r.body.batch.failed.length);assert.ok(calls.length<=4);assert.equal(r.headers.get('Netlify-CDN-Cache-Control'),null);
});
test('calendar snapshots are cached without another upstream schedule request',async()=>{
  const calls=installMock();const a=await loadCalendar(),b=await loadCalendar();assert.equal(calls.length,2);assert.equal(a.fetchedAt,b.fetchedAt);
});
test('a warm cached fixture is removed after kickoff without needing another upstream request',async()=>{
  const originalNow=Date.now,base=originalNow();
  try {
    Date.now=()=>base;
    const calls=installMock({schedules:{americanfootball_nfl:[fixture(nfl,{time:new Date(base+60000).toISOString()})]}});
    assert.equal((await loadCalendar()).events.length,1);
    Date.now=()=>base+61000;
    assert.deepEqual((await loadCalendar()).events,[]);assert.equal(calls.length,2);
  }finally{Date.now=originalNow;}
});
test('unsafe upstream catalog keys cannot be interpolated into schedule paths',async()=>{
  const calls=installMock({sports:[nfl,league('../bad')]});const r=await read(await calendarFn(request('?league=all')));assert.equal(r.status,502);assert.equal(r.body.code,'BAD_FEED');assert.equal(calls.length,1);
});
test('public calendar cache varies by league and page with a finite five-minute TTL',async()=>{
  installMock();const r=await calendarFn(request());assert.match(r.headers.get('Netlify-CDN-Cache-Control'),/^public, durable, max-age=\d+$/);assert.equal(r.headers.get('Netlify-Vary'),'query=league|page');
});
test('room-authorized calendar never receives public CDN caching',async()=>{
  installMock();process.env.ACCESS_CODE='private-room';const r=await calendarFn(request('',{headers:{'X-Room-Code':'private-room'}}));assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Netlify-CDN-Cache-Control'),null);
});

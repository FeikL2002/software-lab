import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/performance.mjs';
import {readPerformanceScope,performanceParameters,normalizePlayerResult,summarizePlayerRows} from '../server/performance-provider.mjs';
import {clearCacheForTests} from '../server/common.mjs';

const oldFetch=globalThis.fetch,keys=['BALLDONTLIE_API_KEY','ACCESS_CODE'],oldEnv=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
beforeEach(()=>{clearCacheForTests();for(const k of keys)delete process.env[k];});
afterEach(()=>{globalThis.fetch=oldFetch;for(const k of keys)if(oldEnv[k]===undefined)delete process.env[k];else process.env[k]=oldEnv[k];});
const req=(query='league=basketball_nba&playerId=7&statType=pts&line=24.5&window=5',init={})=>new Request('https://example.test/api/performance?'+query,init);
const team={id:1,full_name:'Verified Home'},opponent={id:2,full_name:'Verified Away'},player={id:7,first_name:'Test',last_name:'Player',team},yesterday=new Date(Date.now()-86400000).toISOString();
const game=(extra={})=>({id:17,datetime:yesterday,status_state:'final',status:'Final',home_team:team,visitor_team:opponent,home_team_id:1,visitor_team_id:2,...extra});
const row=(extra={})=>({player,team,game:game(),pts:25,reb:4,ast:3,...extra});
function mockedProvider({statRows=[row()],players=[player],next=null,error=null}={}){
 const calls=[];
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);calls.push(u);assert.equal(options.headers.Authorization,'test-player-key');assert.ok(!u.href.includes('test-player-key'));
  if(error)return new Response('upstream secret',{status:error,headers:{'retry-after':'75'}});
  if(u.pathname.endsWith('/players/7'))return Response.json({data:player});
  if(u.pathname.endsWith('/players'))return Response.json({data:players,meta:{next_cursor:null}});
  if(u.pathname.endsWith('/teams'))return Response.json({data:[team,opponent],meta:{next_cursor:null}});
  if(u.pathname.endsWith('/games'))return Response.json({data:[game({away_team:opponent,date:yesterday,season_type:'regular'})],meta:{next_cursor:null}});
  return Response.json({data:statRows,meta:{next_cursor:next}});
 };
 return calls;
}
test('Missing results key returns explicit JSON error without fake rows',async()=>{const response=await handler(req());assert.equal(response.status,503);const body=await response.json();assert.equal(body.code,'PERFORMANCE_NOT_CONFIGURED');assert.equal(body.rows,undefined);});
test('Performance endpoint methods, duplicate params and unsafe identifiers are rejected',async()=>{assert.equal((await handler(req('',{method:'POST'}))).status,405);for(const q of ['league=basketball_nba&playerId=-1&statType=pts','league=basketball_nba&playerId=7&player=A&statType=pts','league=basketball_nba&playerId=7&statType=pts&window=7','league=basketball_nba&playerId=7&statType=pts&line=NaN','league=basketball_nba&playerId=7&statType=pts&line=1&line=2','league=basketball_nba&playerId=7&statType=pts&token=x'])assert.equal((await handler(req(q))).status,400);});
test('Unsupported league and stat type are explicit',async()=>{assert.equal((await handler(req('league=soccer_epl&playerId=7&statType=goals'))).status,422);assert.equal((await handler(req('league=basketball_nba&playerId=7&statType=passing_yards'))).status,422);});
test('Player results remain protected behind optional room code',async()=>{process.env.ACCESS_CODE='room-key';const response=await handler(req());assert.equal(response.status,401);assert.equal((await response.json()).code,'ROOM_LOCKED');});
test('Normalized player rows require final dated real results, exact identity and numerical value',()=>{
 const spec={league:'basketball_nba',statType:'pts',playerId:7};assert.equal(normalizePlayerResult(row(),spec).value,25);
 for(const changes of [{pts:null},{pts:'25'},{game:game({status_state:'in_progress'})},{game:game({datetime:'bad'})},{game:game({datetime:new Date(Date.now()+86400000).toISOString()})},{player:{id:8}},{team:{id:5}}])assert.equal(normalizePlayerResult(row(changes),spec),null);
 assert.equal(normalizePlayerResult(row({pts:0}),spec).value,0);assert.equal(normalizePlayerResult(row(),{...spec,statType:'pts_reb_ast'}).value,32);assert.equal(normalizePlayerResult(row({reb:null}),{...spec,statType:'pts_reb_ast'}),null);
});
test('Home/away and opponent come from verified matching team identity',()=>{const r=normalizePlayerResult(row({team:opponent}),{league:'basketball_nba',statType:'pts',playerId:7});assert.equal(r.homeAway,'away');assert.equal(r.opponent,'Verified Home');});
test('Summary uses requested sample size and separates above/below/pushes without forecasts',()=>{const values=[25,10,24.5];const r=summarizePlayerRows(values.map((value,i)=>({value,date:new Date(Date.now()-(i+1)*86400000).toISOString()})),{window:5,line:24.5});assert.equal(r.summary.sampleSize,3);assert.equal(r.summary.average,(25+10+24.5)/3);assert.equal(r.summary.over,1);assert.equal(r.summary.under,1);assert.equal(r.summary.push,1);assert.equal(r.summary.hitRate,1/3);assert.equal(r.summary.partial,true);assert.equal(summarizePlayerRows([]).summary.average,null);});
test('NBA request parameters use date scope and full game period',()=>{const p=performanceParameters('basketball_nba',7,Date.parse('2026-01-10T12:00:00Z'));assert.equal(p.get('period'),'0');assert.equal(p.get('player_ids[]'),'7');assert.equal(p.get('end_date'),'2026-01-10');const nfl=performanceParameters('americanfootball_nfl',7,Date.parse('2026-01-10T12:00:00Z'));assert.deepEqual(nfl.getAll('seasons[]'),['2025','2024']);});
test('Real-provider-shaped player response is cached, scoped and never leaks key',async()=>{process.env.BALLDONTLIE_API_KEY='test-player-key';const calls=mockedProvider();const response=await handler(req());assert.equal(response.status,200);assert.match(response.headers.get('Netlify-Vary'),/playerId\|player/);const body=await response.json();assert.equal(body.mode,'live');assert.equal(body.player.name,'Test Player');assert.equal(body.complete,true);assert.equal(body.rows.length,1);assert.equal(body.summary.sampleSize,1);assert.ok(!JSON.stringify(body).includes('test-player-key'));await handler(req());assert.equal(calls.length,3);});
test('Exact player name resolution accepts no fuzzy or ambiguous match',async()=>{process.env.BALLDONTLIE_API_KEY='test-player-key';mockedProvider();const response=await handler(req('league=basketball_nba&player=Test+Player&statType=pts'));assert.equal(response.status,200);clearCacheForTests();mockedProvider({players:[player,{...player,id:8}]});const ambiguous=await handler(req('league=basketball_nba&player=Test+Player&statType=pts'));assert.equal(ambiguous.status,422);clearCacheForTests();mockedProvider();const fuzzy=await handler(req('league=basketball_nba&player=Test&statType=pts'));assert.equal(fuzzy.status,422);});
test('Provider rate limits carry safe retry delay and no fake fallback',async()=>{process.env.BALLDONTLIE_API_KEY='test-player-key';const calls=mockedProvider({error:429});const response=await handler(req());assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'75');const text=await response.text();assert.ok(!text.includes('upstream secret'));await handler(req());assert.equal(calls.length,1);});
test('Failed provider access and outage retain unavailable states',async()=>{process.env.BALLDONTLIE_API_KEY='test-player-key';for(const status of [401,403,500]){clearCacheForTests();mockedProvider({error:status});const response=await handler(req());assert.equal(response.status,status===500?502:503);const body=await response.json();assert.equal(body.rows,undefined);assert.equal(body.mode,undefined);}});
test('Incomplete pagination is visibly partial and cannot establish last-N games',async()=>{process.env.BALLDONTLIE_API_KEY='test-player-key';mockedProvider({next:10});const body=await (await handler(req())).json();assert.equal(body.complete,false);assert.equal(body.summary.partial,true);assert.match(body.summary.description,/cannot establish/);assert.equal(body.rows.length,1);});
test('MLB game IDs are joined to a verified completed schedule before counting stats',async()=>{process.env.BALLDONTLIE_API_KEY='test-player-key';mockedProvider({statRows:[{player,team,game_id:17,hits:2}]});const body=await (await handler(req('league=baseball_mlb&playerId=7&statType=hits&line=1.5'))).json();assert.equal(body.rows[0].value,2);assert.match(body.sampleScope,/Current-team/);assert.ok(body.limitations.some(l=>l.includes('previous team')));});
test('NHL box score adapter uses source final state and existing value only',()=>{const r=normalizePlayerResult({player,team,game:game({status_state:'final',away_team:opponent,visitor_team:undefined,start_time_utc:yesterday}),shots_on_goal:3},{league:'icehockey_nhl',statType:'shots_on_goal',playerId:7});assert.equal(r.value,3);assert.equal(r.completed,true);});
test('Performance parser trims names but validates unique known parameters',()=>{const scope=readPerformanceScope(new URL('https://test.local?league=basketball_nba&player=Test%20Player&statType=pts&window=20'));assert.equal(scope.window,20);assert.equal(scope.player,'Test Player');});

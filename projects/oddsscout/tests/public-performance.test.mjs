import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/performance.mjs';
import {clearCacheForTests} from '../server/common.mjs';
import {espnStatValue,normalizeEspnPlayerRow,normalizeMlbPlayerRow,inningsToOuts} from '../server/public-performance.mjs';

const oldFetch=globalThis.fetch,oldKey=process.env.BALLDONTLIE_API_KEY,oldRoom=process.env.ACCESS_CODE;
beforeEach(()=>{clearCacheForTests();delete process.env.BALLDONTLIE_API_KEY;delete process.env.ACCESS_CODE;});
afterEach(()=>{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.BALLDONTLIE_API_KEY;else process.env.BALLDONTLIE_API_KEY=oldKey;if(oldRoom===undefined)delete process.env.ACCESS_CODE;else process.env.ACCESS_CODE=oldRoom;});
const player={id:3139477,name:'Patrick Mahomes'},scope={league:'americanfootball_nfl',statType:'passing_yards',window:5,line:225.5,player:'Patrick Mahomes',playerId:null,provider:'public'};
const date=new Date(Date.now()-86400000).toISOString(),event={id:'401234567',gameDate:date,atVs:'@',homeTeamId:'13',awayTeamId:'12',team:{id:'12'},opponent:{id:'13',displayName:'Las Vegas Raiders'}};
const finalStatus={type:{name:'STATUS_FINAL',completed:true,state:'post'}};
const body={names:['passingYards','rushingYards'],events:{[event.id]:event},seasonTypes:[{displayName:'2026 Regular Season',categories:[{type:'event',events:[{eventId:event.id,stats:['225','17']}]}]}],filters:[{name:'season',value:'2026',options:[{value:'2026'}]}]};
const req=(q='league=americanfootball_nfl&player=Patrick+Mahomes&statType=passing_yards&window=5&line=225.5&provider=public')=>new Request('https://oddsscout.test/api/performance?'+q);
function mockEspn({log=body,status=finalStatus,search=null,fail=null}={}){
 const calls=[];
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);calls.push(u);assert.equal(options.headers.Authorization,undefined);assert.ok(options.signal);
  if(fail)return new Response('private upstream failure',{status:fail,headers:{'retry-after':'90'}});
  if(u.hostname==='site.web.api.espn.com'&&u.pathname.includes('/search/'))return Response.json(search||{results:[{type:'player',totalFound:1,contents:[{uid:'s:20~l:28~a:3139477',displayName:'Patrick Mahomes',defaultLeagueSlug:'nfl',sport:'football'}]}]});
  if(u.pathname.endsWith('/gamelog'))return Response.json(log);
  if(u.pathname.endsWith('/status'))return Response.json(status);
  throw new Error('Unexpected endpoint '+u.hostname+u.pathname);
 };
 return calls;
}
test('ESPN field mapping follows source names rather than positions or reused YDS labels',()=>{
 assert.equal(espnStatValue(['rushingYards','passingYards'],['17','225'],'passing_yards','americanfootball_nfl'),225);
 assert.equal(espnStatValue(['passingYards','rushingYards'],['225','17'],'rushing_yards','americanfootball_nfl'),17);
 assert.equal(espnStatValue(['passingYards','passingYards'],['225','17'],'passing_yards','americanfootball_nfl'),null);
 assert.equal(espnStatValue(['passingYards'],['--'],'passing_yards','americanfootball_nfl'),null);
 assert.equal(espnStatValue(['rushingYards'],['-4'],'rushing_yards','americanfootball_nfl'),-4);
});
test('NBA combined fields and made-attempted threes never parse attempts as makes',()=>{
 assert.equal(espnStatValue(['points','totalRebounds','assists'],['24','12','3'],'pts_reb_ast','basketball_nba'),39);
 assert.equal(espnStatValue(['threePointFieldGoalsMade-threePointFieldGoalsAttempted'],['2-6'],'fg3m','basketball_nba'),2);
 assert.equal(espnStatValue(['threePointFieldGoalsMade-threePointFieldGoalsAttempted'],['7-6'],'fg3m','basketball_nba'),null);
 assert.equal(espnStatValue(['points','totalRebounds','assists'],['24','--','3'],'pts_reb_ast','basketball_nba'),null);
});
test('ESPN player rows need separately confirmed final status and matching opponent/home-away',()=>{
 const spec={scope,player,finalStatus};assert.equal(normalizeEspnPlayerRow(event,['225','17'],body,spec).value,225);
 for(const changed of [{type:{name:'STATUS_IN_PROGRESS',state:'in',completed:false}},{type:{name:'STATUS_POSTPONED',state:'post',completed:true}},null])assert.equal(normalizeEspnPlayerRow(event,['225','17'],body,{...spec,finalStatus:changed}),null);
 assert.equal(normalizeEspnPlayerRow({...event,opponent:{id:'99',displayName:'Wrong opponent'}},['225','17'],body,spec),null);
 assert.equal(normalizeEspnPlayerRow({...event,atVs:'vs'},['225','17'],body,spec),null);
 assert.equal(normalizeEspnPlayerRow({...event,gameDate:new Date(Date.now()+86400000).toISOString()},['225','17'],body,spec),null);
});
test('Full-name public lookup works with no credential and exposes actual source and partial sample',async()=>{
 const calls=mockEspn(),response=await handler(req());assert.equal(response.status,200);const data=await response.json();
 assert.equal(data.mode,'live');assert.equal(data.provider,'espn');assert.equal(data.rows.length,1);assert.equal(data.rows[0].completed,true);assert.equal(data.rows[0].source,'ESPN NFL player game logs');assert.equal(data.rows[0].providerUpdatedAt,null);assert.equal(data.summary.partial,true);assert.equal(data.summary.over,0);assert.equal(data.summary.under,1);assert.ok(data.sourceSelection.includes('explicitly selected'));assert.match(response.headers.get('Netlify-Vary'),/provider/);
 await handler(req());assert.equal(calls.length,3);
});
test('Publisher search explicitly requests player records rather than default media results',async()=>{
 const calls=mockEspn(),response=await handler(req());assert.equal(response.status,200);const search=calls.find(u=>u.pathname.includes('/search/'));assert.equal(search.searchParams.get('type'),'player');assert.equal(search.searchParams.get('query'),'Patrick Mahomes');
});
test('Publisher result-type total prevents hidden truncated exact-name matches',async()=>{
 mockEspn({search:{results:[{type:'player',totalFound:1,contents:[{uid:'s:20~l:28~a:3139477',displayName:'Patrick Mahomes',defaultLeagueSlug:'nfl',sport:'football'}]}],resultTypes:[{type:'player',totalFound:21}]}});assert.equal((await handler(req())).status,422);
});
test('Automatic provider selection discloses why the real public source was chosen',async()=>{
 mockEspn();const data=await (await handler(req('league=americanfootball_nfl&player=Patrick+Mahomes&statType=passing_yards'))).json();assert.equal(data.provider,'espn');assert.match(data.sourceSelection,/No BALLDONTLIE key/);
});
test('Exact-name lookup rejects fuzzy, cross-league, ambiguous and truncated searches',async()=>{
 for(const contents of [[{uid:'s:20~l:28~a:3139477',displayName:'Patrick Mahomes II',defaultLeagueSlug:'nfl',sport:'football'}],[{uid:'s:40~l:46~a:3139477',displayName:'Patrick Mahomes',defaultLeagueSlug:'nba',sport:'basketball'}],[{uid:'s:20~l:28~a:3139477',displayName:'Patrick Mahomes',defaultLeagueSlug:'nfl',sport:'football'},{uid:'s:20~l:28~a:3139478',displayName:'Patrick Mahomes',defaultLeagueSlug:'nfl',sport:'football'}]]){
  clearCacheForTests();mockEspn({search:{results:[{type:'player',totalFound:contents.length,contents}]}});assert.equal((await handler(req())).status,422);
 }
 clearCacheForTests();mockEspn({search:{results:[{type:'player',totalFound:21,contents:[{uid:'s:20~l:28~a:3139477',displayName:'Patrick Mahomes',defaultLeagueSlug:'nfl',sport:'football'}]}]}});assert.equal((await handler(req())).status,422);
});
test('Preseason and summary/aggregate categories never count as completed player appearances',async()=>{
 mockEspn({log:{...body,seasonTypes:[{displayName:'2026 Preseason',categories:body.seasonTypes[0].categories},{displayName:'2026 Regular Season',categories:[{type:'total',events:[{eventId:event.id,stats:['9999','999']}]}]}]}});
 const data=await (await handler(req())).json();assert.equal(data.rows.length,0);assert.equal(data.summary.average,null);
});
test('Unconfirmed final statuses are excluded and visibly mark the sample incomplete',async()=>{
 mockEspn({status:{type:{state:'in',name:'STATUS_IN_PROGRESS',completed:false}}});const data=await (await handler(req())).json();assert.equal(data.rows.length,0);assert.equal(data.complete,false);assert.equal(data.summary.average,null);assert.ok(data.limitations.some(l=>l.includes('could not be verified')));
});
test('A missing player stat category returns an explicit unavailable response instead of zeroes',async()=>{
 mockEspn({log:{...body,names:['receptions','receivingYards']}});const response=await handler(req());assert.equal(response.status,422);assert.equal((await response.json()).code,'PERFORMANCE_STAT_UNAVAILABLE');
});
test('Public provider outages and cooldown never return fixture or stale replacement rows',async()=>{
 for(const code of [429,500]){clearCacheForTests();mockEspn({fail:code});const response=await handler(req());assert.equal(response.status,code===429?429:502);const data=await response.json();assert.equal(data.rows,undefined);assert.equal(data.mode,undefined);assert.ok(!JSON.stringify(data).includes('private upstream failure'));if(code===429)assert.equal(response.headers.get('Retry-After'),'90');}
});
test('MLB pitching innings convert to outs without decimal multiplication',()=>{assert.equal(inningsToOuts('6.2'),20);assert.equal(inningsToOuts('0.1'),1);assert.equal(inningsToOuts('6.3'),null);assert.equal(inningsToOuts('6.25'),null);});
const mlbPlayer={id:592450,name:'Aaron Judge'},mlbScope={league:'baseball_mlb',statType:'hits'},mlbGame={gamePk:12345,gameDate:date,gameType:'R',status:{abstractGameState:'Final'},teams:{home:{team:{id:147,name:'New York Yankees'}},away:{team:{id:137,name:'San Francisco Giants'}}}},mlbSplit={game:{gamePk:12345},player:{id:592450},sport:{id:1},gameType:'R',team:{id:147},opponent:{id:137},date:date.slice(0,10),stat:{hits:0}};
test('MLB counts real zeroes but rejects absent stats, nonfinal, wrong player, opponent and game',()=>{
 const spec={scope:mlbScope,player:mlbPlayer};assert.equal(normalizeMlbPlayerRow(mlbSplit,mlbGame,spec).value,0);
 for(const change of [{stat:{hits:null}},{player:{id:9}},{opponent:{id:9}},{sport:{id:11}},{gameType:'S'}])assert.equal(normalizeMlbPlayerRow({...mlbSplit,...change},mlbGame,spec),null);
 assert.equal(normalizeMlbPlayerRow(mlbSplit,{...mlbGame,status:{abstractGameState:'Live'}},spec),null);assert.equal(normalizeMlbPlayerRow(mlbSplit,{...mlbGame,gamePk:999},spec),null);
 assert.equal(normalizeMlbPlayerRow({...mlbSplit,stat:{inningsPitched:'6.2'}},mlbGame,{...spec,scope:{...mlbScope,statType:'pitching_outs'}}).value,20);
});
test('MLB official endpoint joins actual player logs to final schedule in three bounded calls',async()=>{
 const calls=[];globalThis.fetch=async url=>{const u=new URL(url);calls.push(u);assert.equal(u.hostname,'statsapi.mlb.com');if(u.pathname.endsWith('/people/search'))return Response.json({people:[{id:592450,fullName:'Aaron Judge',isPlayer:true}]});if(u.pathname.endsWith('/stats'))return Response.json({stats:[{type:{displayName:'gameLog'},group:{displayName:'hitting'},splits:Array.from({length:5},(_,i)=>({...mlbSplit,game:{gamePk:12345+i}}))}]});return Response.json({dates:[{games:Array.from({length:5},(_,i)=>({...mlbGame,gamePk:12345+i}))}]});};
 const response=await handler(req('league=baseball_mlb&player=Aaron+Judge&statType=hits&provider=public&window=5'));assert.equal(response.status,200);const data=await response.json();assert.equal(data.source,'MLB StatsAPI player game logs');assert.equal(data.rows.length,5);assert.equal(data.summary.average,0);assert.equal(data.complete,true);assert.equal(calls.length,3);assert.match(data.sampleScope,/Postseason and spring training are excluded/);
});
test('Unmapped NHL blocked shots remains unavailable rather than mapping another count',async()=>{const response=await handler(req('league=icehockey_nhl&player=Connor+McDavid&statType=blocked_shots&provider=public'));assert.equal(response.status,422);assert.equal((await response.json()).code,'PERFORMANCE_STAT_UNAVAILABLE');});
test('Provider selectors are validated and BALLDONTLIE IDs retain their original namespace',async()=>{assert.equal((await handler(req('league=americanfootball_nfl&player=Patrick+Mahomes&statType=passing_yards&provider=untrusted'))).status,400);assert.equal((await handler(req('league=americanfootball_nfl&playerId=7&statType=passing_yards'))).status,503);});

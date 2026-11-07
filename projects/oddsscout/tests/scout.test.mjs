import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import ask from '../netlify/functions/ask.mjs';
import {validateScoutRequest,educationalExplanation} from '../server/scout.mjs';
import {clearCacheForTests} from '../server/common.mjs';
const oldFetch=globalThis.fetch,keys=['ODDS_API_KEY','OPENAI_API_KEY','OPENAI_BASE_URL','BALLDONTLIE_API_KEY','ACCESS_CODE','FORM_PROVIDER'],oldEnv=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
beforeEach(()=>{clearCacheForTests();for(const key of keys)delete process.env[key];});
afterEach(()=>{globalThis.fetch=oldFetch;for(const key of keys)if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key];});
const post=body=>new Request('https://test.local/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('General Scout education works without an event or live data credentials',async()=>{let called=false;globalThis.fetch=async()=>{called=true;throw new Error('No request expected');};const response=await ask(post({question:'What is implied probability?'}));assert.equal(response.status,200);const body=await response.json();assert.equal(body.mode,'rules');assert.equal(body.verified,null);assert.match(body.text,/not a calibrated prediction/);assert.match(body.note,/No AI key/);assert.equal(called,false);});
test('General Scout never invents player, injury, weather or live data',async()=>{const body=await (await ask(post({question:'What injuries make this player a lock?',injuries:['fake'],stats:[99999]}))).json();assert.match(body.text,/no verified injury/);assert.ok(!JSON.stringify(body.context).includes('99999'));assert.ok(!JSON.stringify(body.context).includes('fake'));});
test('AI receives only verified education context and declares unavailable model dimensions',async()=>{process.env.OPENAI_API_KEY='test-key';globalThis.fetch=async(url,options)=>{assert.equal(new URL(url).hostname,'api.openai.com');const payload=JSON.parse(options.body),input=JSON.parse(payload.input);assert.equal(payload.store,false);assert.match(payload.instructions,/Community|community/);assert.ok(input.snapshot.unavailable.some(s=>s.includes('Calibrated')));assert.equal(input.snapshot.fakeOdds,undefined);return Response.json({status:'completed',output:[{content:[{type:'output_text',text:'Explanation based on supplied context.'}]}]});};const body=await (await ask(post({question:'Explain parlay structure',fakeOdds:1000}))).json();assert.equal(body.mode,'ai');assert.match(body.note,/not a trained/);});
test('AI outage is explicitly a rules explanation without fabricating a live feed',async()=>{process.env.OPENAI_API_KEY='test-key';globalThis.fetch=async()=>new Response('secret provider error',{status:503});const body=await (await ask(post({question:'Explain line movement'}))).json();assert.equal(body.mode,'rules');assert.match(body.note,/temporarily unavailable/);assert.match(body.text,/first price OddsScout observes/);assert.ok(!JSON.stringify(body).includes('secret provider'));});
for(const errorFields of [{code:'credit_balance_exhausted',type:'insufficient_quota'},{code:'insufficient_quota',type:null},{code:null,type:'insufficient_quota'}])test(`AI credit exhaustion is classified safely for ${errorFields.code||'no-code'}/${errorFields.type||'no-type'}`,async()=>{
 process.env.OPENAI_API_KEY='fixture-private-key';let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({error:{...errorFields,message:'Private provider diagnostic for org-qa-private-account and fixture-private-key.',param:null}},{status:429});};
 const response=await ask(post({question:'Explain line movement'}));assert.equal(response.status,200);const body=await response.json();
 assert.equal(calls,1,'Credit exhaustion must not trigger automatic SDK retries.');assert.equal(body.mode,'rules');assert.equal(body.aiStatus,'credits_exhausted');assert.equal(body.verified,null);assert.equal(body.text,educationalExplanation('Explain line movement'));
 assert.match(body.note,/API credit balance is exhausted/);assert.match(body.note,/clearly labeled rules-based explanation/);assert.match(body.note,/no generated AI answer/);
 const serialized=JSON.stringify(body);for(const privateValue of ['fixture-private-key','org-qa-private-account','Private provider diagnostic'])assert.ok(!serialized.includes(privateValue));
});
test('AI request rate limiting remains unavailable rather than claiming exhausted API credits',async()=>{
 process.env.OPENAI_API_KEY='fixture-private-key';globalThis.fetch=async()=>Response.json({error:{code:'rate_limit_exceeded',type:'requests',message:'Private rate-limit account diagnostic.'}},{status:429});
 const body=await(await ask(post({question:'Explain line movement'}))).json();assert.equal(body.mode,'rules');assert.equal(body.aiStatus,'unavailable');assert.match(body.note,/temporarily unavailable/);assert.ok(!JSON.stringify(body).includes('Private rate-limit account diagnostic'));assert.ok(!body.note.includes('exhausted'));
});
test('General education covers live freshness and parlay correlation limits',()=>{assert.match(educationalExplanation('live betting'),/scheduled start alone/);assert.match(educationalExplanation('ticket correlation'),/correlated/);assert.match(educationalExplanation('why won profit'),/minus the stake/);assert.match(educationalExplanation('bankroll budget'),/account limits/);});
test('Client context fields are not accepted as statistics or normalized ticket data',()=>{const input=validateScoutRequest({question:'Compare',fakeProbability:0.99,stats:[1,2],communityLikes:999,eventId:'game',league:'basketball_nba',market:'player_points',groupId:'exact'});assert.equal(input.fakeProbability,undefined);assert.equal(input.stats,undefined);assert.equal(input.communityLikes,undefined);assert.equal(input.market,'player_points');});
test('Invalid contextual ticket requests are rejected before requesting data',async()=>{for(const body of [{question:'Q',groupId:'without-event'},{question:'Q',ticket:[{eventId:'e',league:'nba',groupId:'g',market:'../../x'}]},{question:'Q',stake:'25'},{question:'Q',bookKeys:['../../x']},{question:'Q',ticket:Array.from({length:9},()=>({eventId:'e',league:'nba',groupId:'g'}))}])assert.equal((await ask(post(body))).status,400);});
test('Futures context uses provider market title instead of inventing matchup teams',async()=>{process.env.ODDS_API_KEY='test-odds';process.env.BALLDONTLIE_API_KEY='test-results';const sport='basketball_nba_championship_winner',stamp=new Date().toISOString();globalThis.fetch=async url=>{const u=new URL(url);assert.equal(u.hostname,'api.the-odds-api.com');if(u.pathname.endsWith('/sports'))return Response.json([{key:sport,title:'NBA Championship Winner',active:true,has_outrights:true,group:'Basketball'}]);if(u.pathname.endsWith('/events'))return Response.json([]);return Response.json([{id:'future-event',sport_key:sport,sport_title:'NBA Championship Winner',bookmakers:[{key:'draftkings',title:'DraftKings',last_update:stamp,markets:[{key:'outrights',last_update:stamp,outcomes:[{name:'Provider Team',price:4}]}]}]}]);};const response=await ask(post({question:'Explain recent form and futures context',league:sport,eventId:'future-event',market:'outrights'}));assert.equal(response.status,200);const body=await response.json();assert.equal(body.context.event,'NBA Championship Winner');assert.ok(!body.text.includes('null at null'));assert.match(body.text,/futures market/);assert.equal(body.context.recentForm.available,false);});

test('Scout official SDK honors server-configured OpenAI base URL without exposing credentials',async()=>{process.env.OPENAI_API_KEY='fixture-key';process.env.OPENAI_BASE_URL='https://gateway.example.test/v1';globalThis.fetch=async(url,options)=>{assert.equal(new URL(url).origin,'https://gateway.example.test');assert.equal(new URL(url).pathname,'/v1/responses');assert.equal(JSON.parse(options.body).store,false);return Response.json({status:'completed',output:[{content:[{type:'output_text',text:'Server-verified education.'}]}]});};const body=await(await ask(post({question:'Explain decimal odds'}))).json();assert.equal(body.mode,'ai');assert.ok(!JSON.stringify(body).includes('fixture-key'));});

test('Scout calculates explicit American odds examples with the entered hypothetical stake',async()=>{
 const positive=await(await ask(post({question:'Explain +150 odds.',stake:25}))).json();assert.match(positive.text,/2\.500 decimal/);assert.match(positive.text,/40\.00%/);assert.match(positive.text,/\$62\.50/);assert.match(positive.text,/\$37\.50 profit/);assert.match(positive.text,/not a live sportsbook quote/);
 const negative=educationalExplanation('Explain -110 odds',100);assert.match(negative,/1\.909 decimal/);assert.match(negative,/\$190\.91/);assert.match(negative,/\$90\.91 profit/);
});

test('Null and array Scout requests are rejected as input errors',async()=>{
 for(const body of [null,[],42])assert.equal((await ask(post(body))).status,400);
});

const contextLeague='basketball_nba',contextTeams=[{id:1,full_name:'Source Home'},{id:2,full_name:'Source Away'}];
function contextEvent(market='h2h'){
 const stamp=new Date(Date.now()-10000).toISOString();return {id:'scout-context',sport_key:contextLeague,sport_title:'NBA',home_team:'Source Home',away_team:'Source Away',commence_time:new Date(Date.now()+3600000).toISOString(),bookmakers:[{key:'fanduel',last_update:stamp,markets:[{key:market,last_update:stamp,outcomes:market==='h2h'?[{name:'Source Home',price:1.8},{name:'Source Away',price:2.1}]:[{name:'Over',description:'Source Player',point:24.5,price:2},{name:'Under',description:'Source Player',point:24.5,price:1.9}]}]}]};
}
function installContextOdds(event,other){
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);
  if(u.hostname!=='api.the-odds-api.com')return other(u,options);
  if(u.pathname==='/v4/sports')return Response.json([{key:contextLeague,title:'NBA',active:true,has_outrights:false}]);
  if(u.pathname.endsWith('/events'))return Response.json([event]);
  if(u.pathname.endsWith('/markets'))return Response.json({id:event.id,sport_key:contextLeague,bookmakers:event.bookmakers});
  if(u.pathname.endsWith('/odds'))return Response.json(u.pathname.includes('/events/')?event:[event]);
  throw new Error('Unexpected test odds path');
 };
}

test('Scout loads real-source public team form without a paid results key and honors last ten',async()=>{
 process.env.ODDS_API_KEY='test-context-odds';process.env.FORM_PROVIDER='public';const event=contextEvent();let publicCalls=0;
 installContextOdds(event,async u=>{
  assert.equal(u.hostname,'site.api.espn.com');publicCalls++;
  const year=new Date().getUTCFullYear();if(u.pathname.endsWith('/teams'))return Response.json({sports:[{leagues:[{abbreviation:'NBA',season:{year},teams:contextTeams.map(t=>({team:{id:String(t.id),displayName:t.full_name}}))}]}]});
  const season=Number(u.searchParams.get('season')),type=Number(u.searchParams.get('seasontype')),id=u.pathname.match(/teams\/(\d+)\/schedule$/)?.[1];
  assert.ok(id);const events=season===year&&type===2?Array.from({length:10},(_,i)=>({id:String(100+i),date:new Date(Date.now()-(i+1)*86400000).toISOString(),season:{year},seasonType:{type:2},competitions:[{id:String(100+i),status:{type:{completed:true,state:'post',name:'STATUS_FINAL'}},competitors:contextTeams.map((t,j)=>({id:String(t.id),homeAway:j?'away':'home',team:{id:String(t.id),displayName:t.full_name},score:{value:j?90:100}}))}]})):[];
  return Response.json({team:{id},requestedSeason:{year:season,type},events});
 });
 const response=await ask(post({question:'Show last ten games of recent team form.',league:contextLeague,eventId:event.id}));assert.equal(response.status,200);const body=await response.json();assert.ok(publicCalls>0);assert.equal(body.context.recentForm.available,true);assert.match(body.context.recentForm.source,/ESPN/);assert.match(body.context.recentForm.sampleScope,/last 10/);assert.equal(body.context.recentForm.teams[0].games,10);assert.match(body.text,/10 usable completed games/);
});

test('Scout recognizes last five and last 10 player questions using server-fetched exact-stat context',async()=>{
 process.env.ODDS_API_KEY='test-context-odds';process.env.BALLDONTLIE_API_KEY='test-context-results';const event=contextEvent('player_points'),player={id:7,first_name:'Source',last_name:'Player',team:contextTeams[0]};
 installContextOdds(event,async(u,options)=>{
  assert.equal(u.hostname,'api.balldontlie.io');assert.equal(options.headers.Authorization,'test-context-results');
  if(u.pathname.endsWith('/players'))return Response.json({data:[player],meta:{next_cursor:null}});
  if(u.pathname.endsWith('/teams'))return Response.json({data:contextTeams,meta:{next_cursor:null}});
  assert.ok(u.pathname.endsWith('/stats'));return Response.json({data:Array.from({length:10},(_,i)=>({player,team:contextTeams[0],pts:20+i,game:{id:200+i,datetime:new Date(Date.now()-(i+1)*86400000).toISOString(),status_state:'final',status:'Final',home_team:contextTeams[0],visitor_team:contextTeams[1],home_team_id:1,visitor_team_id:2}})),meta:{next_cursor:null}});
 });
 const groupId=JSON.stringify(['player_points','','','Source Player','Over',24.5]);
 for(const [question,count] of [['What has this player done in the last five games?',5],['Show last 10 games for this player',10]]){
  const response=await ask(post({question,league:contextLeague,eventId:event.id,market:'player_points',groupId,stats:[9999]}));assert.equal(response.status,200);const body=await response.json();assert.equal(body.context.recentPlayerPerformance.available,true);assert.equal(body.context.recentPlayerPerformance.summary.sampleSize,count);assert.equal(body.context.recentPlayerPerformance.statType,'pts');assert.ok(!JSON.stringify(body.context).includes('9999'));
 }
});

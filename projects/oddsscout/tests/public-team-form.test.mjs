import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTeamFinal,loadPublicTeamForm} from '../server/public-team-form.mjs';
import {loadRecentForm,formProvider} from '../server/form-provider.mjs';
import {clearCacheForTests} from '../server/common.mjs';
import configHandler from '../netlify/functions/config.mjs';
const oldFetch=globalThis.fetch,oldEnv={FORM_PROVIDER:process.env.FORM_PROVIDER,BALLDONTLIE_API_KEY:process.env.BALLDONTLIE_API_KEY};
afterEach(()=>{globalThis.fetch=oldFetch;clearCacheForTests();for(const [k,v]of Object.entries(oldEnv))if(v===undefined)delete process.env[k];else process.env[k]=v;});
const league='americanfootball_nfl',year=new Date().getUTCFullYear();
const teams=[{id:'5',displayName:'Cleveland Browns'},{id:'4',displayName:'Cincinnati Bengals'}];
const game=()=>({id:'12345',date:new Date(Date.now()-86400000).toISOString(),season:{year},seasonType:{type:2},competitions:[{id:'12345',status:{type:{completed:true,state:'post',name:'STATUS_FINAL'}},competitors:teams.map((team,i)=>({id:team.id,team,homeAway:i?'away':'home',score:{value:i?10:24}}))}]});
function mock(){let count=0;globalThis.fetch=async url=>{count++;const u=new URL(url);assert.equal(u.hostname,'site.api.espn.com');if(u.pathname.endsWith('/teams'))return Response.json({sports:[{leagues:[{abbreviation:'NFL',season:{year},teams:teams.map(team=>({team}))}]}]});return Response.json({team:{id:u.pathname.split('/').at(-2)},events:Number(u.searchParams.get('season'))===year&&u.searchParams.get('seasontype')==='2'?[game()]:[]});};return ()=>count;}
test('Public form accepts only identity-matched completed regular/postseason finals',()=>{const event=game();assert.equal(normalizeTeamFinal(event,{league,teamId:'5'}).homeScore,24);for(const mutate of [e=>e.competitions[0].status.type.completed=false,e=>e.seasonType.type=1,e=>e.date='invalid',e=>e.competitions[0].competitors[0].score.value=null,e=>e.competitions[0].competitors[1].id='99']){const bad=structuredClone(event);mutate(bad);assert.equal(normalizeTeamFinal(bad,{league,teamId:'5'}),null);}assert.equal(normalizeTeamFinal(event,{league,teamId:'99'}),null);});
test('Public schedules return sourced deduplicated finals, empty postseason and cache without key',async()=>{delete process.env.FORM_PROVIDER;delete process.env.BALLDONTLIE_API_KEY;const count=mock();const data=await loadRecentForm(league,teams.map(t=>t.displayName));assert.equal(formProvider(),'public');assert.equal(data.provider,'espn-public');assert.equal(data.complete,true);assert.equal(data.games.length,1);assert.equal(data.games[0].source,'ESPN NFL completed team schedules');assert.ok(data.sourceUrls.every(s=>s.startsWith('https://www.espn.com/')));const before=count();await loadPublicTeamForm(league,teams.map(t=>t.displayName));assert.equal(count(),before);});
test('Public catalog never substitutes fuzzy identities or missing teams',async()=>{mock();await assert.rejects(loadPublicTeamForm(league,['Cleveland','Cincinnati Bengals']),e=>e.code==='FORM_TEAM_MATCH');});
test('Selected paid source with missing key fails without fetching a public substitute',async()=>{process.env.FORM_PROVIDER='balldontlie';delete process.env.BALLDONTLIE_API_KEY;let called=false;globalThis.fetch=async()=>{called=true;throw new Error('Must not fetch');};await assert.rejects(loadRecentForm(league,['A','B']),e=>e.code==='FORM_NOT_CONFIGURED');assert.equal(called,false);});
test('Selected paid-source failure never changes to publisher source',async()=>{process.env.FORM_PROVIDER='balldontlie';process.env.BALLDONTLIE_API_KEY='test-key';globalThis.fetch=async url=>{assert.equal(new URL(url).hostname,'api.balldontlie.io');return Response.json({},{status:403});};await assert.rejects(loadRecentForm(league,['A','B']),e=>e.code==='FORM_ACCESS');});
test('Publisher outage and malformed responses fail without invented rows',async()=>{globalThis.fetch=async()=>Response.json({},{status:503});await assert.rejects(loadPublicTeamForm(league,['A','B']),e=>e.code==='FORM_UNAVAILABLE');clearCacheForTests();globalThis.fetch=async()=>Response.json({sports:[]});await assert.rejects(loadPublicTeamForm(league,['A','B']),e=>e.code==='FORM_BAD_DATA');});
test('Malformed completed rows make the retained verified sample explicitly partial',async()=>{
 globalThis.fetch=async url=>{const u=new URL(url);if(u.pathname.endsWith('/teams'))return Response.json({sports:[{leagues:[{abbreviation:'NFL',season:{year},teams:teams.map(team=>({team}))}]}]});
  const good=game(),bad=game();bad.id='12346';bad.competitions[0].id=bad.id;bad.competitions[0].competitors[0].score.value=null;
  return Response.json({team:{id:u.pathname.split('/').at(-2)},events:Number(u.searchParams.get('season'))===year&&u.searchParams.get('seasontype')==='2'?[good,bad]:[]});};
 const data=await loadPublicTeamForm(league,teams.map(t=>t.displayName));assert.equal(data.games.length,1);assert.equal(data.complete,false);assert.ok(data.limitations.some(s=>s.includes('partial sample is excluded from automatic research')));assert.ok(data.limitations.some(s=>s.includes('completed game could not be verified')));
});
test('Conflicting final scores are quarantined instead of selecting either source record',async()=>{
 globalThis.fetch=async url=>{const u=new URL(url);if(u.pathname.endsWith('/teams'))return Response.json({sports:[{leagues:[{abbreviation:'NFL',season:{year},teams:teams.map(team=>({team}))}]}]});
  const disputed=game(),other=game(),teamId=u.pathname.split('/').at(-2);if(teamId==='4')disputed.competitions[0].competitors[0].score.value=27;other.id='67890';other.competitions[0].id=other.id;
  return Response.json({team:{id:teamId},events:Number(u.searchParams.get('season'))===year&&u.searchParams.get('seasontype')==='2'?[disputed,other,disputed]:[]});};
 const data=await loadPublicTeamForm(league,teams.map(t=>t.displayName));assert.deepEqual(data.games.map(g=>g.id),['espn:americanfootball_nfl:67890']);assert.equal(data.complete,false);assert.ok(data.limitations.some(s=>s.includes('conflicting source records')));
});
test('A reused schedule keeps its actual retrieval timestamp when a new team pair is generated',async()=>{
 const third={id:'12',displayName:'Kansas City Chiefs'},started=Date.now(),originalNow=Date.now;let calls=0;
 globalThis.fetch=async url=>{calls++;const u=new URL(url);if(u.pathname.endsWith('/teams'))return Response.json({sports:[{leagues:[{abbreviation:'NFL',season:{year},teams:[...teams,third].map(team=>({team}))}]}]});const id=u.pathname.split('/').at(-2);return Response.json({team:{id},events:id!=='12'&&Number(u.searchParams.get('season'))===year&&u.searchParams.get('seasontype')==='2'?[game()]:[]});};
 try{
  Date.now=()=>started;const first=await loadPublicTeamForm(league,teams.map(t=>t.displayName));
  Date.now=()=>started+600000;const next=await loadPublicTeamForm(league,[teams[0].displayName,third.displayName]);assert.equal(next.fetchedAt,first.fetchedAt);assert.equal(next.generatedAt,new Date(started+600000).toISOString());assert.notEqual(next.fetchedAt,next.generatedAt);
  const before=calls;Date.now=()=>started+901000;await loadPublicTeamForm(league,[teams[0].displayName,third.displayName]);assert.ok(calls>before,'Pair cache must expire when its oldest underlying source reaches 15 minutes.');
 }finally{Date.now=originalNow;}
});
test('Catalog league identity cannot fall back to the first unrelated league',async()=>{
 globalThis.fetch=async()=>Response.json({sports:[{leagues:[{abbreviation:'NBA',season:{year},teams:teams.map(team=>({team}))}]}]});await assert.rejects(loadPublicTeamForm(league,teams.map(t=>t.displayName)),e=>e.code==='FORM_BAD_DATA');
});
test('Configuration reports explicitly selected public default and missing paid setup accurately',async()=>{
 delete process.env.FORM_PROVIDER;delete process.env.BALLDONTLIE_API_KEY;
 let body=await(await configHandler(new Request('https://example.test/api/config'))).json();assert.equal(body.formProvider,'public');assert.equal(body.formConfigured,true);assert.equal(body.providerVerified,false);
 process.env.FORM_PROVIDER='balldontlie';body=await(await configHandler(new Request('https://example.test/api/config'))).json();assert.equal(body.formProvider,'balldontlie');assert.equal(body.formConfigured,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {americanToDecimal,compareGroups,decimalToAmerican,formatOdds,payout,quoteFresh} from '../public/lib/odds.mjs';
import {candidateAnalysis,lineMovement,marketConsensus,recentPerformance} from '../public/lib/analytics.mjs';
import {recentTeamForm,rankGame} from '../public/lib/parlays.mjs';
import {playerStatForMarket} from '../public/lib/performance-markets.mjs';

const now=Date.parse('2026-10-16T16:00:00Z'),stamp=new Date(now-10000).toISOString();
const event=()=>({id:'source-game',sport_key:'basketball_nba',home_team:'Home',away_team:'Away',status:'upcoming',commence_time:new Date(now+3600000).toISOString(),bookmakers:[{key:'fanduel',last_update:stamp,markets:[{key:'player_points',last_update:stamp,outcomes:[{name:'Over',description:'Player A',point:24.5,price:2},{name:'Under',description:'Player A',point:24.5,price:1.9}]}]}]});
const stat=(gameId='game-1',fields={})=>({gameId,playerId:42,statType:'pts',value:30,date:new Date(now-86400000).toISOString(),completed:true,source:'ESPN NBA player game logs',...fields});

test('post-start odds without verified live status cannot be ranked as fresh',()=>{
 const e=event();e.status='unknown';e.commence_time=new Date(now-60000).toISOString();
 const groups=compareGroups(e,'player_points',{now});assert.equal(groups[0].quotes.length,1);assert.equal(groups[0].best,null);
 e.status='live';e.statusCheckedAt=stamp;e.scoreUpdatedAt=new Date(now-91000).toISOString();assert.equal(compareGroups(e,'player_points',{now})[0].best,null);
 e.scoreUpdatedAt=stamp;assert.equal(compareGroups(e,'player_points',{now})[0].best.book,'fanduel');
});

test('future markets can have fresh prices without inventing a live game status',()=>{
 const e={kind:'future',status:'unknown',commence_time:null};assert.equal(quoteFresh({updatedAt:stamp},e,now),true);assert.equal(quoteFresh({updatedAt:stamp},{...e,status:'completed'},now),false);
});

test('sportsbook aliases cannot create extra independent quotes or no-vig books',()=>{
 const e=event();e.bookmakers=[{...e.bookmakers[0],key:'espnbet'},{...structuredClone(e.bookmakers[0]),key:'thescorebet'}];
 const g=compareGroups(e,'player_points',{now})[0];assert.equal(g.freshQuotes.length,1);assert.equal(g.best.book,'espnbet');assert.equal(marketConsensus(e,g,{now}).completeBookCount,1);
 assert.equal(compareGroups(e,'player_points',{now,bookKeys:['thescore']})[0].freshQuotes.length,1);
});

test('live team form rejects fake, unsourced, and malformed result rows',()=>{
 const real={id:'verified-1',completed:true,homeTeam:'Home',awayTeam:'Away',homeScore:100,awayScore:99,date:new Date(now-86400000).toISOString(),source:'BALLDONTLIE NBA'};
 const rows=[real,{...real,id:'fake',source:'Fictional sample history'},{...real,id:'demo',mode:'demo'},{...real,id:'missing-source',source:undefined},{...real,id:'blank-team',awayTeam:''}];
 assert.equal(recentTeamForm('Home',rows,{now}).games,1);assert.equal(recentTeamForm('Home',{}, {now}).games,0);
 const e=event();assert.deepEqual(rankGame(e,{mode:'live',complete:true,games:rows,source:'BALLDONTLIE NBA',fetchedAt:stamp},{now}),[]);
});

test('stat samples use normalized player identity and the requested stat only',()=>{
 const sample=recentPerformance([stat(),stat('wrong-player',{playerId:43,value:100}),stat('wrong-stat',{statType:'reb',value:20})],{playerId:'42',statType:'pts',line:24.5,now});assert.equal(sample.games,1);assert.equal(sample.average,30);
});

test('candidate analysis refuses mixed, unscoped and wrong-stat player samples',()=>{
 const e=event(),g=compareGroups(e,'player_points',{now})[0];
 assert.equal(candidateAnalysis(e,g,{stats:[stat()],now}).recentPerformance.unavailable,true);
 const performance={mode:'live',source:'ESPN NBA player game logs',league:e.sport_key,player:{id:42,name:'Player A'},statType:'pts',complete:true,rows:[stat(),stat('different-player',{playerId:43,value:999})]};
 const c=candidateAnalysis(e,g,{performance,now});assert.equal(c.recentPerformance.games,1);assert.equal(c.recentPerformance.average,30);assert.equal(c.modelProbability,null);assert.equal(c.dataQuality.modelConfidence,null);
 for(const patch of [{statType:'reb'},{player:{id:42,name:'Player B'}},{league:'americanfootball_nfl'},{mode:'demo'}])assert.equal(candidateAnalysis(e,g,{performance:{...performance,...patch},now}).recentPerformance.unavailable,true);
 const partial=candidateAnalysis(e,g,{performance:{...performance,complete:false},now});assert.equal(partial.recentPerformance.partial,true);assert.ok(partial.concerns.some(s=>s.includes('partial')));
});

test('central performance market mapping keeps NHL points distinct from NBA points',()=>{
 assert.equal(playerStatForMarket('basketball_nba','player_points'),'pts');assert.equal(playerStatForMarket('icehockey_nhl','player_points'),'points');assert.equal(playerStatForMarket('basketball_nba','player_receiving_yards'),null);
});

test('line history validates selection structure and explicit synthetic provenance',()=>{
 const e=event(),g=compareGroups(e,'player_points',{now})[0];
 assert.match(lineMovement([],{eventId:e.id,groupId:'{}',now}).reason,/invalid/);
 const rows=[{eventId:e.id,groupId:g.id,book:'fanduel',price:2,timestamp:stamp,source:'Fictional'}];assert.equal(lineMovement(rows,{eventId:e.id,groupId:g.id,now}).series.length,0);
});

test('payout rejects numeric overflow instead of returning infinite money',()=>assert.equal(payout(Number.MAX_VALUE,3),null));
test('extreme odds conversions never display Infinity or round a quote down to one',()=>{
 assert.equal(decimalToAmerican(Number.MAX_VALUE),null);assert.equal(formatOdds(Number.MAX_VALUE),'—');assert.equal(americanToDecimal(-Number.MAX_VALUE),null);
});

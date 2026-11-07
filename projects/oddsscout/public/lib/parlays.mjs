/** Transparent research heuristics. No trained prediction model or sportsbook parlay quotes. */
import {compareGroups,eventStatus,BOOKS,payout} from './odds.mjs';
export const FORM_LEAGUES={basketball_nba:'NBA',americanfootball_nfl:'NFL',baseball_mlb:'MLB',icehockey_nhl:'NHL'};
export const RESEARCH_METHOD='Research rank = 65% normalized market-implied share + 25% smoothed recent-result comparison + 10% smoothed home/away comparison. Arbitrary research weights, not a calibrated win probability, expected value, or proven edge.';
const day=86400000;
const validScore=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const realResult=g=>g.mode!=='demo'&&g.fictional!==true&&g.synthetic!==true&&typeof g.source==='string'&&g.source.trim()&&!/demo|fictional|synthetic|fixture/i.test(g.source);
export function recentTeamForm(team,records,{limit=5,now=Date.now(),before=now,allowDemo=false}={}){
 const cutoff=Math.min(now,before),seen=new Set();
 const games=(Array.isArray(records)?records:[]).filter(g=>g&&(allowDemo||realResult(g))&&g.completed===true&&typeof g.id==='string'&&g.id.trim()&&typeof g.homeTeam==='string'&&g.homeTeam.trim()&&typeof g.awayTeam==='string'&&g.awayTeam.trim()&&g.homeTeam!==g.awayTeam&&(g.homeTeam===team||g.awayTeam===team)&&validScore(g.homeScore)&&validScore(g.awayScore)&&Number.isFinite(Date.parse(g.date))&&Date.parse(g.date)<cutoff&&Date.parse(g.date)>=cutoff-120*day).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).filter(g=>{if(seen.has(g.id))return false;seen.add(g.id);return true;}).slice(0,limit===10?10:5).map(g=>{
  const home=g.homeTeam===team,scored=home?g.homeScore:g.awayScore,allowed=home?g.awayScore:g.homeScore;
  return {id:g.id,date:g.date,opponent:home?g.awayTeam:g.homeTeam,venue:home?'home':'away',scored,allowed,result:scored>allowed?'W':scored<allowed?'L':'D',source:g.source||'Source unavailable'};
 });
 const record=rows=>({games:rows.length,wins:rows.filter(g=>g.result==='W').length,losses:rows.filter(g=>g.result==='L').length,draws:rows.filter(g=>g.result==='D').length});
 const summary=record(games);
 return {team,...summary,rows:games,home:record(games.filter(g=>g.venue==='home')),away:record(games.filter(g=>g.venue==='away')),averageFor:games.length?games.reduce((s,g)=>s+g.scored,0)/games.length:null,averageAgainst:games.length?games.reduce((s,g)=>s+g.allowed,0)/games.length:null,averageMargin:games.length?games.reduce((s,g)=>s+g.scored-g.allowed,0)/games.length:null,lastPlayed:games[0]?.date||null,daysSinceLast:games.length?(cutoff-Date.parse(games[0].date))/day:null};
}
function fullTwoWay(g,event){
 try{const [market,universe,md,od]=JSON.parse(g.id);return market==='h2h'&&universe===[event.home_team,event.away_team].sort().join('|')&&!md&&!od&&g.scope==='2-way moneyline';}catch{return false;}
}
export function parlayGroups(event,bookKeys=null,now=Date.now()){
 if(eventStatus(event,now)!=='upcoming')return [];
 return compareGroups(event,'h2h',{bookKeys,now}).filter(g=>fullTwoWay(g,event));
}
/** All legs must share a fresh sportsbook. The product is an estimate, NOT a betslip quote. */
export function compareParlay(legs,{bookKeys=null,now=Date.now()}={}){
 const fail=reason=>({ok:false,reason,books:[],best:null,ties:[]});
 if(!Array.isArray(legs)||legs.length<2||legs.length>4)return fail('Choose 2–4 legs from separate upcoming games.');
 const ids=new Set(),teams=new Set(),resolved=[];
 for(const leg of legs){
  const e=leg?.event;
  if(!e?.id||ids.has(e.id))return fail('Same-game and duplicate legs are not supported.');
  ids.add(e.id);
  for(const team of [e.home_team,e.away_team]){const key=e.sport_key+'|'+team;if(teams.has(key))return fail('A team appears in more than one leg. Choose unrelated matchups.');teams.add(key);}
  const g=parlayGroups(e,bookKeys,now).find(g=>g.id===leg.groupId);
  if(!g?.best)return fail('One or more legs started, have stale odds, or no longer have the exact two-way moneyline. Refresh and rebuild.');
  resolved.push({event:e,group:g});
 }
 let common=new Set(resolved[0].group.freshQuotes.map(q=>q.book));
 for(const {group} of resolved.slice(1))common=new Set([...common].filter(book=>group.freshQuotes.some(q=>q.book===book)));
 const books=[...common].map(book=>{
  const quotes=resolved.map(({group})=>group.freshQuotes.find(q=>q.book===book));
  const decimal=quotes.reduce((p,q)=>p*q.price,1);
  const timestamps=quotes.map(q=>Date.parse(q.updatedAt));
  return {book,title:BOOKS[book]?.name||quotes[0].title,decimal,quotes,oldestAt:new Date(Math.min(...timestamps)).toISOString(),newestAt:new Date(Math.max(...timestamps)).toISOString(),snapshotSpanSeconds:(Math.max(...timestamps)-Math.min(...timestamps))/1000};
 }).filter(b=>Number.isFinite(b.decimal)&&b.decimal>1&&b.snapshotSpanSeconds<=120).sort((a,b)=>b.decimal-a.decimal||a.title.localeCompare(b.title));
 if(!books.length)return fail('No selected app has fresh, closely timed quotes for every leg. Cross-app prices cannot form one parlay.');
 return {ok:true,reason:null,books,best:books[0],ties:books.filter(b=>Math.abs(b.decimal-books[0].decimal)<1e-8),legs:resolved,estimated:true};
}
const smooth=record=>(record.wins+0.5*record.draws+2.5)/(record.games+5);
export function rankGame(event,bundle,{limit=5,bookKeys=null,now=Date.now(),mode='live'}={}){
 if(!Object.hasOwn(FORM_LEAGUES,event.sport_key)||bundle?.league!==event.sport_key||bundle?.mode!==mode||bundle?.complete!==true||!Array.isArray(bundle.games))return [];
 if(mode==='live'&&(!realResult(bundle)||bundle.games.some(g=>g&&!realResult(g))))return [];
 if(!Number.isFinite(Date.parse(bundle.fetchedAt))||now-Date.parse(bundle.fetchedAt)>3600000||Date.parse(bundle.fetchedAt)>now+30000)return [];
 const gs=parlayGroups(event,bookKeys,now);if(gs.length!==2)return [];
 const forms=Object.fromEntries([event.away_team,event.home_team].map(team=>[team,recentTeamForm(team,bundle.games,{limit,now,before:Date.parse(event.commence_time),allowDemo:mode==='demo'})]));
 if(Object.values(forms).some(f=>f.games<3||f.daysSinceLast>21))return [];
 return gs.map(group=>{
  const opposing=gs.find(g=>g.name!==group.name),probabilities=[];
  for(const q of group.freshQuotes){const other=opposing.freshQuotes.find(o=>o.book===q.book);if(other)probabilities.push((1/q.price)/((1/q.price)+(1/other.price)));}
  if(!probabilities.length)return null;
  const own=forms[group.name],opponent=forms[opposing.name],marketShare=probabilities.reduce((a,b)=>a+b,0)/probabilities.length;
  const ownVenue=own[group.name===event.home_team?'home':'away'],oppVenue=opponent[opposing.name===event.home_team?'home':'away'];
  const formShare=0.5+(smooth(own)-smooth(opponent))/2,venueShare=0.5+(smooth(ownVenue)-smooth(oppVenue))/2;
  const score=100*(.65*marketShare+.25*formShare+.10*venueShare);
  return {event,groupId:group.id,selection:group.name,group,forms,own,opponent,score,marketShare,formShare,venueShare,source:bundle.source,fetchedAt:bundle.fetchedAt,mode};
 }).filter(Boolean).sort((a,b)=>b.score-a.score);
}
export function generateParlays(candidates,{legs=2,bookKeys=null,now=Date.now(),maxResults=3}={}){
 if(![2,3,4].includes(legs))return [];
 // One higher-ranked outcome per game; bounded, explained candidate pool, not all possible bets.
 const unique=new Map();for(const c of [...candidates].sort((a,b)=>b.score-a.score))if(!unique.has(c.event.id))unique.set(c.event.id,c);
 const pool=[...unique.values()].slice(0,12),found=[];
 function walk(start,chosen){
  if(chosen.length===legs){const comparison=compareParlay(chosen,{bookKeys,now});if(comparison.ok)found.push({legs:[...chosen],score:chosen.reduce((s,c)=>s+c.score,0)/legs,comparison});return;}
  for(let i=start;i<=pool.length-(legs-chosen.length);i++)walk(i+1,[...chosen,pool[i]]);
 }
 walk(0,[]);return found.sort((a,b)=>b.score-a.score||b.comparison.best.decimal-a.comparison.best.decimal).slice(0,maxResults);
}
export function paperNet(ticket){
 if(!ticket||!Number.isFinite(ticket.stake)||ticket.stake<0||!Number.isFinite(ticket.decimal)||ticket.decimal<=1)return null;
 if(ticket.result==='lost')return -ticket.stake;
 if(ticket.result==='won')return payout(ticket.stake,ticket.decimal)?.profit??null;
 if(ticket.result==='void')return 0;
 return null;
}

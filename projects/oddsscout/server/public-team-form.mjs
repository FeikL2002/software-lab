/** Explicit ESPN publisher source, selected before fetching. No paid-feed failure fallback. */
import {AppError,cached,mapConcurrent} from './common.mjs';
export const TEAM_FORM_ADAPTERS={basketball_nba:{sport:'basketball',league:'nba',title:'NBA'},americanfootball_nfl:{sport:'football',league:'nfl',title:'NFL'},baseball_mlb:{sport:'baseball',league:'mlb',title:'MLB'},icehockey_nhl:{sport:'hockey',league:'nhl',title:'NHL'}};
const normalize=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const validId=value=>/^[1-9]\d{0,9}$/.test(String(value));
const finalNames=new Set(['STATUS_FINAL','STATUS_FINAL_OVERTIME','STATUS_FINAL_SHOOTOUT']);
const failure=()=>new AppError('The selected public team-results source is unavailable. No substitute results were loaded. Retry later.',502,'FORM_UNAVAILABLE');
async function request(url){
 let response;try{response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(6500)});}catch{throw failure();}
 if(response.status===429)throw new AppError('Public team results are on cooldown. Retry later.',429,'FORM_LIMIT',60);
 if(!response.ok)throw failure();
 try{const body=await response.json();if(!body||typeof body!=='object')throw 0;return body;}catch{throw new AppError('The public team-results source returned invalid data.',502,'FORM_BAD_DATA');}
}
export function normalizeTeamFinal(event,{league,teamId,now=Date.now()}={}){
 const adapter=TEAM_FORM_ADAPTERS[league],date=Date.parse(event?.date),type=event?.seasonType?.type;
 if(!adapter||!validId(event?.id)||!Number.isFinite(date)||date>=now||![2,3].includes(type)||!Array.isArray(event.competitions)||event.competitions.length!==1)return null;
 const competition=event.competitions[0],status=competition.status?.type,competitors=competition.competitors;
 if(competition.id!==event.id||status?.completed!==true||status.state!=='post'||!finalNames.has(status.name)||!Array.isArray(competitors)||competitors.length!==2)return null;
 const home=competitors.find(c=>c.homeAway==='home'),away=competitors.find(c=>c.homeAway==='away');
 if(!home||!away||!validId(home.team?.id)||!validId(away.team?.id)||home.team.id===away.team.id||![String(home.team.id),String(away.team.id)].includes(String(teamId)))return null;
 if([home,away].some(c=>String(c.id)!==String(c.team.id)||typeof c.team.displayName!=='string'||!c.team.displayName.trim()))return null;
 const score=c=>typeof c.score?.value==='number'&&Number.isFinite(c.score.value)&&c.score.value>=0?c.score.value:null;
 const homeScore=score(home),awayScore=score(away);if(homeScore===null||awayScore===null)return null;
 return {id:`espn:${league}:${event.id}`,league,date:new Date(date).toISOString(),completed:true,homeTeam:home.team.displayName,awayTeam:away.team.displayName,homeTeamId:String(home.team.id),awayTeamId:String(away.team.id),homeScore,awayScore,season:event.season?.year??null,seasonType:type,source:`ESPN ${adapter.title} completed team schedules`,providerUpdatedAt:null};
}
export async function loadPublicTeamForm(league,teamNames){
 const adapter=TEAM_FORM_ADAPTERS[league];if(!adapter)throw new AppError('Public team form supports NBA, NFL, MLB and NHL.',422,'FORM_UNSUPPORTED');
 const names=[...new Set(teamNames)].sort(),base=`https://site.api.espn.com/apis/site/v2/sports/${adapter.sport}/${adapter.league}`;
 return cached(`public-team-form:${league}:${names.join('|')}`,value=>value?.fetchedAt?Math.max(1,900-(Date.now()-Date.parse(value.fetchedAt))/1000):900,async()=>{
  const catalog=await cached(`public-team-catalog:${league}`,86400,()=>request(base+'/teams'));
  const info=catalog.sports?.[0]?.leagues?.find(l=>[l.abbreviation,l.slug].some(value=>typeof value==='string'&&value.toLowerCase()===adapter.league));
  const entries=info?.teams,year=info?.season?.year;
  if(!Array.isArray(entries)||entries.length<2||!Number.isInteger(year)||year<2000||year>new Date().getUTCFullYear()+1)throw new AppError('The public team catalog is incomplete or invalid.',502,'FORM_BAD_DATA');
  const mapped=names.map(name=>{const matches=entries.map(e=>e.team).filter(t=>validId(t?.id)&&normalize(t.displayName)===normalize(name));if(matches.length!==1)throw new AppError('A unique exact team name was not returned by the public source. No approximate team was substituted.',422,'FORM_TEAM_MATCH');return {id:String(matches[0].id),name};});
  const scopes=mapped.flatMap(team=>[year,year-1].flatMap(season=>[2,3].map(type=>({team,season,type}))));
  const now=Date.now(),warnings=[],games=new Map(),conflicts=new Set(),scheduleFetchTimes=[];let complete=true;
  await mapConcurrent(scopes,3,async({team,season,type})=>{
   try{
    const snapshot=await cached(`public-team-schedule:${league}:${team.id}:${season}:${type}`,900,async()=>({body:await request(`${base}/teams/${team.id}/schedule?${new URLSearchParams({season:String(season),seasontype:String(type)})}`),fetchedAt:new Date(Date.now()).toISOString()}));
    const body=snapshot.body;
    if(String(body.team?.id)!==team.id||!Array.isArray(body.events)||body.events.length>500||body.events.some(e=>e.season?.year!==season||e.seasonType?.type!==type))throw new Error('Schedule identity or season mismatch');
    scheduleFetchTimes.push(snapshot.fetchedAt);
    for(const event of body.events){
     const row=normalizeTeamFinal(event,{league,teamId:team.id,now});
     if(!row){
      const sourceDate=Date.parse(event?.date),purportedFinal=event.competitions?.some(c=>c?.status?.type?.completed===true);
      // A malformed final may be a missing recent game. It cannot leave a
      // deceptively complete last-N sample eligible for automatic research.
      if(purportedFinal&&(!Number.isFinite(sourceDate)||sourceDate>=now-120*86400000)){
       complete=false;warnings.push(`${team.name}: a returned completed game could not be verified and was excluded.`);
      }
      continue;
     }
     if(Date.parse(row.date)<now-120*86400000||conflicts.has(row.id))continue;
     row.homeTeam=mapped.find(t=>t.id===row.homeTeamId)?.name||row.homeTeam;row.awayTeam=mapped.find(t=>t.id===row.awayTeamId)?.name||row.awayTeam;
     const previous=games.get(row.id);
     if(previous&&['homeTeamId','awayTeamId','homeScore','awayScore','season','seasonType'].some(key=>previous[key]!==row[key])){
      games.delete(row.id);conflicts.add(row.id);complete=false;warnings.push('A completed game had conflicting source records and was excluded from this sample.');continue;
     }
     games.set(row.id,row);
    }
   }catch{complete=false;warnings.push(`${team.name}: ${season} season type ${type} could not be fully verified.`);}
  });
  if(!games.size&&!complete)throw failure();
  const generatedAt=new Date(Date.now()).toISOString(),fetchedAt=scheduleFetchTimes.sort()[0]||generatedAt;
  return {mode:'live',provider:'espn-public',source:`ESPN ${adapter.title} completed team schedules`,league,teams:names,games:[...games.values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)),complete,fetchedAt,generatedAt,sourceUrls:mapped.map(team=>`https://www.espn.com/${adapter.league}/team/schedule/_/id/${team.id}`),sampleScope:`Returned regular-season and postseason final games from ${year} and ${year-1}, restricted to the last 120 days.`,limitations:['Public publisher endpoints can change or be unavailable. No API service guarantee.','Preseason, in-progress, future and malformed results are excluded. Missing scores are never zero-filled.','Injuries, lineups, weather, opponent strength and predictive probabilities are not provided.','Game dates and retrieval time are separate; per-score update time is not supplied. Retrieval time is the oldest included schedule fetch; generating a new pairing does not refresh cached source data.',...(complete?[]:['Some schedules could not be verified; this partial sample is excluded from automatic research.']),...new Set(warnings)]};
 });
}

/** Optional, documented BALLDONTLIE teams/games adapter. No browser keys or scraping. */
import {env,AppError,cached} from './common.mjs';
import {FORM_LEAGUES} from '../public/lib/parlays.mjs';
import {loadPublicTeamForm} from './public-team-form.mjs';
export function formProvider(){return env('FORM_PROVIDER').trim()||(env('BALLDONTLIE_API_KEY').trim()?'balldontlie':'public');}
const paths={basketball_nba:'/v1',americanfootball_nfl:'/nfl/v1',baseball_mlb:'/mlb/v1',icehockey_nhl:'/nhl/v1'};
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const teamName=t=>t?.full_name||t?.display_name||'';
export function normalizeResult(g,league){
 if(!g||typeof g!=='object')return null;
 const final=g.status_state?g.status_state==='final':league==='icehockey_nhl'?['OFF','FINAL'].includes(g.game_state):['Final','STATUS_FINAL'].includes(g.status);
 if(!final||g.postponed||g.season_type==='spring_training'||g.season_type==='preseason')return null;
 const home=g.home_team,away=g.visitor_team||g.away_team;
 const homeScore=league==='baseball_mlb'?g.home_team_data?.runs:league==='icehockey_nhl'?g.home_score:g.home_team_score;
 const awayScore=league==='baseball_mlb'?g.away_team_data?.runs:league==='icehockey_nhl'?g.away_score:g.visitor_team_score;
 const date=g.datetime||g.start_time_utc||g.date||g.game_date;
 if(g.id==null||!home?.id||!away?.id||!teamName(home)||!teamName(away)||![homeScore,awayScore].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)||!Number.isFinite(Date.parse(date)))return null;
 return {id:`bdl:${league}:${g.id}`,league,date,completed:true,homeTeam:teamName(home),awayTeam:teamName(away),homeTeamId:home.id,awayTeamId:away.id,homeScore,awayScore,source:`BALLDONTLIE ${FORM_LEAGUES[league]}`,providerUpdatedAt:g.updated_at||null};
}
async function requestBDL(path,params){
 let response;
 try{response=await fetch('https://api.balldontlie.io'+path+'?'+params.toString(),{headers:{Authorization:env('BALLDONTLIE_API_KEY').trim(),Accept:'application/json'},signal:AbortSignal.timeout(7000)});}catch{throw new AppError('Recent-results provider could not be reached. No form statistics were invented.',502,'FORM_UNAVAILABLE');}
 if(!response.ok){
  if(response.status===429){const n=Number(response.headers.get('retry-after'));throw new AppError('Recent-results provider is on cooldown. Loaded analyses remain available; retry later.',429,'FORM_LIMIT',Number.isFinite(n)&&n>0?Math.min(3600,n):60);}
  if([401,403].includes(response.status))throw new AppError('Recent-results key or endpoint access needs checking in the provider account. Odds can still be compared without form data.',503,'FORM_ACCESS');
  throw new AppError('Recent results are unavailable for this request.',502,'FORM_UNAVAILABLE');
 }
 let body;try{body=await response.json();}catch{throw new AppError('Recent-results provider returned unreadable data.',502,'FORM_BAD_DATA');}
 if(!Array.isArray(body?.data))throw new AppError('Recent-results provider returned an unexpected response.',502,'FORM_BAD_DATA');
 return body;
}
export function historyParameters(league,ids,now=Date.now()){
 const params=new URLSearchParams({per_page:'100'});for(const id of ids)params.append('team_ids[]',String(id));
 const date=n=>new Date(n).toISOString().slice(0,10);
 if(league==='basketball_nba'){params.set('start_date',date(now-90*86400000));params.set('end_date',date(now));}
 else if(league==='americanfootball_nfl'){
  const d=new Date(now),season=d.getUTCMonth()<7?d.getUTCFullYear()-1:d.getUTCFullYear();
  params.append('seasons[]',String(season));params.append('seasons[]',String(season-1));
  params.append('season_types[]','2');params.append('season_types[]','3');
 }else{const days=league==='baseball_mlb'?35:60;for(let i=0;i<=days;i++)params.append('dates[]',date(now-i*86400000));}
 return params;
}
export async function loadRecentForm(league,teamNames){
 if(!Object.hasOwn(paths,league))throw new AppError('Recent-form research currently supports NBA, NFL, MLB and NHL. Other leagues still have the odds board.',422,'FORM_UNSUPPORTED');
 const provider=formProvider();
 if(provider==='public')return loadPublicTeamForm(league,teamNames);
 if(provider!=='balldontlie')throw new AppError('Choose FORM_PROVIDER public or balldontlie on the server.',503,'FORM_NOT_CONFIGURED');
 if(!env('BALLDONTLIE_API_KEY').trim())throw new AppError('Recent form is not configured. The owner can add BALLDONTLIE_API_KEY in Netlify environment variables, Functions scope, then redeploy. Do not paste a key here.',503,'FORM_NOT_CONFIGURED');
 const names=[...new Set(teamNames)].sort();
 return cached(`form:${league}:${names.join('|')}`,900,async()=>{
  const catalog=await cached(`form-teams:${league}`,86400,()=>requestBDL(paths[league]+'/teams',new URLSearchParams()));
  if(catalog.meta?.next_cursor!=null)throw new AppError('The team catalog is incomplete. No ambiguous team match was used.',502,'FORM_INCOMPLETE');
  const mappings=new Map();const ids=[];
  for(const requested of names){
   const matches=catalog.data.filter(t=>normalize(teamName(t))===normalize(requested));
   if(matches.length!==1||!Number.isInteger(matches[0].id))throw new AppError(`A unique recent-results team match was not found for ${requested}. No approximate name match was used.`,422,'FORM_TEAM_MATCH');
   mappings.set(matches[0].id,requested);ids.push(matches[0].id);
  }
  const params=historyParameters(league,ids),rows=[],seen=new Set();let complete=false;
  for(let page=0;page<3;page++){
   const body=await requestBDL(paths[league]+'/games',params);rows.push(...body.data);
   const cursor=body.meta?.next_cursor;if(cursor==null){complete=true;break;}
   if(!['string','number'].includes(typeof cursor)||seen.has(String(cursor)))break;
   seen.add(String(cursor));params.set('cursor',String(cursor));
  }
  const now=Date.now(),dedupe=new Map();
  for(const raw of rows){const game=normalizeResult(raw,league);if(!game||Date.parse(game.date)>=now||Date.parse(game.date)<now-120*86400000||(!mappings.has(game.homeTeamId)&&!mappings.has(game.awayTeamId)))continue;
   game.homeTeam=mappings.get(game.homeTeamId)||game.homeTeam;game.awayTeam=mappings.get(game.awayTeamId)||game.awayTeam;dedupe.set(game.id,game);
  }
  return {mode:'live',source:`BALLDONTLIE ${FORM_LEAGUES[league]}`,league,teams:names,games:[...dedupe.values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)),complete,fetchedAt:new Date().toISOString(),limitations:['Final scores only. Injuries, starting lineups, weather, travel and opponent strength are not verified.','Form uses returned completed games within 120 days; offseason and partial samples are labeled.',...(complete?[]:['Pagination limit reached: these rows cannot establish the most recent games. Automatic research is disabled for this result.'])]};
 });
}

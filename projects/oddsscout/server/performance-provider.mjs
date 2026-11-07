/** Optional BALLDONTLIE player-game adapter. Official schemas checked 2026-10-14. */
import {env,AppError,cached} from './common.mjs';
import {loadPublicPlayerPerformance} from './public-performance.mjs';

export const PERFORMANCE_LEAGUES={
 basketball_nba:{title:'NBA',path:'/v1',stats:'/stats',fields:['pts','reb','ast','fg3m','stl','blk','turnover','pts_reb_ast']},
 americanfootball_nfl:{title:'NFL',path:'/nfl/v1',stats:'/stats',fields:['passing_yards','passing_touchdowns','rushing_yards','rushing_touchdowns','receiving_yards','receptions','receiving_touchdowns']},
 baseball_mlb:{title:'MLB',path:'/mlb/v1',stats:'/stats',fields:['hits','runs','rbi','hr','total_bases','p_k','pitching_outs','stolen_bases']},
 icehockey_nhl:{title:'NHL',path:'/nhl/v1',stats:'/box_scores',fields:['goals','assists','points','shots_on_goal','saves','blocked_shots']}
};
const day=86400000;
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
const identity=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const teamName=team=>team?.full_name||team?.display_name||null;
const playerName=player=>player?.full_name||[player?.first_name,player?.last_name].filter(Boolean).join(' ');
const finalGame=(game,league)=>game?.status_state?game.status_state==='final':league==='icehockey_nhl'?['OFF','FINAL'].includes(game?.game_state):['Final','STATUS_FINAL'].includes(game?.status);

export {playerStatForMarket} from '../public/lib/performance-markets.mjs';

export function readPerformanceScope(url){
 for(const key of url.searchParams.keys())if(!['league','playerId','player','statType','window','line','provider'].includes(key)||url.searchParams.getAll(key).length!==1)throw new AppError('Unsupported recent-performance query.',400,'BAD_QUERY');
 const league=url.searchParams.get('league'),statType=url.searchParams.get('statType'),playerId=url.searchParams.get('playerId'),player=url.searchParams.get('player'),window=Number(url.searchParams.get('window')||5),lineRaw=url.searchParams.get('line');
 if(!Object.hasOwn(PERFORMANCE_LEAGUES,league||''))throw new AppError('Player performance supports NBA, NFL, MLB and NHL.',422,'PERFORMANCE_UNSUPPORTED');
 if(!PERFORMANCE_LEAGUES[league].fields.includes(statType))throw new AppError('Choose a supported statistic for this league.',422,'PERFORMANCE_STAT_UNSUPPORTED');
 if((!playerId&&!player)||(playerId&&player)||(playerId&&(!/^[1-9]\d{0,9}$/.test(playerId)||Number(playerId)>2147483647))||(player&&(player.trim().length<2||player.length>100||!identity(player)||/[\u0000-\u001f<>|]/.test(player))))throw new AppError('Choose one valid player name or provider player ID.',400,'BAD_QUERY');
 if(![5,10,20].includes(window))throw new AppError('Choose the last 5, 10 or 20 available completed games.',400,'BAD_QUERY');
 const line=lineRaw===null?null:Number(lineRaw);
 const provider=url.searchParams.get('provider')||'auto';
 if(!['auto','public','balldontlie'].includes(provider))throw new AppError('Choose a supported player-results source.',400,'BAD_QUERY');
 if(lineRaw!==null&&(!/^-?\d+(\.\d{1,3})?$/.test(lineRaw)||!numeric(line)||line<0||line>10000))throw new AppError('Enter a valid comparison line.',400,'BAD_QUERY');
 return {league,statType,playerId:playerId?Number(playerId):null,player:player?.trim()||null,window,line,provider};
}

async function request(path,params=new URLSearchParams(),{object=false}={}){
 let response;
 try{response=await fetch('https://api.balldontlie.io'+path+'?'+params.toString(),{headers:{Authorization:env('BALLDONTLIE_API_KEY').trim(),Accept:'application/json'},signal:AbortSignal.timeout(7000)});}catch{throw new AppError('The player-results provider could not be reached. No statistics were invented.',502,'PERFORMANCE_UNAVAILABLE');}
 if(!response.ok){
  if(response.status===429){const seconds=Number(response.headers.get('retry-after'));throw new AppError('Player-results requests are on provider cooldown. Retry later.',429,'PERFORMANCE_LIMIT',numeric(seconds)&&seconds>0?Math.min(seconds,3600):60);}
  if([401,403].includes(response.status))throw new AppError('The player-results key or subscription does not allow this endpoint. Odds remain available independently.',503,'PERFORMANCE_ACCESS');
  if(response.status===404)throw new AppError('That player or endpoint is not available from the results provider.',422,'PERFORMANCE_PLAYER_MATCH');
  throw new AppError('Player results are unavailable for this request.',502,'PERFORMANCE_UNAVAILABLE');
 }
 let body;try{body=await response.json();}catch{throw new AppError('Player-results provider returned unreadable data.',502,'PERFORMANCE_BAD_DATA');}
 if(object?(!body?.data||typeof body.data!=='object'||Array.isArray(body.data)):!Array.isArray(body?.data))throw new AppError('Player-results provider returned an unexpected response.',502,'PERFORMANCE_BAD_DATA');
 return body;
}
async function pages(path,params,maxPages=3){
 const rows=[],cursors=new Set();let complete=false;
 for(let page=0;page<maxPages;page++){
  const body=await request(path,params);rows.push(...body.data);const cursor=body.meta?.next_cursor;
  if(cursor==null){complete=true;break;}
  if(!['string','number'].includes(typeof cursor)||cursors.has(String(cursor)))break;
  cursors.add(String(cursor));params.set('cursor',String(cursor));
 }
 return {rows,complete};
}
async function resolvePlayer(scope){
 const adapter=PERFORMANCE_LEAGUES[scope.league];
 if(scope.playerId){
  const data=await cached(`performance-player:${scope.league}:${scope.playerId}`,86400,()=>request(`${adapter.path}/players/${scope.playerId}`,undefined,{object:true}));
  if(data.data.id!==scope.playerId||!playerName(data.data))throw new AppError('A verified player identity was not returned.',502,'PERFORMANCE_BAD_DATA');
  return data.data;
 }
 const result=await cached(`performance-player-search:${scope.league}:${identity(scope.player)}`,86400,()=>pages(adapter.path+'/players',new URLSearchParams({[scope.league==='icehockey_nhl'?'name':'search']:scope.player,per_page:'100'})));
 const matches=result.rows.filter(p=>Number.isInteger(p?.id)&&identity(playerName(p))===identity(scope.player));
 if(!result.complete||matches.length!==1)throw new AppError(matches.length>1?'More than one player has that exact name. Choose a provider player ID to distinguish them.':'No unique exact player name match was found. Check the full player name; no approximate match was used.',422,'PERFORMANCE_PLAYER_MATCH');
 return matches[0];
}
export function performanceParameters(league,playerId,now=Date.now()){
 const p=new URLSearchParams({per_page:'100'});p.append('player_ids[]',String(playerId));
 const year=new Date(now).getUTCFullYear(),month=new Date(now).getUTCMonth();
 if(league==='basketball_nba'){p.set('start_date',new Date(now-120*day).toISOString().slice(0,10));p.set('end_date',new Date(now).toISOString().slice(0,10));p.set('period','0');}
 else if(league==='americanfootball_nfl'){const season=month<7?year-1:year;p.append('seasons[]',String(season));p.append('seasons[]',String(season-1));}
 else if(league==='icehockey_nhl'){p.set('season',String(month<7?year-1:year));}
 return p;
}

/** Null/absent values are excluded instead of silently converted to zero. */
export function normalizePlayerResult(raw,{league,statType,playerId,teams=new Map(),game=null,now=Date.now()}={}){
 if(!raw||raw.player?.id!==playerId)return null;
 const g=game||raw.game;
 if(!g||!finalGame(g,league)||g.postponed||['spring_training','preseason'].includes(g.season_type))return null;
 const date=g.datetime||g.start_time_utc||g.date||g.game_date,stamp=Date.parse(date);
 if(!Number.isFinite(stamp)||stamp>=now||stamp<now-120*day||g.id==null)return null;
 const value=statType==='pts_reb_ast'?[raw.pts,raw.reb,raw.ast].every(numeric)?raw.pts+raw.reb+raw.ast:null:raw[statType];
 if(!numeric(value))return null;
 const home=g.home_team||teams.get(g.home_team_id),away=g.visitor_team||g.away_team||teams.get(g.visitor_team_id||g.away_team_id),teamId=raw.team?.id??raw.player?.team_id;
 const homeId=home?.id??g.home_team_id,awayId=away?.id??g.visitor_team_id??g.away_team_id;
 if(!Number.isInteger(teamId)||![homeId,awayId].includes(teamId))return null;
 const atHome=teamId===homeId,opponent=teamName(atHome?away:home);
 if(!opponent)return null;
 return {gameId:`bdl:${league}:${g.id}`,date,opponent,homeAway:atHome?'home':'away',value,completed:true,source:`BALLDONTLIE ${PERFORMANCE_LEAGUES[league].title}`,providerUpdatedAt:g.updated_at||null};
}
export function summarizePlayerRows(rows,{window=5,line=null,complete=true}={}){
 const selected=[...rows].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,window),values=selected.map(r=>r.value),sampleSize=selected.length;
 const over=line===null?null:values.filter(v=>v>line).length,under=line===null?null:values.filter(v=>v<line).length,push=line===null?null:values.filter(v=>v===line).length;
 return {rows:selected,summary:{sampleSize,requestedWindow:window,average:sampleSize?values.reduce((a,b)=>a+b,0)/sampleSize:null,min:sampleSize?Math.min(...values):null,max:sampleSize?Math.max(...values):null,line,over,under,push,overRate:line===null||!sampleSize?null:over/sampleSize,underRate:line===null||!sampleSize?null:under/sampleSize,hitRate:line===null||!sampleSize?null:over/sampleSize,partial:!complete||sampleSize<window,description:complete?'Most recent available completed-game rows in the stated provider sample.':'Partial returned sample; these rows cannot establish the most recent games.'}};
}

export async function loadPlayerPerformance(scope){
 if(scope.provider==='public'||(scope.provider!=='balldontlie'&&!env('BALLDONTLIE_API_KEY').trim()&&scope.player)){
  const data=await loadPublicPlayerPerformance(scope),summary=summarizePlayerRows(data.rows,{window:scope.window,line:scope.line,complete:data.complete});
  const limitations=[...data.limitations];if(summary.summary.sampleSize<scope.window)limitations.push(`Only ${summary.summary.sampleSize} verified completed appearances were available for this ${scope.window}-game request.`);
  return {mode:'live',kind:'player',...data,...summary,league:scope.league,statType:scope.statType,line:scope.line,sourceSelection:scope.provider==='public'?'Public publisher source explicitly selected.':'No BALLDONTLIE key configured; real public publisher source selected. No fake data is used.',limitations};
 }
 if(!env('BALLDONTLIE_API_KEY').trim())throw new AppError('BALLDONTLIE player IDs require its server-side key. Search by full player name for real public statistics, or explicitly choose provider=public with that publisher\'s own player ID.',503,'PERFORMANCE_NOT_CONFIGURED');
 const adapter=PERFORMANCE_LEAGUES[scope.league],key=`performance:${scope.league}:${scope.playerId||identity(scope.player)}:${scope.statType}:${scope.window}:${scope.line}`;
 return cached(key,900,async()=>{
  const player=await resolvePlayer(scope),params=performanceParameters(scope.league,player.id),limitations=['Completed-game results only. Missing/null statistics are excluded, never counted as zero.','Past averages and sample hit rates are descriptive; they are not calibrated win probabilities or model performance.','Injuries, player availability, starting lineups, weather and travel are not verified.'];
  let stats,teams=new Map(),games=new Map(),complete=true;
  if(scope.league==='baseball_mlb'){
   if(!Number.isInteger(player.team?.id??player.team_id))throw new AppError('The player has no verified current team for recent-game lookups.',422,'PERFORMANCE_TEAM_MATCH');
   // MLB stats reference game_id rather than a dated game: join only verified team games.
   const dates=new URLSearchParams({per_page:'100'});dates.append('team_ids[]',String(player.team?.id??player.team_id));
   for(let d=0;d<=35;d++)dates.append('dates[]',new Date(Date.now()-d*day).toISOString().slice(0,10));
   const scheduled=await pages(adapter.path+'/games',dates);complete=scheduled.complete;
   for(const game of scheduled.rows)if(Number.isInteger(game?.id)&&finalGame(game,scope.league))games.set(game.id,game);
   if(games.size){for(const id of games.keys())params.append('game_ids[]',String(id));stats=await pages(adapter.path+adapter.stats,params);}else stats={rows:[],complete:true};
   limitations.push('MLB scope is completed games returned for the verified current team in the last 35 days. Games for a previous team after a trade may be missing.');
  }else stats=await pages(adapter.path+adapter.stats,params);
  if(scope.league==='basketball_nba'){
   const catalog=await cached('performance-teams:nba',86400,()=>pages(adapter.path+'/teams',new URLSearchParams({per_page:'100'})));
   complete=complete&&catalog.complete;teams=new Map(catalog.rows.filter(t=>Number.isInteger(t?.id)).map(t=>[t.id,t]));
  }
  complete=complete&&stats.complete;
  const dedupe=new Map();
  for(const raw of stats.rows){const row=normalizePlayerResult(raw,{league:scope.league,statType:scope.statType,playerId:player.id,teams,game:scope.league==='baseball_mlb'?games.get(raw.game_id):null});if(row)dedupe.set(row.gameId,row);}
  const summary=summarizePlayerRows([...dedupe.values()],{window:scope.window,line:scope.line,complete});
  if(!complete)limitations.push('Provider pagination limit reached. The visible rows are a partial sample, not verified last-N history.');
  if(summary.summary.sampleSize<scope.window)limitations.push(`Only ${summary.summary.sampleSize} usable completed rows were returned for the requested ${scope.window}-game window.`);
  return {mode:'live',kind:'player',source:`BALLDONTLIE ${adapter.title}`,league:scope.league,player:{id:player.id,name:playerName(player)},statType:scope.statType,line:scope.line,...summary,complete,fetchedAt:new Date().toISOString(),sampleScope:scope.league==='baseball_mlb'?'Current-team completed games in the last 35 days.':'Returned completed games within 120 days, with supported season filters.',limitations};
 });
}

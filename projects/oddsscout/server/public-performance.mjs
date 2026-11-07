/** Real, server-fetched publisher game logs. Public feeds may change or become unavailable.
 * MLB: league-owned StatsAPI. NBA/NFL/NHL: ESPN's own player log and event-status feeds.
 * No result, identity, final status, missing statistic, or source timestamp is fabricated.
 */
import {AppError,cached,mapConcurrent} from './common.mjs';

export const PUBLIC_PERFORMANCE={
 basketball_nba:{sport:'basketball',league:'nba',title:'NBA',source:'ESPN NBA player game logs',fields:{pts:'points',reb:'totalRebounds',ast:'assists',fg3m:'threePointFieldGoalsMade-threePointFieldGoalsAttempted',stl:'steals',blk:'blocks',turnover:'turnovers',pts_reb_ast:['points','totalRebounds','assists']}},
 americanfootball_nfl:{sport:'football',league:'nfl',title:'NFL',source:'ESPN NFL player game logs',fields:{passing_yards:'passingYards',passing_touchdowns:'passingTouchdowns',rushing_yards:'rushingYards',rushing_touchdowns:'rushingTouchdowns',receiving_yards:'receivingYards',receptions:'receptions',receiving_touchdowns:'receivingTouchdowns'}},
 baseball_mlb:{title:'MLB',source:'MLB StatsAPI player game logs',fields:{hits:'hits',runs:'runs',rbi:'rbi',hr:'homeRuns',total_bases:'totalBases',p_k:'strikeOuts',pitching_outs:'outs',stolen_bases:'stolenBases'}},
 icehockey_nhl:{sport:'hockey',league:'nhl',title:'NHL',source:'ESPN NHL player game logs',fields:{goals:'goals',assists:'assists',points:'points',shots_on_goal:'shotsTotal',saves:'saves'}}
};
const identity=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const validId=value=>/^[1-9]\d{0,9}$/.test(String(value));
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^-?\d+(\.\d+)?$/.test(value)?Number(value):null;
const missing=()=>new AppError('No unique exact player name match was returned for this league. Enter the full player name; no approximate player was substituted.',422,'PERFORMANCE_PLAYER_MATCH');
const sourceFailure=(code='PERFORMANCE_UNAVAILABLE')=>new AppError('The real player-results source is unavailable. No sample statistics were substituted. Retry later.',502,code);

async function request(url){
 let response;
 try{response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(6000)});}catch{throw sourceFailure();}
 if(response.status===429){const delay=Number(response.headers.get('retry-after'));throw new AppError('Player-results source is on cooldown. Retry later.',429,'PERFORMANCE_LIMIT',Number.isFinite(delay)&&delay>0?Math.min(delay,3600):60);}
 if(response.status===404)throw missing();
 if(!response.ok)throw sourceFailure();
 try{const body=await response.json();if(!body||typeof body!=='object')throw 0;return body;}catch{throw sourceFailure('PERFORMANCE_BAD_DATA');}
}
const espnBase=adapter=>`https://site.web.api.espn.com/apis/common/v3/sports/${adapter.sport}/${adapter.league}/athletes`;
const coreBase=adapter=>`https://sports.core.api.espn.com/v2/sports/${adapter.sport}/leagues/${adapter.league}`;

async function resolvePublicPlayer(scope,adapter){
 return cached(`public-player:${scope.league}:${scope.playerId||identity(scope.player)}`,86400,async()=>{
  if(scope.league==='baseball_mlb'){
   const url=scope.playerId?`https://statsapi.mlb.com/api/v1/people/${scope.playerId}`:`https://statsapi.mlb.com/api/v1/people/search?${new URLSearchParams({names:scope.player,sportIds:'1'})}`;
   const body=await request(url);if(!Array.isArray(body.people))throw sourceFailure('PERFORMANCE_BAD_DATA');
   const matches=body.people.filter(p=>validId(p?.id)&&p.isPlayer!==false&&(scope.playerId?Number(p.id)===scope.playerId:identity(p.fullName)===identity(scope.player)));
   if(matches.length!==1)throw missing();
   return {id:Number(matches[0].id),name:matches[0].fullName};
  }
  if(scope.playerId){
   const body=await request(`${coreBase(adapter)}/athletes/${scope.playerId}`);
   if(String(body.id)!==String(scope.playerId)||typeof body.displayName!=='string'||!body.displayName.trim())throw sourceFailure('PERFORMANCE_BAD_DATA');
   return {id:Number(body.id),name:body.displayName};
  }
  // The generic search defaults to media results and can omit players entirely.
  // Explicitly request player records; exact identity checks still apply below.
  const body=await request('https://site.web.api.espn.com/apis/search/v2?'+new URLSearchParams({region:'us',lang:'en',type:'player',limit:'20',query:scope.player}));
  if(!Array.isArray(body.results))throw sourceFailure('PERFORMANCE_BAD_DATA');
  const group=body.results.find(r=>r.type==='player');if(!group||!Array.isArray(group.contents))throw missing();
  const matches=group.contents.filter(p=>p?.defaultLeagueSlug===adapter.league&&p.sport===adapter.sport&&identity(p.displayName)===identity(scope.player)&&/~a:[1-9]\d{0,9}$/.test(p.uid||''));
  // A truncated search cannot establish a unique identity.
  const summaries=Array.isArray(body.resultTypes)?body.resultTypes.filter(r=>r?.type==='player'):[];
  const counts=[group.totalFound,...summaries.map(s=>s.totalFound)];
  if(matches.length!==1||summaries.length>1||counts.some(total=>!Number.isSafeInteger(total)||total!==group.contents.length))throw missing();
  return {id:Number(matches[0].uid.match(/~a:(\d+)$/)[1]),name:matches[0].displayName};
 });
}

/** Match fields by their provider names, never by an assumed column order. */
export function espnStatValue(names,stats,statType,league){
 if(!Array.isArray(names)||!Array.isArray(stats)||names.length!==stats.length)return null;
 const field=PUBLIC_PERFORMANCE[league]?.fields[statType];if(!field)return null;
 const get=name=>{const i=names.indexOf(name);return i<0||names.lastIndexOf(name)!==i?null:stats[i];};
 if(Array.isArray(field)){const values=field.map(name=>number(get(name)));return values.every(v=>v!==null)?values.reduce((a,b)=>a+b,0):null;}
 const raw=get(field);
 if(statType==='fg3m'){const pair=typeof raw==='string'?raw.match(/^(\d+)-(\d+)$/):null;return pair&&Number(pair[1])<=Number(pair[2])?Number(pair[1]):null;}
 return number(raw);
}

export function normalizeEspnPlayerRow(event,stats,body,{scope,player,finalStatus,now=Date.now()}={}){
 const adapter=PUBLIC_PERFORMANCE[scope.league],stamp=Date.parse(event?.gameDate);
 if(!validId(event?.id)||!Number.isFinite(stamp)||stamp>=now||!['vs','@'].includes(event.atVs)||typeof event.opponent?.displayName!=='string'||!event.opponent.displayName.trim())return null;
 if(finalStatus?.type?.completed!==true||finalStatus.type.state!=='post'||!['STATUS_FINAL','STATUS_FINAL_OVERTIME','STATUS_FINAL_SHOOTOUT'].includes(finalStatus.type.name))return null;
 const team=String(event.team?.id||''),home=String(event.homeTeamId||''),away=String(event.awayTeamId||'');
 if(!team||![home,away].includes(team)||String(event.opponent.id)!==(team===home?away:home)||(event.atVs==='vs')!==(team===home))return null;
 const value=espnStatValue(body.names,stats,scope.statType,scope.league);if(value===null)return null;
 return {gameId:`espn:${adapter.league}:${event.id}`,playerId:player.id,statType:scope.statType,date:new Date(stamp).toISOString(),opponent:event.opponent.displayName,homeAway:team===home?'home':'away',value,completed:true,source:adapter.source,providerUpdatedAt:null};
}

async function loadEspnRows(scope,adapter,player){
 const logs=[],seasons=[],warnings=[];let complete=true;
 const load=async season=>{
  const body=await cached(`public-log:${scope.league}:${player.id}:${season||'latest'}`,900,()=>request(`${espnBase(adapter)}/${player.id}/gamelog${season?'?season='+season:''}`));
  if(!Array.isArray(body.names)||!body.events||typeof body.events!=='object'||Array.isArray(body.events)||!Array.isArray(body.seasonTypes))throw sourceFailure('PERFORMANCE_BAD_DATA');
  const seasonValue=body.filters?.find(f=>f.name==='season')?.value;if(/^\d{4}$/.test(String(seasonValue)))seasons.push(Number(seasonValue));
  logs.push(body);return body;
 };
 const first=await load();
 const candidates=()=>{
  const map=new Map();
  for(const body of logs)for(const season of body.seasonTypes){
   // Only named regular season/postseason logs count. Preseason/exhibition never counts.
   if(!/regular season|postseason|playoffs/i.test(season.displayName||''))continue;
   for(const category of season.categories||[])if(category.type==='event')for(const row of category.events||[]){
    const event=body.events[row.eventId];
    if(!event||String(event.id)!==String(row.eventId)||espnStatValue(body.names,row.stats,scope.statType,scope.league)===null||Date.parse(event.gameDate)>=Date.now())continue;
    if(validId(event.id))map.set(String(event.id),{event,stats:row.stats,body});
   }
  }
  return [...map.values()].sort((a,b)=>Date.parse(b.event.gameDate)-Date.parse(a.event.gameDate));
 };
 if(candidates().length<scope.window&&seasons.length){
  const previous=seasons[0]-1,options=first.filters?.find(f=>f.name==='season')?.options;
  if(Array.isArray(options)&&options.some(o=>String(o.value)===String(previous))){try{await load(previous);}catch{complete=false;warnings.push('The preceding season could not be loaded; the visible sample is partial.');}}
 }
 const selected=candidates().slice(0,scope.window),rows=[];
 const checked=await mapConcurrent(selected,4,async candidate=>{
  try{
   const finalStatus=await cached(`public-final:${scope.league}:${candidate.event.id}`,86400,()=>request(`${coreBase(adapter)}/events/${candidate.event.id}/competitions/${candidate.event.id}/status`));
   return normalizeEspnPlayerRow(candidate.event,candidate.stats,candidate.body,{scope,player,finalStatus});
  }catch{complete=false;return null;}
 });
 for(const row of checked)if(row)rows.push(row);else complete=false;
 if(!complete)warnings.push('Some requested results could not be verified as final or were unavailable. They are excluded; no replacement values are inserted.');
 const hasField=logs.some(log=>Array.isArray(adapter.fields[scope.statType])?adapter.fields[scope.statType].every(n=>log.names.includes(n)):log.names.includes(adapter.fields[scope.statType]));
 if(!hasField)throw new AppError('This statistic is not supplied by the player game-log source for the selected player. Missing categories are never counted as zero.',422,'PERFORMANCE_STAT_UNAVAILABLE');
 return {rows,complete,warnings,sampleScope:`Most recent available regular-season and postseason appearances in ${[...new Set(seasons)].sort((a,b)=>b-a).join(' and ')||'the returned season'}. Each included event is separately verified final. Preseason excluded.`};
}

/** Innings are base-three outs, not decimal time: 6.2 IP is 20 outs. */
export function inningsToOuts(value){const match=String(value??'').match(/^(\d+)\.([012])$/);return match?Number(match[1])*3+Number(match[2]):null;}
export function normalizeMlbPlayerRow(split,game,{scope,player,now=Date.now()}={}){
 const stamp=Date.parse(game?.gameDate),id=split?.game?.gamePk;
 if(!validId(id)||Number(game?.gamePk)!==Number(id)||Number(split?.player?.id)!==player.id||split.sport?.id!==1||split.gameType!=='R'||game.gameType!=='R'||game.status?.abstractGameState!=='Final'||!Number.isFinite(stamp)||stamp>=now)return null;
 const home=game.teams?.home?.team,away=game.teams?.away?.team,teamId=split.team?.id;
 if(!Number.isInteger(teamId)||![home?.id,away?.id].includes(teamId)||split.opponent?.id!==(teamId===home?.id?away?.id:home?.id))return null;
 const opponent=teamId===home.id?away:home;if(!opponent?.name)return null;
 const field=PUBLIC_PERFORMANCE.baseball_mlb.fields[scope.statType];let value=number(split.stat?.[field]);
 if(scope.statType==='pitching_outs'&&value===null)value=inningsToOuts(split.stat?.inningsPitched);
 if(value===null||value<0)return null;
 return {gameId:`mlb:${id}`,playerId:player.id,statType:scope.statType,date:new Date(stamp).toISOString(),opponent:opponent.name,homeAway:teamId===home.id?'home':'away',value,completed:true,source:PUBLIC_PERFORMANCE.baseball_mlb.source,providerUpdatedAt:null};
}

async function loadMlbRows(scope,player){
 const group=['p_k','pitching_outs'].includes(scope.statType)?'pitching':'hitting',year=new Date().getUTCFullYear(),splits=[],seasons=[];
 let complete=true;const warnings=[];
 const load=async season=>{
  const body=await cached(`public-mlb-log:${player.id}:${group}:${season}`,900,()=>request(`https://statsapi.mlb.com/api/v1/people/${player.id}/stats?`+new URLSearchParams({stats:'gameLog',group,season:String(season),gameType:'R'})));
  if(!Array.isArray(body.stats))throw sourceFailure('PERFORMANCE_BAD_DATA');
  for(const bucket of body.stats)if(bucket.type?.displayName==='gameLog'&&bucket.group?.displayName===group){if(!Array.isArray(bucket.splits))throw sourceFailure('PERFORMANCE_BAD_DATA');splits.push(...bucket.splits);}
  seasons.push(season);
 };
 await load(year);if(splits.length<scope.window){try{await load(year-1);}catch{complete=false;warnings.push('Previous-season results could not be loaded; the returned sample is partial.');}}
 const candidates=[...new Map(splits.filter(r=>validId(r?.game?.gamePk)&&r.player?.id===player.id&&r.gameType==='R').sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||b.game.gamePk-a.game.gamePk).map(r=>[String(r.game.gamePk),r])).values()].slice(0,Math.min(25,scope.window+5));
 if(!candidates.length)return {rows:[],complete,warnings,sampleScope:`MLB regular-season ${group} appearances in ${seasons.join(' and ')}. No usable rows returned.`};
 const schedule=await cached(`public-mlb-finals:${candidates.map(r=>r.game.gamePk).join(',')}`,900,()=>request('https://statsapi.mlb.com/api/v1/schedule?'+new URLSearchParams({sportId:'1',gamePks:candidates.map(r=>r.game.gamePk).join(',')})));
 if(!Array.isArray(schedule.dates))throw sourceFailure('PERFORMANCE_BAD_DATA');
 const games=new Map(schedule.dates.flatMap(d=>Array.isArray(d.games)?d.games:[]).map(g=>[String(g.gamePk),g])),rows=[];
 for(const split of candidates){const row=normalizeMlbPlayerRow(split,games.get(String(split.game.gamePk)),{scope,player});if(row)rows.push(row);else complete=false;}
 if(!complete)warnings.push('Some source rows lacked a matching final MLB game or statistic and were excluded.');
 return {rows,complete,warnings,sampleScope:`Most recent available MLB regular-season ${group} appearances in ${seasons.join(' and ')}. Game status, player and opponent verified against MLB schedule. Postseason and spring training are excluded.`};
}

export async function loadPublicPlayerPerformance(scope){
 const adapter=PUBLIC_PERFORMANCE[scope.league];
 if(!adapter||!adapter.fields[scope.statType])throw new AppError('This statistic is unavailable from the public player-results adapter. No substitute statistic is used.',422,'PERFORMANCE_STAT_UNAVAILABLE');
 return cached(`public-performance:${scope.league}:${scope.playerId||identity(scope.player)}:${scope.statType}:${scope.window}`,900,async()=>{
  const player=await resolvePublicPlayer(scope,adapter);
  const data=scope.league==='baseball_mlb'?await loadMlbRows(scope,player):await loadEspnRows(scope,adapter,player);
  return {...data,player,source:adapter.source,provider:scope.league==='baseball_mlb'?'mlb-statsapi':'espn',fetchedAt:new Date().toISOString(),limitations:[
   'Real publisher results only. Public endpoints may be incomplete, unavailable or change without notice. No service-level guarantee or sportsbook settlement verification.',
   'Missing/null statistics are excluded, never counted as zero. Did-not-play appearances are excluded rather than treated as a zero.',
   'Retrieval time is shown separately from game time. The feed does not provide a verified per-stat update timestamp.',
   'Past averages and hit rates describe this sample; they are not calibrated predictions. Injuries, starting lineups, usage and opponent rankings are not connected.',
   ...data.warnings
  ]};
 });
}

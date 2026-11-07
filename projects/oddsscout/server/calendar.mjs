import {AppError,cached,mapConcurrent} from './common.mjs';
import {loadSports,providerRequest,requireOddsKey,ALL_LEAGUES_BATCH_SIZE} from './provider.mjs';

export const CALENDAR_REFRESH_SECONDS=300;
const COVERAGE='Upcoming fixtures currently published by The Odds API for the selected leagues. This feed is not a complete season calendar; games can be added, moved, or removed.';
const LIMITATIONS=['Calendar listings contain scheduled start times, not a promise that odds are available. Open Game Center to request current markets.','A scheduled start alone does not confirm an in-play game. Check Game Center for available live status.'];
const safeKey=value=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,90}$/.test(value);

export function readCalendarScope(url) {
  for(const key of url.searchParams.keys())if(!['league','page'].includes(key)||url.searchParams.getAll(key).length!==1)throw new AppError('Unsupported calendar query parameters.',400,'BAD_QUERY');
  const league=url.searchParams.has('league')?url.searchParams.get('league'):'americanfootball_nfl',rawPage=url.searchParams.has('page')?url.searchParams.get('page'):'0';
  if(!safeKey(league)||league==='upcoming'||!/^(0|[1-9]\d{0,3})$/.test(rawPage)||(url.searchParams.has('page')&&league!=='all'))throw new AppError('Choose an available calendar league and valid league batch.',400,'BAD_QUERY');
  return {league,page:Number(rawPage)};
}

function scheduleError(error) {
  if(!(error instanceof AppError))return new AppError('The schedule provider is temporarily unavailable. No replacement events were loaded.',502,'PROVIDER_UNAVAILABLE');
  const messages={
    PROVIDER_UNAVAILABLE:'The schedule provider is temporarily unavailable. No replacement events were loaded.',
    BAD_FEED:'The schedule provider returned unreadable or invalid event data. No replacement events were loaded.',
    UNSUPPORTED_FEED:'This league schedule is unavailable from the provider.',
    PROVIDER_REQUEST:'The provider rejected this schedule request. Check the provider configuration.'
  };
  return messages[error.code]?new AppError(messages[error.code],error.status,error.code,error.retryAfter):error;
}

function normalizeSchedule(rows,sport,now) {
  const events=new Map();let invalid=0,past=0;
  for(const row of rows) {
    if(!row||typeof row.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(row.id)||row.sport_key!==sport.key||typeof row.commence_time!=='string'||!Number.isFinite(Date.parse(row.commence_time))||typeof row.home_team!=='string'||!row.home_team.trim()||row.home_team.length>180||typeof row.away_team!=='string'||!row.away_team.trim()||row.away_team.length>180||row.home_team.trim()===row.away_team.trim()) {invalid++;continue;}
    if(Date.parse(row.commence_time)<=now){past++;continue;}
    const event={id:row.id,sport_key:sport.key,sport_title:sport.title,home_team:row.home_team.trim(),away_team:row.away_team.trim(),commence_time:new Date(row.commence_time).toISOString(),status:'upcoming',bookmakers:[]};
    const previous=events.get(event.id);
    // A duplicated ID with conflicting fixture details is not a reliable event.
    if(previous&&JSON.stringify(previous)!==JSON.stringify(event))throw new AppError('The schedule provider returned conflicting event identifiers. No replacement events were loaded.',502,'BAD_FEED');
    events.set(event.id,event);
  }
  if(rows.length&&invalid===rows.length)throw new AppError('The schedule provider returned invalid event data. No replacement events were loaded.',502,'BAD_FEED');
  return {events:[...events.values()].sort((a,b)=>a.commence_time.localeCompare(b.commence_time)||a.id.localeCompare(b.id)),invalid,past};
}

async function leagueSchedule(sport) {
  return cached(`calendar-events:${sport.key}`,CALENDAR_REFRESH_SECONDS,async()=>{
    let result;
    try {result=await providerRequest(`/sports/${sport.key}/events`,{dateFormat:'iso'});}
    catch(error){throw scheduleError(error);}
    const fetchedAt=new Date().toISOString(),normalized=normalizeSchedule(result.data,sport,Date.parse(fetchedAt));
    return {mode:'live',source:'The Odds API',league:sport.key,events:normalized.events,fetchedAt,refreshSeconds:CALENDAR_REFRESH_SECONDS,coverage:COVERAGE,limitations:LIMITATIONS,warnings:normalized.invalid?[`${normalized.invalid} invalid schedule row${normalized.invalid===1?' was':'s were'} omitted for ${sport.title}.`]:[],usage:result.usage};
  });
}

/** Schedule-only requests never fetch /odds, /scores, or bookmaker markets. */
export async function loadCalendar(league='americanfootball_nfl',page=0) {
  requireOddsKey();
  if(!safeKey(league)||league==='upcoming'||!Number.isInteger(page)||page<0)throw new AppError('Choose an available calendar league and valid league batch.',400,'BAD_QUERY');
  const catalog=await loadSports();
  if(catalog.sports.some(s=>!safeKey(s.key)))throw new AppError('The schedule provider returned an invalid league catalog.',502,'BAD_FEED');
  const sports=[...new Map(catalog.sports.map(s=>[s.key,s])).values()].sort((a,b)=>a.key.localeCompare(b.key));
  if(league!=='all') {
    if(page!==0)throw new AppError('Calendar pagination is only available for all leagues.',400,'BAD_PAGE');
    const sport=sports.find(s=>s.key===league);
    if(!sport)throw new AppError('This league is not currently available in the active schedule feed.',400,'BAD_LEAGUE');
    const schedule=await leagueSchedule(sport);
    return {...schedule,events:schedule.events.filter(event=>Date.parse(event.commence_time)>Date.now())};
  }
  const totalPages=Math.max(1,Math.ceil(sports.length/ALL_LEAGUES_BATCH_SIZE));
  if(page>=totalPages)throw new AppError('This calendar league batch is out of range. Refresh the catalog.',400,'BAD_PAGE');
  // Successful league snapshots are cached independently. Partial pages are retried
  // without promoting failed leagues to an empty, apparently complete calendar.
  const selected=sports.slice(page*ALL_LEAGUES_BATCH_SIZE,(page+1)*ALL_LEAGUES_BATCH_SIZE);
  let halted=null;
  const results=await mapConcurrent(selected,2,async sport=>{
    if(halted)return {key:sport.key,title:sport.title,error:'Not requested after provider cooldown or access failure.',code:'SKIPPED'};
    try {return {key:sport.key,title:sport.title,schedule:await leagueSchedule(sport)};}
    catch(error) {
      const safe=scheduleError(error);
      if(['PROVIDER_LIMIT','PROVIDER_AUTH','PROVIDER_ACCESS'].includes(safe.code))halted={code:safe.code,retryAfter:safe.retryAfter||60};
      return {key:sport.key,title:sport.title,error:safe.message,code:safe.code,status:safe.status,retryAfter:safe.retryAfter};
    }
  });
  const successful=results.filter(r=>r.schedule),failed=results.filter(r=>!r.schedule);
  if(selected.length&&!successful.length) {
    const failure=failed.find(r=>r.code===halted?.code)||failed.find(r=>r.code!=='SKIPPED');
    throw new AppError(failure?.error||'No selected league schedules are available. No replacement events were loaded.',failure?.status||502,failure?.code||'PROVIDER_UNAVAILABLE',failure?.retryAfter);
  }
  const now=Date.now(),upcoming=schedule=>schedule.events.filter(event=>Date.parse(event.commence_time)>now);
  const events=successful.flatMap(r=>upcoming(r.schedule)).sort((a,b)=>a.commence_time.localeCompare(b.commence_time)||a.id.localeCompare(b.id));
  const snapshots=successful.map(r=>r.schedule.fetchedAt).sort(),remaining=successful.map(r=>r.schedule.usage.remaining).filter(Number.isFinite),costs=successful.map(r=>r.schedule.usage.cost).filter(Number.isFinite);
  return {mode:'live',source:'The Odds API',league:'all',events,fetchedAt:snapshots[0]||new Date().toISOString(),refreshSeconds:CALENDAR_REFRESH_SECONDS,coverage:COVERAGE,limitations:LIMITATIONS,warnings:[...successful.flatMap(r=>r.schedule.warnings),...(failed.length?[`${failed.length} selected league schedule${failed.length===1?' is':'s are'} unavailable. Those leagues are not represented by empty dates.`]:[]),...(!sports.length?['The provider currently lists no active event leagues.']:[])],usage:{remaining:remaining.length?Math.min(...remaining):null,cost:costs.length?costs.reduce((sum,n)=>sum+n,0):null},batch:{page,totalPages,nextPage:!halted&&page+1<totalPages?page+1:null,totalLeagues:sports.length,loaded:successful.map(({key,title,schedule})=>({key,title,events:upcoming(schedule).length})),failed:failed.map(({key,title,error,code})=>({key,title,error,code})),halted}};
}

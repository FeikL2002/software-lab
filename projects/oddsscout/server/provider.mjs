import {env,AppError,cached,mapConcurrent} from './common.mjs';
import {DEFAULT_BOOKS} from '../public/lib/odds.mjs';
import {canonicalSportsbookId} from '../public/lib/sportsbooks.mjs';
import {adaptOddsEvent,normalizeEvents,adaptMarketAvailability} from './adapters.mjs';
import {observeQuotes,movementsForEvent} from './observations.mjs';

const BASE='https://api.the-odds-api.com/v4';
export function requireOddsKey() {
  if (!env('ODDS_API_KEY').trim()) throw new AppError('Live odds are not configured. The owner must set ODDS_API_KEY in Netlify environment variables with Functions scope and redeploy. No sample betting data has been substituted.',503,'ODDS_NOT_CONFIGURED');
}
export function configuredBooks() {
  const keys=(env('ODDS_BOOKMAKERS').trim()||DEFAULT_BOOKS.join(',')).split(',').map(s=>s.trim()).filter(Boolean);
  if (!keys.length||keys.some(k=>!/^[a-z][a-z0-9_]{0,90}$/.test(k))) throw new AppError('ODDS_BOOKMAKERS must contain comma-separated provider keys. Check the provider documentation; no alternative books were queried.',503,'BAD_CONFIG');
  return [...new Set(keys.map(canonicalSportsbookId))];
}
export function coverageParameters() {
  const explicit=env('ODDS_BOOKMAKERS').trim();
  if (explicit) return {bookmakers:configuredBooks().join(',')};
  const regions=[...new Set((env('ODDS_REGIONS').trim()||'us,us2').split(',').map(s=>s.trim()).filter(Boolean))];
  if (!regions.length||regions.some(r=>!['us','us2','uk','eu','au','ca','fr','se','fi'].includes(r))) throw new AppError('ODDS_REGIONS contains an unsupported provider region.',503,'BAD_CONFIG');
  return {regions:regions.join(',')};
}
export async function providerRequest(path,params={},shape='array') {
  requireOddsKey();
  const url=new URL(`${BASE}${path}`);url.searchParams.set('apiKey',env('ODDS_API_KEY').trim());
  for (const [key,value] of Object.entries(params)) url.searchParams.set(key,String(value));
  let response;
  try {response=await fetch(url,{signal:AbortSignal.timeout(7500),headers:{Accept:'application/json'}});} catch {throw new AppError('The odds provider did not respond. No new prices were loaded.',502,'PROVIDER_UNAVAILABLE');}
  if (!response.ok) {
    if (response.status===401) throw new AppError('The odds key is invalid or its credit allowance is exhausted. Check the provider account.',503,'PROVIDER_AUTH');
    if (response.status===403) throw new AppError('The data plan does not allow this request. Check bookmaker access and the provider subscription.',503,'PROVIDER_ACCESS');
    if (response.status===429) {
      const header=response.headers.get('retry-after');
      const parsed=header&&/^\d+$/.test(header)?Number(header):Math.ceil((Date.parse(header)-Date.now())/1000);
      const seconds=Number.isFinite(parsed)&&parsed>0?Math.min(3600,parsed):60;
      throw new AppError('The data provider is on cooldown. Retry after the indicated delay.',429,'PROVIDER_LIMIT',seconds);
    }
    if ([404,422].includes(response.status)) throw new AppError('This event, sport, or market is unavailable from the provider.',422,'UNSUPPORTED_FEED');
    if (response.status===400) throw new AppError('The provider rejected the configured books, region or market. Check provider coverage and configuration.',503,'PROVIDER_REQUEST');
    throw new AppError('The data provider is temporarily unavailable. No new prices were loaded.',502,'PROVIDER_UNAVAILABLE');
  }
  let data;try {data=await response.json();} catch {throw new AppError('The provider returned unreadable data.',502,'BAD_FEED');}
  if (shape==='array'?!Array.isArray(data):(!data||typeof data!=='object'||Array.isArray(data))) throw new AppError('The provider returned an unexpected response.',502,'BAD_FEED');
  const number=name=>{const value=response.headers.get(name);return value!==null&&Number.isFinite(Number(value))?Number(value):null;};
  return {data,usage:{remaining:number('x-requests-remaining'),used:number('x-requests-used'),cost:number('x-requests-last')}};
}
export async function loadSports() {
  requireOddsKey();
  return cached('sports',3600,async()=>{
    const result=await providerRequest('/sports');
    const byKey=new Map();
    for(const sport of result.data) {
      if(sport?.active!==true)continue;
      if(typeof sport.key!=='string'||!/^[a-z][a-z0-9_]{0,90}$/.test(sport.key)||typeof sport.title!=='string'||!sport.title.trim()||sport.title.length>180||(sport.has_outrights!==undefined&&typeof sport.has_outrights!=='boolean'))throw new AppError('The provider returned an invalid active sport catalog. No substitute leagues were loaded.',502,'BAD_FEED');
      if(sport.key.startsWith('politics'))continue;
      const row={key:sport.key,title:sport.title.trim(),group:typeof sport.group==='string'?sport.group.slice(0,100):null,has_outrights:sport.has_outrights===true};
      const previous=byKey.get(row.key);
      if(previous&&JSON.stringify(previous)!==JSON.stringify(row))throw new AppError('The provider returned conflicting sport identifiers. Refresh the catalog later.',502,'BAD_FEED');
      byKey.set(row.key,row);
    }
    const valid=[...byKey.values()];
    const shape=({key,title,group,has_outrights})=>({key,title,group,has_outrights});
    return {mode:'live',sports:valid.filter(s=>!s.has_outrights).map(shape),futures:valid.filter(s=>s.has_outrights).map(shape),fetchedAt:new Date().toISOString()};
  });
}
async function validateLeague(league,market='h2h') {
  if (league==='upcoming') return;
  const catalog=await loadSports();
  const allowed=market==='outrights'?[...catalog.sports,...catalog.futures]:catalog.sports;
  if (!allowed.some(s=>s.key===league)) throw new AppError('This league is not currently available in the active feed.',400,'BAD_LEAGUE');
}
async function fetchScores(sport) {
  // Including one completed day prevents a recently finished fixture from being
  // mislabeled unknown while it is still present in a transient odds snapshot.
  return cached(`scores:${sport}`,30,()=>providerRequest(`/sports/${sport}/scores`,{dateFormat:'iso',daysFrom:1}));
}
function metadata(events,fetchedAt) {
  const normalized=normalizeEvents(events);
  observeQuotes(normalized.quotes,fetchedAt);
  const movements=events.flatMap(e=>movementsForEvent(e.id));
  const movementSamples=movements.flatMap(series=>series.points.map(point=>({eventId:series.eventId,groupId:series.groupId,book:series.sportsbookId,price:point.price,timestamp:point.timestamp,observedAt:point.observedAt,point:series.line,source:'Observed The Odds API snapshots'})));
  const returnedBookKeys=[...new Set(normalized.quotes.map(q=>q.sportsbookId))].sort();
  const sportsbookCoverage=returnedBookKeys.map(sportsbookId=>{
    const quotes=normalized.quotes.filter(q=>q.sportsbookId===sportsbookId),timestamps=quotes.map(q=>q.timestamp).filter(Boolean).sort((a,b)=>Date.parse(a)-Date.parse(b));
    return {sportsbookId,returnedQuotes:quotes.length,freshQuotes:quotes.filter(q=>q.fresh).length,availableQuotes:quotes.filter(q=>q.available).length,oldestSourceTimestamp:timestamps[0]||null,newestSourceTimestamp:timestamps.at(-1)||null};
  });
  return {normalized,returnedBookKeys,sportsbookCoverage,movements,movementSamples,movementStorage:{kind:'warm_instance',durable:false,retentionHours:48,maxPointsPerSeries:240,openingPricesVerified:false}};
}
// Older broad odds responses can omit market-level timestamps. Never promote
// a bookmaker timestamp to a live market timestamp: request the actual event
// market snapshot instead, with a hard per-board credit/concurrency bound.
export const LIVE_ENRICHMENT_LIMIT=6;
function missingMarketTimestamp(raw,market) {
  return raw.bookmakers.some(book=>book?.markets?.some(row=>row?.key===market&&Array.isArray(row.outcomes)&&row.outcomes.length&&(typeof row.last_update!=='string'||!Number.isFinite(Date.parse(row.last_update)))));
}
async function enrichLiveMarkets(events,scores,market,coverage,warnings,usages) {
  const candidates=events.filter(raw=>raw.kind!=='future'&&adaptOddsEvent(raw,scores.get(raw.id),[market])?.status==='live'&&missingMarketTimestamp(raw,market)).sort((a,b)=>a.id.localeCompare(b.id));
  const selected=candidates.slice(0,LIVE_ENRICHMENT_LIMIT),replacements=new Map();
  if(candidates.length>selected.length)warnings.push(`${candidates.length-selected.length} live games exceeded the market-timestamp lookup limit. Prices without verified market timestamps remain unavailable; open Game Center to request a selected game's actual market snapshot.`);
  let halted=false;
  await mapConcurrent(selected,2,async raw=>{
    if(halted){warnings.push(`Live market timestamp lookup skipped for ${raw.away_team} at ${raw.home_team} after provider cooldown or access failure. Unverified prices remain unavailable.`);return;}
    try {
      if(!/^[A-Za-z0-9_-]{1,128}$/.test(raw.id)||!/^[a-z][a-z0-9_]{0,90}$/.test(raw.sport_key))throw new AppError('The provider returned an invalid event identifier.',502,'BAD_FEED');
      const result=await cached(`live-odds:${raw.sport_key}:${raw.id}:${market}:${JSON.stringify(coverage)}`,30,()=>providerRequest(`/sports/${raw.sport_key}/events/${raw.id}/odds`,{...coverage,markets:market,oddsFormat:'decimal',dateFormat:'iso',includeLinks:'true'},'object'));
      if(result.data.id!==raw.id||result.data.sport_key!==raw.sport_key||!adaptOddsEvent(result.data,scores.get(raw.id),[market]))throw new AppError('The provider returned mismatched live event details.',502,'BAD_FEED');
      replacements.set(raw.id,result.data);usages.push(result.usage);
      if(missingMarketTimestamp(result.data,market))warnings.push(`The provider still omitted live market timestamps for ${raw.away_team} at ${raw.home_team}. Unverified prices remain unavailable.`);
    } catch(error) {
      if(['PROVIDER_LIMIT','PROVIDER_AUTH','PROVIDER_ACCESS'].includes(error.code))halted=true;
      warnings.push(`Live market timestamps unavailable for ${raw.away_team} at ${raw.home_team}. Unverified prices remain unavailable; open Game Center to retry.`);
    }
  });
  return events.map(raw=>replacements.get(raw.id)||raw);
}
export async function loadBoard(league='upcoming',market='h2h') {
  requireOddsKey();
  const books=configuredBooks(),coverage=coverageParameters();
  return cached(`board:${league}:${market}:${JSON.stringify(coverage)}`,value=>value?.refreshSeconds||60,async()=>{
    await validateLeague(league,market);
    const params={...coverage,markets:market,oddsFormat:'decimal',dateFormat:'iso',includeLinks:'true'};
    const scheduleTask=league==='upcoming'?Promise.resolve(null):cached(`events:${league}`,300,()=>providerRequest(`/sports/${league}/events`,{dateFormat:'iso'})).catch(()=>null);
    const odds=await providerRequest(`/sports/${league}/odds`,params);
    const schedule=await scheduleTask;
    const merged=new Map((schedule?.data||[]).filter(e=>e?.sport_key===league).map(e=>[e.id,{...e,bookmakers:[]}]));
    for (const event of odds.data) if (event&&typeof event.id==='string'&&(league==='upcoming'||event.sport_key===league)) merged.set(event.id,event);
    const valid=[...merged.values()].map(e=>market==='outrights'?{...e,kind:'future'}:e).filter(e=>adaptOddsEvent(e,null,[market]));
    const warnings=[],scores=new Map(),usages=[odds.usage];
    if (league!=='upcoming'&&!schedule) warnings.push('Schedule listing unavailable for '+league+'. Games without published odds may be missing.');
    const started=[...new Set(valid.filter(e=>e.kind!=='future'&&Date.parse(e.commence_time)<=Date.now()).map(e=>e.sport_key))];
    await mapConcurrent(started,4,async sport=>{
      try {const result=await fetchScores(sport);usages.push(result.usage);for (const score of result.data) scores.set(score.id,score);}
      catch {warnings.push(`Live score status unavailable for ${valid.find(e=>e.sport_key===sport)?.sport_title||sport}. Started fixtures remain unconfirmed.`);}
    });
    const enriched=await enrichLiveMarkets(valid,scores,market,coverage,warnings,usages);
    const fetchedAt=new Date().toISOString();
    const events=enriched.map(raw=>adaptOddsEvent(raw,scores.get(raw.id),[market],fetchedAt)).filter(e=>e&&e.status!=='completed');
    const left=usages.map(u=>u.remaining).filter(Number.isFinite);
    const liveOrUnconfirmed=events.some(e=>e.kind!=='future'&&(e.status==='live'||(e.status==='unknown'&&Date.parse(e.commence_time)<=Date.now())));
    return {mode:'live',source:'The Odds API',league,market,events,fetchedAt,configuredBooks:books,...metadata(events,fetchedAt),refreshSeconds:liveOrUnconfirmed?30:60,warnings,usage:{remaining:left.length?Math.min(...left):null},coverage:league==='upcoming'?'Provider live fixtures plus the next 8 upcoming games across sports. Open a league for its full available schedule.':'All live and upcoming fixtures returned for this league. Bookmaker plans and published market coverage still apply.',limitations:['Clock and period are not supplied by this odds provider.','Line movement contains actual observations retained by a warm server instance; earlier opening lines are not invented.']};
  });
}

export async function loadEventDetails(league,eventId,markets=['h2h','spreads','totals']) {
  requireOddsKey();
  if (!/^[a-z][a-z0-9_]{0,90}$/.test(league)||['all','upcoming'].includes(league)||!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) throw new AppError('Choose an available event and its league.',400,'BAD_QUERY');
  if (!Array.isArray(markets)||!markets.length||markets.length>20||markets.some(m=>typeof m!=='string'||!/^[a-z][a-z0-9_]{0,90}$/.test(m))||(markets.includes('available')&&markets.length!==1)) throw new AppError('Choose up to 20 valid market keys. Market discovery must be requested by itself.',400,'BAD_QUERY');
  const requested=[...new Set(markets)].sort(),coverage=coverageParameters(),discoveryOnly=requested.length===1&&requested[0]==='available';
  return cached(`detail:${league}:${eventId}:${requested.join(',')}:${JSON.stringify(coverage)}`,value=>value?.event?.status==='completed'?3600:value?.refreshSeconds||60,async()=>{
    await validateLeague(league,requested.includes('outrights')?'outrights':'h2h');
    const limitations=['Combined parlay prices and same-game-parlay eligibility are not supplied by this provider.','Clock and period are unavailable from The Odds API.','Movement begins at the first actual snapshot observed by this server instance and may reset across server instances or deployments.','Market discovery lists only recently seen keys; it is not complete provider coverage. Availability and subscription access vary by bookmaker, sport and market.'];
    let availability=[],discoveryUsage=null;
    // Handle discovery failure immediately to avoid an unhandled rejection while prices load.
    const discovery=cached(`markets:${league}:${eventId}:${JSON.stringify(coverage)}`,300,async()=>{
      const result=await providerRequest(`/sports/${league}/events/${eventId}/markets`,{...coverage,dateFormat:'iso'},'object');
      if(result.data.id!==eventId||(result.data.sport_key!==undefined&&result.data.sport_key!==league)||!Array.isArray(result.data.bookmakers))throw new AppError('The provider returned mismatched market discovery. No replacement markets were loaded.',502,'BAD_FEED');
      return result;
    }).then(result=>({result}),error=>({error}));
    let raw,oddsUsage=null;
    if (discoveryOnly) {
      const [events,discovered]=await Promise.all([providerRequest(`/sports/${league}/events`,{eventIds:eventId,dateFormat:'iso'}),discovery]);
      if(discovered.error)throw discovered.error;
      raw=events.data.find(e=>e.id===eventId);if(raw)raw={...raw,bookmakers:[]};
      availability=adaptMarketAvailability(discovered.result.data);discoveryUsage=discovered.result.usage;
    } else {
      const result=await providerRequest(`/sports/${league}/events/${eventId}/odds`,{...coverage,markets:requested.join(','),oddsFormat:'decimal',dateFormat:'iso',includeLinks:'true'},'object');
      raw=result.data;oddsUsage=result.usage;
      const discovered=await discovery;
      if(discovered.error)limitations.push('Market discovery is unavailable; displayed prices still reflect the markets returned by the provider.');
      else {availability=adaptMarketAvailability(discovered.result.data);discoveryUsage=discovered.result.usage;}
    }
    if (!raw||raw.id!==eventId||raw.sport_key!==league) throw new AppError('The provider no longer lists this event. Refresh the game board.',409,'EVENT_UNAVAILABLE');
    let score=null;
    if (!requested.includes('outrights')&&Date.parse(raw.commence_time)<=Date.now()) {
      try {score=(await fetchScores(league)).data.find(s=>s.id===eventId)||null;} catch {limitations.push('Live score status unavailable. A scheduled start alone cannot confirm an in-play game.');}
    }
    const fetchedAt=new Date().toISOString();
    const event=adaptOddsEvent(raw,score,discoveryOnly?null:requested,fetchedAt);
    if (!event) throw new AppError('The provider returned invalid event details. No prices were substituted.',502,'BAD_FEED');
    const availableMarkets=[...new Set([...availability.map(r=>r.market),...event.bookmakers.flatMap(b=>b.markets.map(m=>m.key))])].sort();
    const left=[oddsUsage?.remaining,discoveryUsage?.remaining].filter(Number.isFinite);
    return {mode:'live',source:'The Odds API',event,...metadata([event],fetchedAt),availableMarkets,marketAvailability:availability,fetchedAt,refreshSeconds:event.status==='completed'?null:event.kind==='future'||event.status==='upcoming'?60:30,configuredBooks:configuredBooks(),usage:{remaining:left.length?Math.min(...left):null},limitations};
  });
}

/** Deterministic batches bound upstream calls; clients follow nextPage. */
export const ALL_LEAGUES_BATCH_SIZE=3;
export async function loadAllBoardPage(market='h2h',page=0) {
  requireOddsKey();
  const catalog=await loadSports();
  const sports=[...(market==='outrights'?catalog.futures:catalog.sports)].sort((a,b)=>a.key.localeCompare(b.key));
  const totalPages=Math.max(1,Math.ceil(sports.length/ALL_LEAGUES_BATCH_SIZE));
  if (!Number.isInteger(page)||page<0||page>=totalPages) throw new AppError('This league batch is out of range. Refresh the catalog.',400,'BAD_PAGE');
  const books=configuredBooks(),coverage=coverageParameters();
  return cached(`all:${market}:${page}:${JSON.stringify(coverage)}:${sports.map(s=>s.key).join('|')}`,value=>value?.refreshSeconds||60,async()=>{
    const selected=sports.slice(page*ALL_LEAGUES_BATCH_SIZE,(page+1)*ALL_LEAGUES_BATCH_SIZE);
    let halted=null;
    const results=await mapConcurrent(selected,2,async sport=>{
      if (halted) return {key:sport.key,title:sport.title,error:'Not requested after provider cooldown.',code:'SKIPPED'};
      try {return {key:sport.key,title:sport.title,board:await loadBoard(sport.key,market)};}
      catch (error) {if (['PROVIDER_LIMIT','PROVIDER_AUTH','PROVIDER_ACCESS'].includes(error.code)) halted={code:error.code,retryAfter:error.retryAfter||60};return {key:sport.key,title:sport.title,error:error instanceof AppError?error.message:'League unavailable.',code:error.code||'LEAGUE_UNAVAILABLE',status:error instanceof AppError?error.status:502,retryAfter:error.retryAfter};}
    });
    const successful=results.filter(r=>r.board),failed=results.filter(r=>!r.board).map(({key,title,error,code})=>({key,title,error,code}));
    if(selected.length&&!successful.length){
      const failure=results.find(r=>r.code===halted?.code)||results.find(r=>r.code&&r.code!=='SKIPPED');
      throw new AppError(failure?.error||'The selected leagues are unavailable. No replacement events or odds were loaded.',failure?.status||502,failure?.code||'PROVIDER_UNAVAILABLE',failure?.retryAfter);
    }
    const byId=new Map();for (const row of successful) for (const event of row.board.events) byId.set(event.id,event);
    const events=[...byId.values()],snapshots=successful.map(r=>r.board.fetchedAt).sort(),left=successful.map(r=>r.board.usage?.remaining).filter(Number.isFinite),fetchedAt=snapshots[0]||new Date().toISOString();
    return {mode:'live',source:'The Odds API',league:'all',market,events,fetchedAt,configuredBooks:books,...metadata(events,fetchedAt),refreshSeconds:successful.some(r=>r.board.refreshSeconds===30)?30:60,usage:{remaining:left.length?Math.min(...left):null},warnings:[...new Set(successful.flatMap(r=>r.board.warnings||[]))],coverage:'League-by-league coverage of active event sports; provider coverage determines available markets and books.',batch:{page,totalPages,nextPage:!halted&&page+1<totalPages?page+1:null,totalLeagues:sports.length,loaded:successful.map(({key,title,board})=>({key,title,events:board.events.length})),failed,halted}};
  });
}

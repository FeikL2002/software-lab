/** Provider boundary. Raw payloads never need to be understood by the UI. */
import {BOOKS,classifyEvent,eventStatus,quoteFresh,isMoneylineMarket,isSpreadMarket,isTotalMarket} from '../public/lib/odds.mjs';
import {getSportsbook,canonicalSportsbookId} from '../public/lib/sportsbooks.mjs';

const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const text = value => typeof value === 'string' ? value.slice(0,300) : '';
const suspended = value => value?.suspended === true || ['suspended','closed','settled'].includes(value?.status);
export function safeProviderLink(value) {
  if (typeof value !== 'string') return null;
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;} catch {return null;}
}

export function adaptOddsEvent(raw,score=null,markets=null,fetchedAt=new Date().toISOString()) {
  if (!raw || typeof raw.id!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.id) || typeof raw.sport_key!=='string' || !/^[a-z][a-z0-9_]{0,90}$/.test(raw.sport_key) || !Array.isArray(raw.bookmakers)) return null;
  const future=raw.kind==='future'||markets?.includes('outrights')||raw.bookmakers.some(b=>b?.markets?.some(m=>m?.key==='outrights'));
  if (!future&&(typeof raw.home_team!=='string'||!raw.home_team.trim()||typeof raw.away_team!=='string'||!raw.away_team.trim()||raw.home_team===raw.away_team||raw.home_team.length>300||raw.away_team.length>300||!stamp(raw.commence_time))) return null;
  // A mismatched, duplicated or blank score row cannot establish live status.
  const scoreRows=Array.isArray(score?.scores)?score.scores:[];
  const validScores=scoreRows.length===2&&new Set(scoreRows.map(s=>s?.name)).size===2&&scoreRows.every(s=>s&&[raw.home_team,raw.away_team].includes(s.name)&&((typeof s.score==='number'&&Number.isFinite(s.score)&&s.score>=0)||(typeof s.score==='string'&&/^\d+(?:\.\d+)?$/.test(s.score))));
  if(score&&((score.id!==undefined&&score.id!==raw.id)||(score.sport_key!==undefined&&score.sport_key!==raw.sport_key)||(!validScores&&score.completed!==true)))score=null;
  const title=text(raw.sport_title)||text(raw.title)||raw.sport_key;
  const startTime=stamp(raw.commence_time);
  const status=future?(startTime&&Date.parse(startTime)>Date.now()?'upcoming':'unknown'):classifyEvent(raw,score);
  const permitted=markets ? new Set(markets) : null;
  const books=new Map();
  for (const book of raw.bookmakers) {
    if (!book || typeof book.key!=='string' || !/^[a-z][a-z0-9_]{0,90}$/.test(book.key) || !Array.isArray(book.markets)) continue;
    const canonical=canonicalSportsbookId(book.key),previous=books.get(canonical);
    const next={key:canonical,providerKeys:[...new Set([...(previous?.providerKeys||[]),book.key])],title:BOOKS[canonical]?.name||text(book.title)||canonical,last_update:stamp(book.last_update),link:safeProviderLink(book.link)||previous?.link||null,markets:[]};
    // Preserve each original market's source timestamp when duplicate book rows merge.
    // A newer duplicate book timestamp cannot refresh an older carried-over quote.
    if(previous)next.last_update=previous.last_update&&next.last_update?[previous.last_update,next.last_update].sort((a,b)=>Date.parse(a)-Date.parse(b))[0]:null;
    const byMarket=new Map((previous?.markets||[]).map(m=>[JSON.stringify([m.key,m.description||'']),m]));
    for (const market of book.markets) {
      if (!market || typeof market.key!=='string' || (permitted&&!permitted.has(market.key)) || !Array.isArray(market.outcomes)) continue;
      const outcomes=new Map();
      for (const outcome of market.outcomes) {
        if (!outcome || typeof outcome.name!=='string' || typeof outcome.price!=='number' || !Number.isFinite(outcome.price) || outcome.price<=1) continue;
        if (outcome.point!=null && (typeof outcome.point!=='number'||!Number.isFinite(outcome.point))) continue;
        const normalized={name:text(outcome.name),price:outcome.price,suspended:suspended(outcome),link:safeProviderLink(outcome.link),...(typeof outcome.point==='number'?{point:outcome.point}:{}),...(typeof outcome.description==='string'?{description:text(outcome.description)}:{})};
        outcomes.set(JSON.stringify([normalized.name,normalized.description||'',normalized.point??null]),normalized);
      }
      const marketStamp=stamp(market.last_update),bookStamp=status==='live'?null:stamp(book.last_update);
      const normalized={key:market.key,last_update:marketStamp||bookStamp,timestampSource:marketStamp?'market':bookStamp?'bookmaker':null,description:text(market.description),suspended:suspended(market)||suspended(book),link:safeProviderLink(market.link),outcomes:[...outcomes.values()]};
      const scope=JSON.stringify([normalized.key,normalized.description]);
      const old=byMarket.get(scope);
      if (!old || Date.parse(normalized.last_update)>=Date.parse(old.last_update) || !Number.isFinite(Date.parse(old.last_update))) byMarket.set(scope,normalized);
    }
    next.markets=[...byMarket.values()];
    books.set(canonical,next);
  }
  const scores=score&&validScores ? score.scores.map(s=>({name:text(s.name),score:String(s.score)})) : null;
  return {id:raw.id,kind:future?'future':'game',title,sport_key:raw.sport_key,sport_title:title,commence_time:startTime,home_team:future?null:text(raw.home_team),away_team:future?null:text(raw.away_team),status,statusCheckedAt:fetchedAt,scoreUpdatedAt:future?null:stamp(score?.last_update),scores:future?null:scores,period:null,clock:null,bookmakers:[...books.values()]};
}

export function normalizeEvents(events,now=Date.now()) {
  const uniqueEvents=new Map(events.map(e=>[e.id,e]));
  const quotes=[],books=new Map();
  for (const event of uniqueEvents.values()) {
    for (const book of event.bookmakers||[]) {
      const registered=getSportsbook(book.key,book.title);
      books.set(book.key,{id:book.key,name:registered.name,logo:registered.logo,providerKey:registered.providerKey||book.key,providerKeys:book.providerKeys||[book.key],stateAvailability:registered.stateAvailability,providerCoverage:registered.providerCoverage==='unsupported'?'returned_by_provider':registered.providerCoverage,registryProviderCoverage:registered.providerCoverage,deepLink:book.link||registered.url||null});
      for (const market of book.markets||[]) for (const outcome of market.outcomes||[]) {
        const timestamp=market.last_update||(eventStatus(event,now)==='live'?null:book.last_update)||null;
        const universe=isMoneylineMarket(market.key)||market.key==='outrights'?[...new Set(market.outcomes.map(o=>o.name))].sort().join('|'):'';
        const point=isMoneylineMarket(market.key)||market.key==='outrights'?null:outcome.point??null;
        const validLine=!(isSpreadMarket(market.key)||isTotalMarket(market.key)||(['Over','Under'].includes(outcome.name)&&market.key.startsWith('player_')))||point!==null;
        const groupId=JSON.stringify([market.key,universe,market.description||'',outcome.description||'',outcome.name,point]);
        const quote={id:JSON.stringify([event.id,book.key,market.key,market.description||'',outcome.description||'',outcome.name,point]),groupId,eventId:event.id,sportsbookId:book.key,market:market.key,selection:outcome.name,subject:outcome.description||market.description||null,line:point,price:outcome.price,timestamp,timestampSource:market.timestampSource||(timestamp?'bookmaker':null),source:'The Odds API',suspended:market.suspended||outcome.suspended||false,link:outcome.link||market.link||book.link||null};
        quote.fresh=quoteFresh({updatedAt:timestamp},event,now);
        quote.available=quote.fresh&&!quote.suspended&&validLine&&event.status!=='completed';
        quotes.push(quote);
      }
    }
  }
  return {events:[...uniqueEvents.values()].map(e=>({id:e.id,kind:e.kind,title:e.title,league:e.sport_key,homeTeam:e.home_team,awayTeam:e.away_team,startTime:e.commence_time,status:e.status,scores:e.scores,scoreTimestamp:e.scoreUpdatedAt,period:e.period,clock:e.clock})),quotes,books:[...books.values()]};
}

export function adaptMarketAvailability(raw) {
  const rows=new Map();
  for (const book of raw?.bookmakers||[]) if (typeof book?.key==='string'&&/^[a-z][a-z0-9_]{0,90}$/.test(book.key)&&Array.isArray(book.markets)) for (const market of book.markets) if (typeof market?.key==='string'&&/^[a-z][a-z0-9_]{0,90}$/.test(market.key)) {
    const sportsbookId=canonicalSportsbookId(book.key),id=JSON.stringify([sportsbookId,market.key]),timestamp=stamp(market.last_update),previous=rows.get(id);
    if(!previous||(!previous.timestamp&&timestamp)||Date.parse(timestamp)>Date.parse(previous.timestamp))rows.set(id,{sportsbookId,market:market.key,timestamp});
  }
  return [...rows.values()];
}

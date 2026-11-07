/** Observed-market analytics. No calibrated prediction model is bundled with OddsScout. */
import {compareGroups,decimalToAmerican,eventStatus,payout,isMoneylineMarket,isSpreadMarket,groupLabel} from './odds.mjs';
import {getSportsbook,canonicalSportsbookId} from './sportsbooks.mjs';
import {playerStatForMarket} from './performance-markets.mjs';

export const CONSENSUS_METHOD = 'Arithmetic mean of fresh decimal prices and implied probabilities for the exact selection. No-vig share normalizes inverse decimal prices within each complete matching outcome set, then averages those book shares. It is market-derived and is not a calibrated forecast or model edge.';
export const HEALTH_METHOD = 'Observed ticket-check score: freshness 35%, fresh quote breadth 25%, common-book coverage 25%, and unsupported overlap checks 15%. It measures research completeness only. Recent form, matchup, value, injury risk and variance receive no invented values.';
export const MOVEMENT_METHOD = 'History consists of timestamped observations of the exact event, market, subject, selection and line. First observed is not the market opening price. Price improving/worsening describes payout change. Steam requires at least three books with a same-direction implied-price change of at least 3 percentage points within the same five-minute window; causes are unknown.';
const mean = xs => xs.length ? xs.reduce((sum,n) => sum+n,0)/xs.length : null;
const validPrice = price => typeof price === 'number' && Number.isFinite(price) && price > 1;
const validPoint = point => point == null || (typeof point === 'number' && Number.isFinite(point));
const timestamp = iso => typeof iso === 'string' ? Date.parse(iso) : NaN;
const suspended = row => row?.suspended === true || ['suspended','closed','settled'].includes(row?.status);
const subject = row => row?.description || '';
const sameIdentity = (a,b) => a != null && b != null && String(a) === String(b);
const identity = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const realSource = row => row?.mode !== 'demo' && row?.fictional !== true && row?.synthetic !== true && typeof row?.source === 'string' && row.source.trim() && !/demo|fictional|synthetic|fixture/i.test(row.source);

function completeBookShare(event,group,book,now) {
  if (!book || suspended(book)) return null;
  for (const market of book.markets || []) {
    if (market?.key !== group.market || suspended(market) || !Array.isArray(market.outcomes) || (market.description || '') !== (group.marketDescription || '')) continue;
    const outcomes = market.outcomes.filter(o => o && !suspended(o) && validPrice(o.price) && validPoint(o.point) && subject(o) === (group.subject || group.description || ''));
    const target = outcomes.find(o => o.name === group.name && (o.point ?? null) === group.point);
    if (!target) continue;
    let expected;
    if (isMoneylineMarket(group.market)) {
      expected = (group.universe || JSON.parse(group.id)[1]).split('|');
      if (expected.length < 2 || expected.length > 3 || !expected.includes(event.home_team) || !expected.includes(event.away_team)) continue;
      if (expected.length === 3 && !expected.includes('Draw')) continue;
      if (new Set(outcomes.map(o => o.name)).size !== expected.length) continue;
    } else if (isSpreadMarket(group.market)) {
      expected = [event.home_team,event.away_team];
      if (!expected.includes(target.name)) continue;
    } else if (['Over','Under'].includes(group.name)) expected = ['Over','Under'];
    else if (['Yes','No'].includes(group.name)) expected = ['Yes','No'];
    else if (group.market === 'outrights' && market.completeOutcomeSet === true) expected = [...new Set(outcomes.map(o => o.name))];
    else continue;
    const set = expected.map(name => outcomes.filter(o => o.name === name && (isSpreadMarket(group.market) ? o.point === (name === target.name ? group.point : -group.point) : (o.point ?? null) === group.point)));
    if (set.some(rows => rows.length !== 1)) continue;
    const quote = group.freshQuotes.find(q => q.book === canonicalSportsbookId(book.key));
    const marketTime = market.last_update || (eventStatus(event,now)==='live'?null:book.last_update);
    if (!quote || target.price !== quote.price || marketTime !== quote.updatedAt || timestamp(quote.updatedAt) > now+30000) continue;
    const prices = set.map(rows => rows[0].price), total = prices.reduce((sum,p) => sum+1/p,0);
    if (total <= 0) continue;
    return {book:canonicalSportsbookId(book.key),probability:(1/target.price)/total,margin:total-1,outcomes:set.map(rows => ({selection:rows[0].name,line:rows[0].point ?? null,decimal:rows[0].price})),updatedAt:quote.updatedAt};
  }
  return null;
}

export function marketConsensus(event,group,{bookKeys=null,now=Date.now()}={}) {
  const resolved = group?.id ? compareGroups(event,group.market,{bookKeys,now}).find(g => g.id === group.id) : null;
  const quotes = resolved?.freshQuotes || [];
  const completeBooks = quotes.map(q => (event.bookmakers || []).filter(b => b && canonicalSportsbookId(b.key) === q.book).map(b => completeBookShare(event,resolved,b,now)).find(Boolean)).filter(Boolean);
  return {count:quotes.length,averageDecimal:mean(quotes.map(q => q.price)),averageImpliedProbability:mean(quotes.map(q => 1/q.price)),best:resolved?.best || null,worst:resolved?.worst || null,payoutDifferencePer100:resolved?.best && resolved?.worst ? 100*(resolved.best.price-resolved.worst.price) : null,noVigProbability:mean(completeBooks.map(b => b.probability)),completeBookCount:completeBooks.length,completeBooks,modelProbability:null,modelEdge:null,modelConfidence:null,method:CONSENSUS_METHOD,reason:quotes.length ? (completeBooks.length ? null : 'Complete matching outcome sets are unavailable; no no-vig share is calculated.') : 'No fresh quotes for this exact selection.'};
}
export const consensus = marketConsensus;

/** Any supported exact market can be inspected, but SGP/correlated products need sportsbook quotes. */
export function analyzeParlay(legs,{bookKeys=null,now=Date.now(),stake=10}={}) {
  const fail = reason => ({ok:false,reason,books:[],best:null,ties:[],legs:[],estimated:true,combinedImpliedProbability:null,noVigProbability:null,modelProbability:null,health:parlayHealth([],null)});
  if (!Array.isArray(legs) || legs.length < 2 || legs.length > 4) return fail('Choose two to four selections from separate upcoming games.');
  const events = new Set(), teams = new Set(), selections = new Set(), resolved = [];
  for (const leg of legs) {
    const event = leg?.event;
    if(event?.kind==='future')return fail('Futures legs can share season-long outcomes and require a sportsbook correlation-aware ticket quote. No combined estimate is invented.');
    if (!event?.id || eventStatus(event,now) !== 'upcoming') return fail('Ticket estimates support upcoming games with confirmed start times. Live or unconfirmed legs require a current sportsbook ticket quote.');
    if (events.has(event.id)) return fail('Same-game and duplicate legs require a sportsbook correlation-aware quote. No combined price or probability is invented.');
    events.add(event.id);
    for (const team of [event.home_team,event.away_team].filter(Boolean)) {
      const key = `${event.sport_key}|${team}`;
      if (teams.has(key)) return fail('Overlapping teams may make these legs correlated. Choose separate matchups or review a sportsbook quote.');
      teams.add(key);
    }
    const market = leg.market || leg.group?.market || (() => {try{return JSON.parse(leg.groupId)[0];}catch{return null;}})();
    const group = compareGroups(event,market,{bookKeys,now}).find(g => g.id === leg.groupId);
    if (!group?.best) return fail('An exact selection has missing, stale or suspended quotes. Refresh and review every leg.');
    const selectionKey = `${event.id}|${group.id}`;
    if (selections.has(selectionKey)) return fail('Duplicate selections cannot form a ticket.');
    selections.add(selectionKey);
    resolved.push({event,group,consensus:marketConsensus(event,group,{bookKeys,now})});
  }
  let common = new Set(resolved[0].group.freshQuotes.map(q => q.book));
  for (const {group} of resolved.slice(1)) common = new Set([...common].filter(book => group.freshQuotes.some(q => q.book === book)));
  const books = [...common].map(book => {
    const quotes = resolved.map(({group}) => group.freshQuotes.find(q => q.book === book));
    const times = quotes.map(q => timestamp(q.updatedAt)), decimal = quotes.reduce((product,q) => product*q.price,1);
    return {book,title:getSportsbook(book,quotes[0].title).name,decimal,quotes,oldestAt:new Date(Math.min(...times)).toISOString(),newestAt:new Date(Math.max(...times)).toISOString(),snapshotSpanSeconds:(Math.max(...times)-Math.min(...times))/1000,payout:payout(stake,decimal)};
  }).filter(b => validPrice(b.decimal) && b.snapshotSpanSeconds <= 120).sort((a,b) => b.decimal-a.decimal || a.title.localeCompare(b.title));
  if (!books.length) return fail('No selected sportsbook has fresh, closely timed prices for every exact leg. Individual best prices across apps cannot form one ticket.');
  const result = {ok:true,reason:null,books,best:books[0],ties:books.filter(b => Math.abs(b.decimal-books[0].decimal)<1e-8),legs:resolved,estimated:true,combinedImpliedProbability:1/books[0].decimal,noVigProbability:null,modelProbability:null,modelEdge:null,modelConfidence:null,independenceNote:'The product of individual prices is an estimate, not a confirmed parlay offer. No calibrated joint probability is available; independent outcomes are not established by separate matchups.'};
  result.health = parlayHealth(resolved,result,{now});
  return result;
}

export function parlayHealth(legs,comparison=null,{now=Date.now()}={}) {
  const resolved = Array.isArray(legs) ? legs.map(l => ({event:l.event,group:l.event && l.group ? compareGroups(l.event,l.group.market,{now,bookKeys:l.group.quotes?.map(q=>q.book)||null}).find(g=>g.id===l.group.id) : null})).filter(l => l.event && l.group) : [];
  const phase = resolved.map(({event}) => eventStatus(event,now));
  const fresh = resolved.length ? 100*resolved.filter(({group}) => !!group.best).length/resolved.length : 0;
  const breadth = resolved.length ? mean(resolved.map(({group}) => Math.min(100,(group.freshQuotes?.length || 0)/4*100))) : 0;
  const usableCommon = comparison?.ok ? comparison.books.filter(b => resolved.length>=2 && resolved.every(({group})=>group.freshQuotes.some(q=>q.book===b.book)) && b.snapshotSpanSeconds<=120).length : 0;
  const common = Math.min(100,usableCommon/3*100);
  const repeatedEvents = new Set(resolved.map(l => l.event.id)).size !== resolved.length;
  const teamKeys = resolved.flatMap(({event}) => [event.home_team,event.away_team].filter(Boolean).map(team => `${event.sport_key}|${team}`));
  const overlap = new Set(teamKeys).size !== teamKeys.length;
  const overlapScore = resolved.length >= 2 && !repeatedEvents && !overlap && phase.every(s => s === 'upcoming') ? 100 : 0;
  const factors = [
    {name:'Freshness',value:fresh,weight:35,explanation:'Percentage of ticket legs with a usable fresh quote. Stale prices receive no credit.'},
    {name:'Quote breadth',value:breadth,weight:25,explanation:'Each leg receives 25 points per fresh book, capped at four books; the legs are averaged.'},
    {name:'Common books',value:common,weight:25,explanation:'33.33 points per sportsbook with every exact leg and timestamps within two minutes, capped at three books.'},
    {name:'Overlap checks',value:overlapScore,weight:15,explanation:'Passes only separate upcoming events without repeated teams. Passing this check does not establish statistical independence.'}
  ];
  const score = resolved.length >= 2 ? Math.round(factors.reduce((sum,f) => sum+f.value*f.weight/100,0)) : null;
  return {score,label:score == null ? 'Build a ticket to inspect data checks' : score >= 75 ? 'More complete observed data' : score >= 45 ? 'Partial observed data' : 'Limited observed data',factors,unavailableDimensions:['Recent form','Matchup','Model value','Injury risk','Variance','Joint probability'].map(name => ({name,value:null,reason:'No validated model dimension is configured.'})),method:HEALTH_METHOD,predictionConfidence:null,warning:'This is a research-completeness score, not a chance of winning, safety rating or betting recommendation.'};
}

export function educationalParlay(probabilities,stake=10) {
  if (!Array.isArray(probabilities) || probabilities.length < 1 || probabilities.length > 12 || probabilities.some(p => typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p > 1) || typeof stake !== 'number' || !Number.isFinite(stake) || stake < 0) return {ok:false,reason:'Enter one to twelve hypothetical probabilities above 0% and at most 100%, and a non-negative stake.'};
  const combinedProbability = probabilities.reduce((product,p) => product*p,1),fairDecimal = 1/combinedProbability;
  return {ok:true,combinedProbability,fairDecimal,fairAmerican:decimalToAmerican(fairDecimal),total:stake*fairDecimal,profit:stake*(fairDecimal-1),assumption:'Hypothetical probabilities multiply only under an independence assumption. These inputs are educational, not estimated game probabilities or sportsbook quotes.'};
}

export function recentPerformance(rows,{line,direction='Over',limit=5,now=Date.now(),playerId=null,statType=null}={}) {
  if (typeof line !== 'number' || !Number.isFinite(line) || !['Over','Under'].includes(direction)) return {unavailable:true,reason:'A valid line and Over/Under direction are required.',rows:[],games:0,hits:0,pushes:0,hitRate:null,average:null};
  const seen = new Set();
  const real = (Array.isArray(rows)?rows:[]).filter(r => r && r.completed === true && (playerId == null || sameIdentity(r.playerId,playerId)) && (statType == null || r.statType === statType) && realSource(r) && typeof r.value === 'number' && Number.isFinite(r.value) && Number.isFinite(timestamp(r.date)) && timestamp(r.date) <= now).sort((a,b) => timestamp(b.date)-timestamp(a.date)).filter(r => {const key = r.gameId || r.id || `${r.date}|${r.playerId || r.player || ''}|${r.statType || ''}`;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,limit===10?10:5).map(r => ({...r,result:r.value === line ? 'push' : (direction==='Over'?r.value>line:r.value<line)?'hit':'miss'}));
  const hits = real.filter(r => r.result==='hit').length,pushes = real.filter(r => r.result==='push').length;
  return {unavailable:!real.length,reason:real.length?null:'Verified completed player-stat rows are unavailable. No sample values are substituted.',rows:real,games:real.length,hits,pushes,hitRate:real.length?hits/real.length:null,average:mean(real.map(r => r.value)),line,direction,predictionProbability:null,method:'Observed hits against the current line in sourced completed games. Historical hit rate is not a calibrated future probability.'};
}

export function lineMovement(history,{eventId,groupId,now=Date.now()}={}) {
  const books = new Map();
  if (!eventId || !groupId) return {series:[],labels:[],observedSince:null,method:MOVEMENT_METHOD,reason:'Choose an exact event and selection before inspecting price movement.'};
  let exactPoint;
  try { const parts=JSON.parse(groupId);if(!Array.isArray(parts)||parts.length<6||typeof parts[0]!=='string'||typeof parts[4]!=='string'||!validPoint(parts[5]))throw new Error('Invalid selection');exactPoint=parts[5]; } catch { return {series:[],labels:[],observedSince:null,method:MOVEMENT_METHOD,reason:'Selection identifier is invalid.'}; }
  for (const row of Array.isArray(history)?history:[]) {
    const time = timestamp(row?.timestamp || row?.updatedAt);
    if (!row || row.mode === 'demo' || row.fictional === true || row.synthetic === true || /demo|fictional|synthetic|fixture/i.test(row.source || '') || (eventId && row.eventId !== eventId) || (groupId && row.groupId !== groupId) || (row.point !== undefined && (row.point ?? null)!==exactPoint) || (row.line !== undefined && (row.line ?? null)!==exactPoint) || !validPrice(row.price) || !Number.isFinite(time) || time > now+30000 || typeof (row.book || row.sportsbookId) !== 'string' || !(row.book || row.sportsbookId).trim() || suspended(row)) continue;
    const book = canonicalSportsbookId(row.book || row.sportsbookId);
    if (!books.has(book)) books.set(book,new Map());
    books.get(book).set(time,{timestamp:new Date(time).toISOString(),price:row.price,impliedProbability:1/row.price,point:row.point ?? row.line ?? null});
  }
  const series = [...books].map(([book,points]) => {const sorted=[...points.values()].sort((a,b) => timestamp(a.timestamp)-timestamp(b.timestamp)).slice(-200);return {book,title:getSportsbook(book).name,points:sorted,firstObserved:sorted[0] || null,current:sorted.at(-1) || null};}).sort((a,b) => a.title.localeCompare(b.title));
  const labels = [],movements=[];
  for (const s of series) {
    if (s.points.length<2) continue;
    const delta=s.current.price-s.firstObserved.price,impliedDelta=s.current.impliedProbability-s.firstObserved.impliedProbability;
    if (Math.abs(delta)>1e-8) labels.push({book:s.book,label:delta>0?'PRICE IMPROVING':'PRICE GETTING WORSE',decimalChange:delta,impliedChange:impliedDelta,explanation:'Payout changed for the exact selection. The reason for the change is not available.'});
    if (Math.abs(impliedDelta)>=0.03) labels.push({book:s.book,label:'LINE MOVING',impliedChange:impliedDelta,explanation:'Observed implied-price change is at least three percentage points.'});
    const cutoff=now-300000,window=s.points.filter(p => timestamp(p.timestamp)>=cutoff && timestamp(p.timestamp)<=now);
    if(window.length>=2) {const first=window[0],last=window.at(-1),deltaP=last.impliedProbability-first.impliedProbability;if(Math.abs(deltaP)>=0.03)movements.push({book:s.book,direction:Math.sign(deltaP),firstAt:first.timestamp,lastAt:last.timestamp});}
  }
  for (const direction of [-1,1]) {
    const matching=movements.filter(m => m.direction===direction);
    if(matching.length>=3) labels.push({book:null,label:'STEAM',books:matching.map(m => m.book),explanation:'At least three books moved implied price in the same direction by three percentage points in the last five minutes. This is an observed signal; no cause or prediction is inferred.'});
  }
  return {series,labels,observedSince:series.length?series.reduce((earliest,s) => timestamp(s.firstObserved.timestamp)<timestamp(earliest)?s.firstObserved.timestamp:earliest,series[0].firstObserved.timestamp):null,method:MOVEMENT_METHOD,reason:series.some(s=>s.points.length>=2)?null:'At least two genuine observations are needed. No opening price or earlier history is fabricated.'};
}

/** Statistics must identify the same player and stat; a mixed response cannot support a candidate. */
export function candidateAnalysis(event,group,{bookKeys=null,now=Date.now(),stats=[],playerId=null,statType=null,performance=null}={}) {
  const consensus=marketConsensus(event,group,{bookKeys,now});
  const expectedStat=playerStatForMarket(event.sport_key,group.market);
  const contextMatches=performance && realSource(performance) && performance.league===event.sport_key && identity(performance.player?.name)===identity(group.subject) && performance.player?.id!=null && performance.statType===expectedStat;
  const scopedPlayerId=contextMatches?performance.player.id:playerId,scopedStatType=contextMatches?performance.statType:statType;
  const hasScope=!!group.subject && scopedPlayerId!=null && expectedStat!==null && scopedStatType===expectedStat && (!performance||contextMatches);
  const observed=recentPerformance(hasScope?(contextMatches?performance.rows:stats):[],{line:group.point,direction:group.name,playerId:scopedPlayerId,statType:scopedStatType,now});
  const partial=contextMatches && performance.complete!==true;
  const dataQuality={freshBooks:consensus.count,completeBookSets:consensus.completeBookCount,statsAvailable:!observed.unavailable,statsPartial:partial,modelConfidence:null,label:consensus.count>=3?'Broader price coverage':consensus.count?'Limited price coverage':'No fresh price coverage',explanation:'Describes observed feed coverage only. Player availability, injury reports and prediction calibration are not verified.'};
  return {eventId:event.id,groupId:group.id,selection:groupLabel(group),market:group.market,line:group.point,bestSportsbook:consensus.best?.title || null,bestOdds:consensus.best?.price || null,marketImpliedProbability:consensus.best?1/consensus.best.price:null,noVigProbability:consensus.noVigProbability,modelProbability:null,modelEdge:null,modelConfidence:null,recentPerformance:{...observed,partial},seasonAverage:null,matchup:null,variance:null,dataQuality,rankingBasis:'Ordered by price-comparison coverage, then payout difference; this is a quote-shopping order and not a predictive pick rank.',why:[`${consensus.count} fresh sportsbook quotes for the exact selection.`,...(consensus.payoutDifferencePer100>0?[`Best price returns $${consensus.payoutDifferencePer100.toFixed(2)} more per $100 than the lowest current quote.`]:[]),...(!observed.unavailable?[`${observed.hits}/${observed.games} sourced completed-game values met this current line (${observed.pushes} pushes); this is a descriptive sample.`]:[])],concerns:['No calibrated win model, injury, lineup, opponent-rank or weather feed is configured.',...(observed.unavailable?['Verified recent player performance for this exact player/stat is unavailable.']:[]),...(partial?['The player-stat source is partial; last-N completeness is not established.']:[]),...(consensus.count<2?['Only one or no fresh sportsbook quote is available.']:[])]};
}

/** Shared, deterministic odds math. No model decides which quote is best. */
import {getSportsbook,canonicalSportsbookId} from './sportsbooks.mjs';
export {BOOKS,DEFAULT_BOOKS} from './sportsbooks.mjs';
export const MARKET_NAMES = { h2h: 'Moneyline', h2h_3_way: 'Three-way moneyline', spreads: 'Spread', totals: 'Total', alternate_spreads: 'Alternate spread', alternate_totals: 'Alternate total', team_totals: 'Team total', alternate_team_totals: 'Alternate team total', outrights: 'Futures' };
export const FRESH_SECONDS = 180;
export const LIVE_FRESH_SECONDS = 90;
export function marketName(key) {
  return MARKET_NAMES[key] || String(key || 'Market').replace(/^player_/, '').split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}
export const isMoneylineMarket = market => /^h2h(?:_|$)/.test(market);
export const isSpreadMarket = market => /(?:^|_)spreads(?:_|$)/.test(market);
export const isTotalMarket = market => /(?:^|_)totals(?:_|$)/.test(market);
export function americanToDecimal(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) < 100) return null;
  const decimal = value > 0 ? 1 + value / 100 : 1 + 100 / Math.abs(value);
  return Number.isFinite(decimal) && decimal > 1 ? decimal : null;
}
export function decimalToAmerican(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 1) return null;
  const american = value >= 2 ? Math.round((value - 1) * 100) : Math.round(-100 / (value - 1));
  return Number.isFinite(american) ? american : null;
}
export function formatOdds(value, format = 'american') {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 1) return '—';
  if (format === 'decimal') return value.toFixed(2);
  const a = decimalToAmerican(value); return a === null ? '—' : a > 0 ? `+${a}` : `${a}`;
}
export const money = n => Number.isFinite(n) ? new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(n) : '—';
export function payout(stake, decimal) {
  if (typeof stake !== 'number' || !Number.isFinite(stake) || stake < 0 || !Number.isFinite(decimal) || decimal <= 1) return null;
  const profit = stake * (decimal - 1), total = stake * decimal;
  if (!Number.isFinite(profit) || !Number.isFinite(total)) return null;
  return { profit, total, implied: 100 / decimal };
}
export function timeAgo(iso, now = Date.now()) {
  const stamp = Date.parse(iso); if (!Number.isFinite(stamp)) return 'time unavailable';
  const seconds = Math.max(0, Math.floor((now - stamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
  return `${Math.floor(seconds/3600)}h ago`;
}
export function classifyEvent(event, score, now = Date.now()) {
  if (score?.completed === true) return 'completed';
  const start = Date.parse(event.commence_time);
  if (!Number.isFinite(start)) return 'unknown';
  if (start > now) return 'upcoming';
  const scoreTime = Date.parse(score?.last_update);
  const hasScores = Array.isArray(score?.scores) && score.scores.length >= 2 && score.scores.every(s => s && s.score != null && Number.isFinite(Number(s.score)));
  if (score?.completed === false && hasScores && Number.isFinite(scoreTime) && now - scoreTime <= FRESH_SECONDS*1000 && scoreTime <= now + 30000) return 'live';
  // A scheduled start in the past alone NEVER proves that a game is live.
  return 'unknown';
}
export function eventStatus(event, now = Date.now()) {
  if (event.status === 'completed') return 'completed';
  if (event.status === 'upcoming' && Date.parse(event.commence_time) > now) return 'upcoming';
  if (event.status === 'live' && Number.isFinite(Date.parse(event.statusCheckedAt)) && Date.parse(event.statusCheckedAt) <= now+30000 && now - Date.parse(event.statusCheckedAt) <= FRESH_SECONDS*1000 && Number.isFinite(Date.parse(event.scoreUpdatedAt)) && Date.parse(event.scoreUpdatedAt) <= now+30000 && now-Date.parse(event.scoreUpdatedAt) <= FRESH_SECONDS*1000) return 'live';
  return 'unknown';
}
export function quoteFresh(quote, event, now = Date.now()) {
  if (quote.suspended === true || ['suspended','closed','settled'].includes(quote.status)) return false;
  const stamp = Date.parse(quote.updatedAt), start = Date.parse(event.commence_time);
  const status=eventStatus(event,now),live=status==='live';
  // A post-start price cannot establish live status without verified recent scores.
  // Futures have no scheduled game/score and are validated as their own event kind.
  if (status !== 'upcoming' && status !== 'live' && event.kind !== 'future') return false;
  if (status === 'completed') return false;
  const maxAge=live?LIVE_FRESH_SECONDS:FRESH_SECONDS;
  if (!Number.isFinite(stamp) || stamp > now + 30000 || now - stamp > maxAge*1000) return false;
  if(live && (!Number.isFinite(Date.parse(event.scoreUpdatedAt)) || now-Date.parse(event.scoreUpdatedAt)>LIVE_FRESH_SECONDS*1000))return false;
  // Do not compare an old pre-game quote against an in-play quote.
  if (start <= now && stamp < start) return false;
  return true;
}
export function groupLabel(group) {
  if (isMoneylineMarket(group.market)) return `${group.name} · ${group.scope}`;
  const subject = group.subject || group.description || '';
  const prefix = subject ? `${subject} · ${marketName(group.market)} · ` : '';
  if (isSpreadMarket(group.market)) return `${prefix}${group.name} ${group.point > 0 ? '+' : ''}${group.point}`;
  return `${prefix}${group.name}${group.point == null ? '' : ` ${group.point}`}`;
}
/** Group by exact market, selection, point, description, and 2-/3-way structure. */
export function compareGroups(event, market = 'h2h', options = {}) {
  const now = options.now ?? Date.now(); const selected = options.bookKeys ? new Set(options.bookKeys.map(canonicalSportsbookId)) : null;
  const map = new Map();
  for (const book of event.bookmakers || []) {
    if (!book || typeof book.key !== 'string' || (selected && !selected.has(canonicalSportsbookId(book.key))) || book.suspended === true || ['suspended','closed'].includes(book.status)) continue;
    for (const m of book.markets || []) {
      if (m?.key !== market || !Array.isArray(m.outcomes) || m.suspended===true || ['suspended','closed','settled'].includes(m.status)) continue;
      const universe = isMoneylineMarket(market) || market === 'outrights' ? [...new Set(m.outcomes.filter(o=>o&&typeof o.name==='string').map(o=>o.name))].sort().join('|') : '';
      const scope = isMoneylineMarket(market) ? `${new Set(m.outcomes.filter(o=>o&&typeof o.name==='string').map(o=>o.name)).size}-way moneyline` : marketName(market);
      for (const o of m.outcomes) {
        if (!o || o.suspended===true || ['suspended','closed','settled'].includes(o.status) || typeof o.name !== 'string' || typeof o.price !== 'number' || !Number.isFinite(o.price) || o.price <= 1) continue;
        const point = isMoneylineMarket(market) || market === 'outrights' ? null : o.point ?? null;
        if (point !== null && (typeof point !== 'number' || !Number.isFinite(point))) continue;
        if ((isSpreadMarket(market) || isTotalMarket(market) || (['Over','Under'].includes(o.name) && market.startsWith('player_'))) && point === null) continue;
        const id = JSON.stringify([market, universe, m.description || '', o.description || '', o.name, point]);
        if (!map.has(id)) map.set(id, {id, market, name:o.name, point, scope, subject:o.description || '', description:o.description || '', marketDescription:m.description || '', universe, quotes:[]});
        const quote = {book:canonicalSportsbookId(book.key), title:getSportsbook(book.key,book.title).name, price:o.price, updatedAt:m.last_update || (eventStatus(event,now)==='live'?null:book.last_update) || null, link:o.link || m.link || book.link || null, suspended:false, source:event.source || 'The Odds API'};
        quote.fresh = quoteFresh(quote, event, now);
        // Ignore duplicate quote rows from the same book/selection; prefer the latest timestamp.
        const group = map.get(id); const old = group.quotes.findIndex(q=>q.book===quote.book);
        if (old < 0) group.quotes.push(quote);
        else if (Date.parse(quote.updatedAt) > Date.parse(group.quotes[old].updatedAt)) group.quotes[old] = quote;
      }
    }
  }
  return [...map.values()].map(g=>{
    g.quotes.sort((a,b)=>Number(b.fresh)-Number(a.fresh) || b.price-a.price || a.title.localeCompare(b.title));
    g.freshQuotes = g.quotes.filter(q=>q.fresh);
    g.best = g.freshQuotes[0] || null;
    g.ties = g.best ? g.freshQuotes.filter(q=>Math.abs(q.price-g.best.price)<1e-9) : [];
    g.worst = g.freshQuotes.at(-1) || null;
    g.comparable = g.freshQuotes.length > 1;
    return g;
  }).sort((a,b)=>{
    const names = [event.away_team,event.home_team,'Draw','Over','Under'];
    const order = name => names.indexOf(name)<0 ? 99 : names.indexOf(name);
    return order(a.name)-order(b.name) || b.freshQuotes.length-a.freshQuotes.length || (a.point??0)-(b.point??0) || a.id.localeCompare(b.id);
  });
}
export function primaryGroups(groups) {
  // Prefer lines with the most comparable books; never compare across line values.
  const byName = new Map();
  for (const g of groups) {
    const key = JSON.stringify([g.name,g.subject || '',g.market,g.marketDescription || '',g.universe || '']);
    const old=byName.get(key);
    if (!old || g.freshQuotes.length>old.freshQuotes.length) byName.set(key,g);
  }
  return [...byName.values()];
}
export function explainComparison(event, group, stake = 25, question = '') {
  if (!group?.best) return 'There are no fresh quotes for this exact selection. Refresh the board or choose a different line. Old or missing quotes are not ranked.';
  const best=group.best, result=payout(stake,best.price);
  let text = `For ${groupLabel(group)}, ${group.ties.map(q=>q.title).join(' and ')} ${group.ties.length>1?'tie at':'shows'} ${formatOdds(best.price)} (${best.price.toFixed(2)} decimal). `;
  text += group.comparable ? `That is the highest payout among ${group.freshQuotes.length} fresh feed quotes for this exact selection. ` : 'Only one fresh book is available, so this is not a cross-book comparison. ';
  if (result) text += `A hypothetical ${money(stake)} stake returns ${money(result.total)}, including ${money(result.profit)} profit, only if the bet wins. `;
  if (group.comparable && group.worst.price<best.price && result) text += `That is ${money(stake*(best.price-group.worst.price))} more profit than the lowest quoted price on the same bet. `;
  text += `The quoted price implies ${(100/best.price).toFixed(1)}% before bookmaker margin; this is not a calibrated chance of winning. `;
  if (/win|lock|guarantee|pick|parlay|safe|predict|likely/i.test(question)) text += 'These prices cannot establish a guaranteed winner or a reliable prediction. ';
  if (eventStatus(event)==='unknown') text += 'Live status is unconfirmed for this event. ';
  text += 'Check the current line, market rules, and availability in the sportsbook before acting.';
  return text;
}

/** A verdict is for one exact selection, never an entire game or a forecast. */
export function bestAppVerdict(group) {
 if(!group?.best)return {kind:'unavailable',label:'No fresh comparison',books:[],price:null};
 if(!group.comparable)return {kind:'single',label:'Only app with a fresh quote',books:group.ties,price:group.best.price};
 if(group.ties.length>1)return {kind:'tie',label:'Tied best apps',books:group.ties,price:group.best.price};
 return {kind:'best',label:'Best app for this bet',books:group.ties,price:group.best.price};
}

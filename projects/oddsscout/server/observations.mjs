/** Real observations only. Bounded warm-instance memory; never invent an opening line. */
const samples=new Map();
const RETENTION_MS=48*60*60*1000;
const MAX_SERIES=4000;
const MAX_POINTS=240;

export function observeQuotes(quotes,observedAt=new Date().toISOString()) {
  const now=Date.parse(observedAt);
  if(!Number.isFinite(now))return;
  for (const quote of quotes) {
    const sourceTime=Date.parse(quote.timestamp);
    if (!Number.isFinite(sourceTime)||sourceTime>now+30000||sourceTime<now-RETENTION_MS||!Number.isFinite(quote.price)||quote.price<=1||quote.suspended) continue;
    let series=samples.get(quote.id);
    if (!series) {series={eventId:quote.eventId,groupId:quote.groupId,sportsbookId:quote.sportsbookId,market:quote.market,selection:quote.selection,subject:quote.subject,line:quote.line,points:[],lastObserved:now};samples.set(quote.id,series);}
    series.lastObserved=now;
    const point={timestamp:quote.timestamp,observedAt,price:quote.price};
    const previous=series.points.findIndex(p=>p.timestamp===point.timestamp);
    if (previous>=0) series.points[previous]=point;
    else series.points.push(point);
    series.points=series.points.filter(p=>Date.parse(p.timestamp)>=now-RETENTION_MS).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)).slice(-MAX_POINTS);
  }
  for (const [key,series] of samples) if (series.lastObserved<now-RETENTION_MS) samples.delete(key);
  if (samples.size>MAX_SERIES) {
    const oldest=[...samples].sort((a,b)=>a[1].lastObserved-b[1].lastObserved);
    for (const [key] of oldest.slice(0,samples.size-MAX_SERIES)) samples.delete(key);
  }
}

export function movementsForEvent(eventId) {
  return [...samples.entries()].filter(([,s])=>s.eventId===eventId).map(([id,s])=>{
    const first=s.points[0],latest=s.points.at(-1);
    const difference=first&&latest?latest.price-first.price:0;
    return {id,eventId:s.eventId,groupId:s.groupId,sportsbookId:s.sportsbookId,market:s.market,selection:s.selection,subject:s.subject,line:s.line,points:s.points.map(p=>({...p})),firstObserved:first?.timestamp||null,firstObservedAt:first?.observedAt||null,firstSourceTimestamp:first?.timestamp||null,label:s.points.length<2?'Collecting observations':Math.abs(difference)<1e-9?'No observed price change':difference>0?'Price improving':'Price getting worse',priceChange:difference,source:'Observed The Odds API snapshots',openingPriceVerified:false};
  });
}
export function clearObservationsForTests() {samples.clear();}

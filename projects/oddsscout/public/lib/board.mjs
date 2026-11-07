
export function mergeLeaguePage(previous, incoming) {
 const events=new Map((previous?.events||[]).map(e=>[e.id,e]));
 for(const event of incoming.events||[])events.set(event.id,event);
 const loaded=new Map((previous?.coverageInfo?.loaded||[]).map(s=>[s.key,s]));
 for(const league of incoming.batch?.loaded||[])loaded.set(league.key,league);
 const failures=new Map((previous?.coverageInfo?.failed||[]).map(s=>[s.key,s]));
 for(const failure of incoming.batch?.failed||[])failures.set(failure.key,failure);
 for(const key of loaded.keys())failures.delete(key);
 const times=[previous?.fetchedAt,incoming.fetchedAt].filter(t=>Number.isFinite(Date.parse(t))).sort();
 const remaining=[previous?.usage?.remaining,incoming.usage?.remaining].filter(Number.isFinite);
 return {...incoming,events:[...events.values()],fetchedAt:times[0]||incoming.fetchedAt,
  usage:{remaining:remaining.length?Math.min(...remaining):null},
  warnings:[...new Set([...(previous?.warnings||[]),...(incoming.warnings||[])])],
  coverageInfo:{loaded:[...loaded.values()],failed:[...failures.values()],total:incoming.batch?.totalLeagues||0,
   finished:incoming.batch?.nextPage===null,halted:incoming.batch?.halted||null}};
}
export function matchesDate(event, range='all', now=Date.now()) {
 if(range==='all')return true;
 const time=Date.parse(event.commence_time);if(!Number.isFinite(time))return false;
 const start=new Date(now);start.setHours(0,0,0,0);
 const end=new Date(start);end.setDate(end.getDate()+1);
 if(range==='today')return (time>=+start&&time<+end)||(event.status==='live'&&time<+end);
 if(range==='tomorrow'){const next=new Date(end);next.setDate(next.getDate()+1);return time>=+end&&time<+next;}
 if(range==='week'){const week=new Date(start);week.setDate(week.getDate()+7);return time<+week&&(time>=+start||event.status==='live');}
 return true;
}
export const sportLabel = group => ({'American Football':'Football','Ice Hockey':'Hockey','Mixed Martial Arts':'Combat sports'})[group]||group||'Other sports';
export const sportSymbol = group => ({'American Football':'◒','Basketball':'⊕','Baseball':'◉','Ice Hockey':'▰','Soccer':'◎','Mixed Martial Arts':'◇','Tennis':'◉'})[group]||'◈';

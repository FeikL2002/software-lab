/** Calendar dates follow the viewer's local zone; UTC event instants retain their offset. */
export function calendarDateKey(value=new Date(),timeZone){
 const date=value instanceof Date?value:new Date(value);
 if(!Number.isFinite(date.getTime()))return null;
 if(timeZone){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date),get=type=>parts.find(p=>p.type===type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
 }
 return `${String(date.getFullYear()).padStart(4,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function parseCalendarDate(key){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(key||'');if(!match)return null;
 const year=Number(match[1]),month=Number(match[2])-1,day=Number(match[3]),date=new Date(Date.UTC(year,month,day));
 if(year<100||date.getUTCFullYear()!==year||date.getUTCMonth()!==month||date.getUTCDate()!==day)return null;
 return {year,month,day};
}
export function shiftCalendarDate(key,days){
 const parts=parseCalendarDate(key);if(!parts||!Number.isInteger(days))return null;
 const d=new Date(Date.UTC(parts.year,parts.month,parts.day+days));return d.toISOString().slice(0,10);
}
export function shiftCalendarMonth(year,month,amount){
 if(![year,month,amount].every(Number.isInteger)||month<0||month>11)return null;
 const date=new Date(Date.UTC(year,month+amount,1));return {year:date.getUTCFullYear(),month:date.getUTCMonth()};
}
export function calendarMonthGrid(year,month){
 if(!Number.isInteger(year)||year<100||year>9998||!Number.isInteger(month)||month<0||month>11)return [];
 const start=1-new Date(Date.UTC(year,month,1)).getUTCDay();
 return Array.from({length:42},(_,i)=>{
  const date=new Date(Date.UTC(year,month,start+i));return {key:date.toISOString().slice(0,10),day:date.getUTCDate(),inMonth:date.getUTCMonth()===month};
 });
}
export function mergeCalendarEvents(existing,incoming){
 if(!Array.isArray(existing)||!Array.isArray(incoming))throw new Error('The event schedule is incomplete. No substitute schedule was loaded.');
 const merged=new Map();
 for(const event of [...existing,...incoming]){
  if(!event||typeof event.id!=='string'||!event.id||typeof event.sport_key!=='string'||!event.sport_key||typeof event.home_team!=='string'||!event.home_team.trim()||typeof event.away_team!=='string'||!event.away_team.trim()||typeof event.commence_time!=='string'||!Number.isFinite(Date.parse(event.commence_time)))throw new Error('The event schedule contains an invalid game. No substitute schedule was loaded.');
  merged.set(`${event.sport_key}|${event.id}`,event);
 }
 return [...merged.values()].sort((a,b)=>Date.parse(a.commence_time)-Date.parse(b.commence_time)||a.sport_key.localeCompare(b.sport_key)||a.id.localeCompare(b.id));
}
export function calendarEventsByDate(events,timeZone){
 const groups=new Map();for(const event of events){const key=calendarDateKey(event.commence_time,timeZone);if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(event);}return groups;
}
export function nextCalendarEvent(events,now=Date.now()){
 return [...events].filter(e=>Date.parse(e.commence_time)>=now).sort((a,b)=>Date.parse(a.commence_time)-Date.parse(b.commence_time))[0]||null;
}

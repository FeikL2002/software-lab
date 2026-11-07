import {calendarDateKey,parseCalendarDate,shiftCalendarDate,shiftCalendarMonth,calendarMonthGrid,mergeCalendarEvents,calendarEventsByDate,nextCalendarEvent} from './lib/calendar.mjs';

/** An on-demand view of actual provider fixtures, independent of the odds-board filters. */
export function mountCalendar({state,api,esc,toast,openEvent}){
 const root=document.getElementById('calendar-section');
 if(!root)return {show(){},update(){},load:async()=>{}};
 const today=calendarDateKey(),initial=parseCalendarDate(today);
 let year=initial.year,month=initial.month,selected=today,league=state.league==='upcoming'?'all':state.league||'all',events=[],loaded=false,busy=false,error='',epoch=0,controller=null,nextPage=null,lastAt='',coverage='',source='',warnings=[],limitations=[],allLoaded=new Map(),failed=new Map(),totalLeagues=0,sportsSignature='',opener=null,displayStamp='';
 const el=id=>document.getElementById(id);
 const dayLabel=key=>{const p=parseCalendarDate(key);return p?new Date(p.year,p.month,p.day,12).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}):key;};
 const monthLabel=()=>new Date(year,month,1,12).toLocaleDateString(undefined,{month:'long',year:'numeric'});
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'device local time';
 root.innerHTML=`<div class="calendar-heading"><div><span class="eyebrow">PLAN YOUR RESEARCH</span><h2 tabindex="-1" id="calendar-title">Events Calendar</h2><p>Tap a date to see upcoming games published by the provider.</p></div><button class="text-button" id="calendar-hide">Close calendar ×</button></div><div class="calendar-toolbar"><label for="calendar-league">Calendar league<select id="calendar-league"><option value="all">All active leagues · load in batches</option></select></label><button class="button" id="calendar-refresh">Load upcoming events ↻</button></div><p class="calendar-timezone" id="calendar-timezone">${esc(zone)} · Dates and start times use your device’s time zone.</p><div class="calendar-status" id="calendar-status" role="status" aria-live="polite"></div><div class="calendar-layout"><section class="calendar-month-panel" aria-label="Choose an event date"><div class="calendar-controls"><button class="icon-btn" id="calendar-prev" aria-label="Previous month">‹</button><h3 id="calendar-month"></h3><button class="icon-btn" id="calendar-next" aria-label="Next month">›</button></div><div class="calendar-jumps"><button class="text-button" id="calendar-today">Today</button><button class="text-button" id="calendar-next-event" disabled>Next scheduled event ↗</button></div><div class="calendar-grid"><div class="calendar-weekdays" aria-hidden="true">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<span>${d}</span>`).join('')}</div><div class="calendar-days" id="calendar-days" role="group" aria-label="Calendar dates"></div></div><p class="calendar-legend"><span class="calendar-legend-dot" aria-hidden="true"></span> Events in the returned schedule · a blank date does not establish that no game exists.</p><p id="calendar-outside" class="small-print"></p></section><section class="calendar-agenda" id="calendar-agenda" aria-label="Selected date events" aria-live="polite"></section></div><div class="calendar-coverage" id="calendar-coverage"></div><button class="button full-width hidden" id="calendar-more">Load more league schedules</button><p class="small-print calendar-footnote">Schedules can change and provider coverage can be limited. Check Game Center for available odds when you are ready. A scheduled start alone never confirms a game is live. No bets are placed here.</p>`;
 function update(){
  const sports=(state.sports||[]).filter(s=>s&&typeof s.key==='string'&&!s.has_outrights&&s.active!==false),signature=JSON.stringify(sports.map(s=>[s.key,s.title]));
  if(signature!==sportsSignature){
   sportsSignature=signature;const selectedLeague=league;
   el('calendar-league').innerHTML=`<option value="all">All active leagues · load in batches</option>`+sports.map(s=>`<option value="${esc(s.key)}">${esc(s.title||s.key)}</option>`).join('');
   if(selectedLeague!=='all'&&!sports.some(s=>s.key===selectedLeague)){const opt=document.createElement('option');opt.value=selectedLeague;opt.textContent=selectedLeague.replaceAll('_',' ');el('calendar-league').append(opt);}
   el('calendar-league').value=selectedLeague;
  }
 }
 function render(){
  const upcoming=events.filter(e=>Date.parse(e.commence_time)>Date.now()),byDate=calendarEventsByDate(upcoming),nowToday=calendarDateKey(),cells=calendarMonthGrid(year,month),hasSelected=cells.some(c=>c.key===selected),focusKey=hasSelected?selected:cells.find(c=>c.inMonth)?.key;
  displayStamp=`${upcoming.length}|${nowToday}|${Boolean(lastAt&&Date.now()-Date.parse(lastAt)>300000)}`;
  el('calendar-month').textContent=monthLabel();
  el('calendar-days').innerHTML=cells.map(cell=>{const count=byDate.get(cell.key)?.length||0,classes=['calendar-day',!cell.inMonth?'outside':'',cell.key===selected?'is-selected':'',cell.key===nowToday?'is-today':''].filter(Boolean).join(' ');return `<button class="${classes}" data-calendar-date="${cell.key}" tabindex="${cell.key===focusKey?'0':'-1'}" aria-pressed="${cell.key===selected}" ${cell.key===nowToday?'aria-current="date"':''} aria-label="${esc(dayLabel(cell.key))}, ${count} returned ${count===1?'event':'events'}"><span>${cell.day}</span>${count?`<small class="calendar-count" aria-hidden="true">${count}</small>`:'<small aria-hidden="true">&nbsp;</small>'}</button>`;}).join('');
  const rows=byDate.get(selected)||[],dateTitle=`<div class="calendar-agenda-heading"><span class="eyebrow">${rows.length} RETURNED ${rows.length===1?'EVENT':'EVENTS'}</span><h3>${esc(dayLabel(selected))}</h3></div>`;
  if(busy&&!loaded)el('calendar-agenda').innerHTML=dateTitle+'<div class="calendar-empty"><span class="loading-dot" aria-hidden="true"></span><h4>Checking the provider schedule…</h4><p>Games will appear only after a successful response.</p></div>';
  else if(error&&!loaded)el('calendar-agenda').innerHTML=dateTitle+`<div class="calendar-empty calendar-error"><h4>Schedule unavailable</h4><p>${esc(error)}</p><p>No sample or substitute games were loaded. Retry to check the provider.</p></div>`;
  else if(!loaded)el('calendar-agenda').innerHTML=dateTitle+'<div class="calendar-empty"><h4>Your planning starts here.</h4><p>Load upcoming events to check the provider’s available schedule.</p></div>';
  else if(!rows.length)el('calendar-agenda').innerHTML=dateTitle+`<div class="calendar-empty"><h4>No returned events for this date</h4><p>${nextPage!==null?'More league schedules remain to be checked. Load the next batch or choose a specific league.':'The provider returned no upcoming games for this date in the checked leagues. This is not a full-season schedule.'}</p>${failed.size?'<p>Some league schedules failed to load. See coverage below.</p>':''}</div>`;
  else el('calendar-agenda').innerHTML=dateTitle+rows.map(event=>{const start=new Date(event.commence_time),time=start.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',timeZoneName:'short'}),past=start.getTime()<=Date.now();return `<article class="calendar-event"><div class="calendar-event-meta"><time datetime="${esc(event.commence_time)}">${esc(time)}</time><span>${esc(event.sport_title||event.sport_key)}</span></div><h4>${esc(event.away_team)} <span>at</span> ${esc(event.home_team)}</h4><p>${past?'Scheduled time has passed. Open Game Center to check the current status.':'Scheduled start · subject to change'}</p><button class="button" data-calendar-event="${esc(event.sport_key+'|'+event.id)}">Game Center & odds ↗</button></article>`;}).join('');
  const warning=error?`Calendar request failed. ${error}${loaded?' The previous successful schedule snapshot remains below.':''}`:busy?nextPage!==null&&loaded?'Checking the next league batch…':'Checking real upcoming events…':loaded?`${upcoming.length} upcoming ${upcoming.length===1?'event':'events'} returned${lastAt?(league==='all'?' · oldest loaded snapshot ':' · snapshot ')+new Date(lastAt).toLocaleString():''}.`:'Upcoming schedule has not been loaded.';
  el('calendar-status').textContent=warning;el('calendar-status').classList.toggle('calendar-error',Boolean(error));root.setAttribute('aria-busy',String(busy));
  el('calendar-refresh').disabled=busy;el('calendar-refresh').textContent=loaded?'Refresh schedule ↻':busy?'Checking schedule…':'Load upcoming events ↻';
  el('calendar-next-event').disabled=!nextCalendarEvent(upcoming);
  el('calendar-more').classList.toggle('hidden',nextPage===null);el('calendar-more').disabled=busy;el('calendar-more').textContent=busy?'Checking more leagues…':'Load more league schedules';
  const outside=upcoming.filter(e=>{const key=calendarDateKey(e.commence_time);return key.slice(0,7)!==`${year}-${String(month+1).padStart(2,'0')}`;}).length;
  el('calendar-outside').textContent=loaded&&outside?`${outside} returned ${outside===1?'event is':'events are'} outside this month. Use Next scheduled event or change month.`:'';
  el('calendar-coverage').innerHTML=loaded?`<strong>${esc(source||'Provider')} schedule coverage</strong><p>${esc(coverage||'Only events published by the provider are included.')}</p>${league==='all'?`<p>${allLoaded.size} of ${totalLeagues} active league schedules loaded${failed.size?` · ${failed.size} failed`:''}${nextPage!==null?' · more batches available':''}.</p>`:''}${failed.size?`<details class="calendar-failures"><summary>League schedules that could not load (${failed.size})</summary><ul>${[...failed.values()].map(row=>`<li><strong>${esc(row.title||row.key)}</strong>: ${esc(row.error||'Schedule unavailable')}</li>`).join('')}</ul></details>`:''}${events.length>upcoming.length?`<p class="small-print">${events.length-upcoming.length} scheduled ${events.length-upcoming.length===1?'start has':'starts have'} passed and are hidden. Refresh to check the current schedule.</p>`:''}${lastAt&&Date.now()-Date.parse(lastAt)>300000?'<p class="small-print">This snapshot is older than 5 minutes. Refresh to check schedule changes.</p>':''}${[...new Set([...warnings,...limitations])].map(text=>`<p class="small-print">${esc(text)}</p>`).join('')}`:'<p>Live schedules are requested separately from odds. Changing the displayed date or month does not request odds or place a bet.</p>';
 }
 async function load({more=false}={}){
  if(busy&&more)return;
  const requestPage=more?nextPage:0;if(more&&requestPage===null)return;
  if(controller)controller.abort();controller=new AbortController();const seq=++epoch;
  if(!more){events=[];loaded=false;nextPage=null;lastAt='';coverage='';source='';warnings=[];limitations=[];allLoaded=new Map();failed=new Map();totalLeagues=0;}
  busy=true;error='';render();
  try{
   const params=new URLSearchParams({league});if(league==='all')params.set('page',String(requestPage));
   const data=await api('/api/calendar?'+params,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});if(seq!==epoch)return;
   if(data?.mode!=='live'||!Array.isArray(data.events)||typeof data.source!=='string'||!data.source.trim()||typeof data.fetchedAt!=='string'||!Number.isFinite(Date.parse(data.fetchedAt)))throw new Error('The schedule response could not be verified.');
   if(league==='all'){const b=data.batch;if(!b||b.page!==requestPage||!Number.isInteger(b.totalLeagues)||b.totalLeagues<0||!Array.isArray(b.loaded)||!Array.isArray(b.failed)||(b.nextPage!==null&&(!Number.isInteger(b.nextPage)||b.nextPage<=requestPage)))throw new Error('The league schedule coverage could not be verified.');}
   const merged=mergeCalendarEvents(more?events:[],data.events);events=merged;loaded=true;source=data.source;lastAt=!more||!lastAt||Date.parse(data.fetchedAt)<Date.parse(lastAt)?data.fetchedAt:lastAt;coverage=typeof data.coverage==='string'?data.coverage:'';warnings=[...warnings,...(Array.isArray(data.warnings)?data.warnings.filter(v=>typeof v==='string'):[])];limitations=[...limitations,...(Array.isArray(data.limitations)?data.limitations.filter(v=>typeof v==='string'):[])];
   const batch=data.batch;nextPage=league==='all'&&Number.isInteger(batch?.nextPage)&&batch.nextPage>requestPage?batch.nextPage:null;
   if(batch){totalLeagues=Number(batch.totalLeagues)||0;for(const row of batch.loaded||[])if(row?.key){allLoaded.set(row.key,row);failed.delete(row.key);}for(const row of batch.failed||[])if(row?.key)failed.set(row.key,row);}
  }catch(e){if(seq!==epoch)return;error=e.name==='AbortError'?'The schedule request was interrupted. Retry when connected.':e.message||'The provider schedule could not load.';}
  finally{if(seq===epoch){busy=false;render();}}
 }
 function selectDate(key,focus=false){const date=parseCalendarDate(key);if(!date)return;selected=key;year=date.year;month=date.month;render();if(focus)root.querySelector(`[data-calendar-date="${key}"]`)?.focus();}
 root.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.calendarDate){selectDate(button.dataset.calendarDate,true);return;}
  if(button.dataset.calendarEvent){const match=events.find(e=>`${e.sport_key}|${e.id}`===button.dataset.calendarEvent);if(match){try{Promise.resolve(openEvent(match)).catch(e=>toast(e.message||'Game Center could not open.'));}catch(e){toast(e.message||'Game Center could not open.');}}return;}
  if(button.id==='calendar-prev'||button.id==='calendar-next'){const shifted=shiftCalendarMonth(year,month,button.id==='calendar-prev'?-1:1);if(shifted&&shifted.year>=100&&shifted.year<=9998){year=shifted.year;month=shifted.month;render();}return;}
  if(button.id==='calendar-today'){selectDate(calendarDateKey(),true);return;}
  if(button.id==='calendar-next-event'){const next=nextCalendarEvent(events);if(next)selectDate(calendarDateKey(next.commence_time),true);return;}
  if(button.id==='calendar-refresh')void load();
  if(button.id==='calendar-more')void load({more:true});
  if(button.id==='calendar-hide'){root.classList.add('hidden');const target=opener?.isConnected&&opener.getClientRects().length?opener:[...document.querySelectorAll('[data-calendar-open]')].find(b=>b.getClientRects().length);target?.focus();}
 });
 root.addEventListener('keydown',event=>{
  const button=event.target.closest('[data-calendar-date]');if(!button)return;
  const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];if(offset!==undefined){event.preventDefault();selectDate(shiftCalendarDate(button.dataset.calendarDate,offset),true);}
 });
 el('calendar-league').addEventListener('change',()=>{league=el('calendar-league').value;void load();});
 function show(){opener=document.activeElement;root.classList.remove('hidden');update();render();root.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});el('calendar-title').focus({preventScroll:true});if(!loaded&&!busy)void load();}
 setInterval(()=>{const stamp=`${events.filter(e=>Date.parse(e.commence_time)>Date.now()).length}|${calendarDateKey()}|${Boolean(lastAt&&Date.now()-Date.parse(lastAt)>300000)}`;if(stamp!==displayStamp&&!root.classList.contains('hidden')&&!document.hidden&&loaded&&!busy){const focused=document.activeElement?.dataset?.calendarDate;render();if(focused)root.querySelector(`[data-calendar-date="${focused}"]`)?.focus({preventScroll:true});}},60000);
 update();render();return {show,update,load};
}

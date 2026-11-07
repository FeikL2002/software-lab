import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDateKey,parseCalendarDate,shiftCalendarDate,shiftCalendarMonth,calendarMonthGrid,mergeCalendarEvents,calendarEventsByDate,nextCalendarEvent} from '../public/lib/calendar.mjs';
const event=(id,time,league='americanfootball_nfl')=>({id,sport_key:league,sport_title:'NFL',home_team:'Test home',away_team:'Test away',commence_time:time});
test('calendar groups UTC instants on the viewer local date around midnight',()=>{
 assert.equal(calendarDateKey('2026-11-01T03:30:00Z','America/New_York'),'2026-10-31');
 assert.equal(calendarDateKey('2026-11-01T04:30:00Z','America/New_York'),'2026-11-01');
 assert.equal(calendarDateKey('2026-11-01T03:30:00Z','Asia/Tokyo'),'2026-11-01');
});
test('repeated clock hour during DST belongs to one calendar day',()=>{
 const groups=calendarEventsByDate([event('a','2026-11-01T05:30:00Z'),event('b','2026-11-01T06:30:00Z'),event('c','2026-11-02T04:30:00Z'),event('d','2026-11-02T05:30:00Z')],'America/New_York');
 assert.equal(groups.get('2026-11-01').length,3);assert.equal(groups.get('2026-11-02').length,1);
});
test('spring forward preserves all distinct instants on their correct local day',()=>{
 const groups=calendarEventsByDate([event('a','2026-03-08T06:30:00Z'),event('b','2026-03-08T07:30:00Z')],'America/New_York');assert.equal(groups.get('2026-03-08').length,2);
});
test('calendar grid has six Sunday-first weeks and handles leap days',()=>{
 const grid=calendarMonthGrid(2028,1);assert.equal(grid.length,42);assert.equal(grid[0].key,'2028-01-30');assert.ok(grid.find(d=>d.key==='2028-02-29'&&d.inMonth));assert.equal(grid.filter(d=>d.inMonth).length,29);assert.equal(grid[41].key,'2028-03-11');
});
test('calendar month/year navigation avoids overflow from long months',()=>{
 assert.deepEqual(shiftCalendarMonth(2026,11,1),{year:2027,month:0});assert.deepEqual(shiftCalendarMonth(2027,0,-1),{year:2026,month:11});assert.equal(shiftCalendarMonth(2026,12,1),null);
});
test('date validation rejects overflow and invalid day keys',()=>{
 for(const key of ['2026-02-29','2026-13-01','2026-11-31','2026-1-01','x'])assert.equal(parseCalendarDate(key),null);
 assert.deepEqual(parseCalendarDate('2028-02-29'),{year:2028,month:1,day:29});assert.equal(calendarDateKey('not-a-date'),null);
});
test('keyboard date steps cross month boundaries and DST by civil days',()=>{
 assert.equal(shiftCalendarDate('2026-03-07',1),'2026-03-08');assert.equal(shiftCalendarDate('2026-03-08',1),'2026-03-09');assert.equal(shiftCalendarDate('2026-12-31',1),'2027-01-01');assert.equal(shiftCalendarDate('2026-01-01',-1),'2025-12-31');assert.equal(shiftCalendarDate('bad',1),null);
});
test('event pages merge by league and ID, sort by actual time, and replace duplicates',()=>{
 const a=event('a','2026-11-02T10:00:00Z'),b=event('b','2026-11-01T10:00:00Z'),updated={...a,home_team:'Updated team'},other=event('a','2026-11-03T10:00:00Z','icehockey_nhl');
 const rows=mergeCalendarEvents([a],[b,updated,other]);assert.equal(rows.length,3);assert.equal(rows[0].id,'b');assert.equal(rows[1].home_team,'Updated team');assert.equal(rows[2].sport_key,'icehockey_nhl');assert.equal(a.home_team,'Test home');
});
test('malformed provider events fail closed rather than becoming an empty schedule',()=>{
 for(const bad of [null,{},event('','2026-11-01T00:00:00Z'),event('a','n/a'),{...event('a','2026-11-01T00:00:00Z'),home_team:''}])assert.throws(()=>mergeCalendarEvents([],[bad]),/invalid game/);
 assert.throws(()=>mergeCalendarEvents([],null),/incomplete/);assert.deepEqual(mergeCalendarEvents([],[]),[]);
});
test('next event ignores passed starts without claiming live status',()=>{
 const rows=[event('past','2026-10-31T10:00:00Z'),event('late','2026-11-03T10:00:00Z'),event('next','2026-11-01T10:00:00Z')];assert.equal(nextCalendarEvent(rows,Date.parse('2026-10-31T16:00:00Z')).id,'next');assert.equal(nextCalendarEvent(rows,Date.parse('2026-11-04T00:00:00Z')),null);
});

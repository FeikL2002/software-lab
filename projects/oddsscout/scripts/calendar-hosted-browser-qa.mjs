/** Read-only browser acceptance against an actual hosted calendar. No intercepted requests or fixtures. */
import assert from 'node:assert/strict';
import {access,mkdir,readdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const project=fileURLToPath(new URL('../',import.meta.url));
const outputs=fileURLToPath(new URL('../../../outputs/',import.meta.url));
const base=new URL(process.env.ODDSSCOUT_QA_URL||'https://example.invalid');
assert.equal(base.protocol,'https:','Hosted acceptance requires HTTPS.');
const target=new URL(base);target.searchParams.set('league','americanfootball_nfl');target.searchParams.set('view','calendar');
const evidence=resolve(project,'test-evidence/v7-hosted-calendar-ui.json');
await mkdir(outputs,{recursive:true});
const checks=[],runtimeErrors=[],consoleErrors=[],apiResponses=[];
let calendarData=null,selectedEvent=null,gameResult=null,csp='';
async function launch(){
 try{return await chromium.launch();}catch(error){
  const cache=resolve(homedir(),'Library/Caches/ms-playwright');let directories;try{directories=await readdir(cache);}catch{throw error;}
  for(const directory of directories.filter(d=>d.startsWith('chromium_headless_shell-')).sort().reverse()){
   const executablePath=resolve(cache,directory,'chrome-headless-shell-mac-arm64/chrome-headless-shell');
   try{await access(executablePath);return await chromium.launch({executablePath});}catch{/* Try another installed compatible browser. */}
  }
  throw error;
 }
}
async function check(name,run){
 try{await run();checks.push({name,status:'passed'});console.log('PASS '+name);}
 catch(error){checks.push({name,status:'failed',error:error.message});console.error('FAIL '+name+': '+error.message);}
}
async function noOverflow(page,width){
 const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,calendar:document.getElementById('calendar-section').getBoundingClientRect().toJSON()}));
 assert.ok(sizes.document<=width+1,JSON.stringify(sizes));assert.ok(sizes.body<=width+1,JSON.stringify(sizes));assert.ok(sizes.calendar.left>=-1&&sizes.calendar.right<=width+1,JSON.stringify(sizes));return sizes;
}
async function scrollNear(page,selector,offset=90){
 await page.locator(selector).evaluate((element,top)=>window.scrollTo({top:Math.max(0,scrollY+element.getBoundingClientRect().top-top),behavior:'instant'}),offset);
}
const browser=await launch();
const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/New_York',locale:'en-US',reducedMotion:'reduce'});
const page=await context.newPage();page.setDefaultTimeout(30000);
page.on('pageerror',error=>runtimeErrors.push(error.message));
page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
page.on('response',response=>{const url=new URL(response.url());if(url.origin===base.origin&&url.pathname.startsWith('/api/'))apiResponses.push({path:url.pathname+url.search,status:response.status()});});
try{
 await check('Direct phone-test link opens the real NFL Events Calendar and provider schedule',async()=>{
  const calendarResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/calendar', {timeout:45000});
  const documentResponse=await page.goto(target.href,{waitUntil:'domcontentloaded'});assert.equal(documentResponse.status(),200);csp=documentResponse.headers()['content-security-policy']||'';assert.match(csp,/script-src/);
  await page.locator('#scout-dialog').waitFor({state:'attached'});
  if(await page.locator('#age-dialog').evaluate(dialog=>dialog.open))await page.locator('#confirm-age').click();
  await page.locator('#calendar-section').waitFor({state:'visible'});
  const response=await calendarResponse;assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/application\/json/);calendarData=await response.json();
  assert.equal(calendarData.mode,'live');assert.equal(calendarData.league,'americanfootball_nfl');assert.equal(calendarData.source,'The Odds API');assert.ok(Number.isFinite(Date.parse(calendarData.fetchedAt)));assert.ok(Array.isArray(calendarData.events)&&calendarData.events.length>0,'Actual provider schedule must return at least one upcoming NFL event.');
  await page.waitForFunction(()=>document.getElementById('calendar-section').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#calendar-league').inputValue(),'americanfootball_nfl');assert.match(await page.locator('#calendar-timezone').innerText(),/America\/New_York/);assert.match(await page.locator('#calendar-status').innerText(),/upcoming.*returned/);
 });
 await check('Next scheduled event selects its real local date and exposes actual teams and kickoff time',async()=>{
  assert.ok(calendarData);await page.locator('#calendar-next-event').click();
  const first=page.locator('#calendar-agenda [data-calendar-event]').first();await first.waitFor();const key=await first.getAttribute('data-calendar-event');
  selectedEvent=calendarData.events.find(event=>`${event.sport_key}|${event.id}`===key);assert.ok(selectedEvent,'Selected agenda item must exist in the actual provider payload.');assert.ok(Date.parse(selectedEvent.commence_time)>Date.now());
  const text=await page.locator('#calendar-agenda').innerText();assert.ok(text.includes(selectedEvent.away_team));assert.ok(text.includes(selectedEvent.home_team));
  const selectedDate=await page.locator('[data-calendar-date][aria-pressed="true"]').getAttribute('data-calendar-date');
  const kickoff=new Date(selectedEvent.commence_time);const expected=`${kickoff.toLocaleDateString('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'})}`;assert.equal(selectedDate,expected);
  assert.equal(await page.locator('#calendar-agenda time').first().getAttribute('datetime'),selectedEvent.commence_time);
 });
 await check('Actual calendar Game Center requests the correct event and returns provider odds or an explicit missing-market state',async()=>{
  assert.ok(selectedEvent);const eventResponse=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/event'&&url.searchParams.get('eventId')===selectedEvent.id;},{timeout:45000});
  await page.locator('#calendar-agenda [data-calendar-event]').first().click();await page.locator('#center-dialog[open]').waitFor();
  const response=await eventResponse;const requestUrl=new URL(response.url());assert.equal(requestUrl.searchParams.get('league'),selectedEvent.sport_key);assert.equal(response.status(),200);const data=await response.json();assert.equal(data.mode,'live');assert.equal(data.event.id,selectedEvent.id);assert.equal(data.event.sport_key,selectedEvent.sport_key);
  await page.waitForFunction(()=>!document.getElementById('center-content').textContent.includes('Loading the current game'));
  const text=await page.locator('#center-content').innerText();assert.ok(text.includes(selectedEvent.away_team));assert.ok(text.includes(selectedEvent.home_team));assert.ok(!text.includes('Game data unavailable'));
  const quoteCards=await page.locator('#center-content .swipe-book').count();if(!quoteCards)assert.match(text,/No prices available|No fresh quotes|unavailable/i);
  gameResult={id:selectedEvent.id,league:selectedEvent.sport_key,bookmakers:data.event.bookmakers?.length||0,displayedQuoteCards:quoteCards,fetchedAt:data.fetchedAt,status:data.event.status};
  await page.locator('#center-dialog [data-close="center-dialog"]').click();assert.equal(await page.locator('#calendar-section').isVisible(),true);
 });
 for(const width of [320,390,1440])await check(`Actual calendar and agenda fit the ${width}px viewport`,async()=>{
  await page.setViewportSize({width,height:width===390?844:1000});await noOverflow(page,width);
  assert.ok(await page.locator('#calendar-agenda [data-calendar-event]').count()>0);const selected=page.locator('[data-calendar-date][aria-pressed="true"]');await selected.focus();await page.keyboard.press('Enter');await noOverflow(page,width);
 });
 await check('Read-only hosted calendar screenshots are captured for phone and desktop review',async()=>{
  await page.setViewportSize({width:390,height:844});await scrollNear(page,'.calendar-month-panel',80);await page.screenshot({path:resolve(outputs,'OddsScout-v7-Calendar-Mobile.png'),fullPage:false});
  await scrollNear(page,'#calendar-agenda',80);await page.screenshot({path:resolve(outputs,'OddsScout-v7-Calendar-Agenda-Mobile.png'),fullPage:false});
  await page.setViewportSize({width:1440,height:1000});await scrollNear(page,'#calendar-section',86);await page.screenshot({path:resolve(outputs,'OddsScout-v7-Calendar-Desktop.png'),fullPage:false});
 });
 await check('Hosted tested flows produce no JavaScript runtime or console errors',async()=>{assert.deepEqual(runtimeErrors,[]);assert.deepEqual(consoleErrors,[]);});
}finally{
 await context.close();await browser.close();
 const report={testedAt:new Date().toISOString(),url:target.href,browser:'Chromium via Playwright',timezone:'America/New_York',checks,passed:checks.filter(result=>result.status==='passed').length,failed:checks.filter(result=>result.status==='failed').length,runtimeErrors,consoleErrors,apiResponses,calendar:calendarData?{source:calendarData.source,league:calendarData.league,eventCount:calendarData.events?.length,fetchedAt:calendarData.fetchedAt,coverage:calendarData.coverage}:null,selectedEvent:selectedEvent?{id:selectedEvent.id,league:selectedEvent.sport_key,away:selectedEvent.away_team,home:selectedEvent.home_team,commenceTime:selectedEvent.commence_time}:null,gameResult,csp,limitations:['Actual deployed provider data only; no request interception or fixture transport was installed.','Read-only navigation only. No account creation, authentication, betting, community posting, likes, or cloud account mutation was attempted.','Screenshots reflect the returned schedule and odds at the recorded test time. Prices and coverage may change.']};
 await writeFile(evidence,JSON.stringify(report,null,2));console.log(`Hosted calendar browser QA: ${report.passed} passed, ${report.failed} failed.`);if(report.failed)process.exitCode=1;
}

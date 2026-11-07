/** Calendar browser checks. Every fixture is isolated to this script's Playwright transport. */
import assert from 'node:assert/strict';
import {access,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const project=fileURLToPath(new URL('../',import.meta.url));
const base=process.env.ODDSSCOUT_QA_URL||'http://localhost:8888';
const evidence=resolve(project,'test-evidence/v7/browser');
const clockTime=new Date('2026-10-31T16:00:00.000Z');
const fetchedAt=clockTime.toISOString();
const policy=(await readFile(resolve(project,'netlify.toml'),'utf8')).match(/Content-Security-Policy\s*=\s*"([^"]+)"/)?.[1];
assert.ok(policy,'The actual deployment CSP is required for this check.');
await mkdir(evidence,{recursive:true});
const checks=[],pageErrors=[],cspViolations=[],calendarRequests=[],eventRequests=[],formRequests=[];
const catalog=[{key:'americanfootball_nfl',title:'NFL',group:'American Football'},{key:'basketball_nba',title:'NBA',group:'Basketball'},{key:'icehockey_nhl',title:'NHL',group:'Ice Hockey'}];
function fixture(id,time,league='americanfootball_nfl'){
 return {id:`qa-calendar-${id}`,sport_key:league,sport_title:catalog.find(s=>s.key===league).title,home_team:`QA Calendar ${id} Home`,away_team:`QA Calendar ${id} Away`,commence_time:time,status:'upcoming',statusCheckedAt:fetchedAt,bookmakers:[]};
}
const events=[fixture('oct31','2026-11-01T03:30:00.000Z'),fixture('nov1-0030','2026-11-01T04:30:00.000Z'),fixture('nov1-edt','2026-11-01T05:30:00.000Z'),fixture('nov1-est','2026-11-01T06:30:00.000Z'),fixture('nov1-2330','2026-11-02T04:30:00.000Z'),fixture('nov2','2026-11-02T05:30:00.000Z')];
const hockey=fixture('nhl','2026-11-01T15:30:00.000Z','icehockey_nhl');
let outage=false,boardOutage=false,eventOutage=false,eventQuotes=false,calendarFault='';
async function launch(){
 try{return await chromium.launch();}catch(error){
  const cache=resolve(homedir(),'Library/Caches/ms-playwright');
  let directories;try{directories=await readdir(cache);}catch{throw error;}
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
 assert.ok(sizes.document<=width+1,JSON.stringify(sizes));
 assert.ok(sizes.body<=width+1,JSON.stringify(sizes));
 assert.ok(sizes.calendar.left>=-1&&sizes.calendar.right<=width+1,JSON.stringify(sizes));
}
async function closeDialogs(page){await page.locator('dialog').evaluateAll(ds=>ds.forEach(d=>{if(d.open)d.close();}));}
function payload(league,rows,batch){
 return {mode:'live',source:'The Odds API — isolated QA response',league,events:rows,fetchedAt,refreshSeconds:300,coverage:'Test-only provider-published upcoming fixture transport. It is not a complete season schedule.',warnings:[],limitations:['Dates without returned fixtures do not prove that no game exists.'],usage:{remaining:null,cost:null},...(batch?{batch}:{})};
}
async function calendarReady(page){
 await page.waitForFunction(()=>{const section=document.getElementById('calendar-section');return section&&!section.hidden&&!section.querySelector('[aria-busy="true"]')&&!/Loading|Checking|Connecting/i.test(document.getElementById('calendar-status')?.textContent||'');});
}
async function openCalendar(page){
 const trigger=page.locator('[data-calendar-open]:visible').first();
 await trigger.click();await page.locator('#calendar-section').waitFor({state:'visible'});await calendarReady(page);
}
async function date(page,key){await page.locator(`[data-calendar-date="${key}"]`).click();}
const browser=await launch();
const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/New_York',locale:'en-US'});
await context.route('**/*',async route=>{
 if(new URL(route.request().url()).pathname.startsWith('/api/'))return route.fallback();
 const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'Content-Security-Policy':policy}});
});
await context.route('**/api/**',async route=>{
 const url=new URL(route.request().url()),name=url.pathname.split('/').at(-1);let status=200,body;
 if(name==='config')body={apiVersion:3,mode:'configured',oddsConfigured:true,providerVerified:false,aiEnabled:false,roomLocked:false,allLeaguesAvailable:true,accountsConfigured:false,formConfigured:false,performanceConfigured:false,communityConfigured:false,configuredBooks:[]};
 else if(name==='sports')body={mode:'live',sports:catalog,futures:[],fetchedAt};
 else if(name==='board')body=boardOutage?(status=502,{error:'Explicit QA-only odds-board outage',code:'PROVIDER_UNAVAILABLE'}):{mode:'live',source:'Isolated calendar QA transport',events:[],fetchedAt,configuredBooks:[],market:'h2h',league:url.searchParams.get('league')||'all',warnings:[],coverage:'Calendar test transport',batch:{page:0,totalPages:1,nextPage:null,totalLeagues:3,loaded:catalog.map(s=>({...s,events:0})),failed:[],halted:null}};
 else if(name==='account')body={configured:false,storageConfigured:false,user:null};
 else if(name==='calendar'){
  calendarRequests.push(url.pathname+url.search);
  const league=url.searchParams.get('league')||'all',page=Number(url.searchParams.get('page')||0);
  if(outage){status=502;body={error:'Explicit QA-only schedule provider outage. No replacement fixtures.',code:'PROVIDER_UNAVAILABLE'};}
  else if(league==='basketball_nba')body=payload(league,[]);
  else if(league==='all')body=page===0?payload(league,events,{page:0,totalPages:2,nextPage:1,totalLeagues:3,loaded:[{key:'americanfootball_nfl',title:'NFL',events:events.length}],failed:[{key:'basketball_nba',title:'NBA',error:'QA-only league response unavailable',code:'PROVIDER_UNAVAILABLE'}],halted:null}):payload(league,[hockey],{page:1,totalPages:2,nextPage:null,totalLeagues:3,loaded:[{key:'icehockey_nhl',title:'NHL',events:1}],failed:[],halted:null});
  else body=payload(league,league==='icehockey_nhl'?[hockey]:events);
 }
 else if(name==='event'){
  eventRequests.push(url.pathname+url.search);
  const original=[...events,hockey].find(e=>e.id===url.searchParams.get('eventId'));
  const event=structuredClone(original);
  if(eventQuotes)event.bookmakers=[['draftkings','DraftKings',2.1],['fanduel','FanDuel',2.2]].map(([key,title,price])=>({key,title,last_update:fetchedAt,markets:[{key:'h2h',last_update:fetchedAt,outcomes:[{name:event.home_team,price},{name:event.away_team,price:1.8}]}]}));
  body=eventOutage?(status=502,{error:'Explicit QA-only Game Center outage',code:'PROVIDER_UNAVAILABLE'}):{mode:'live',source:'Isolated calendar QA transport',event,fetchedAt,availableMarkets:['h2h','spreads','totals'],movementSamples:[],limitations:['Explicit test-only fresh prices when the quote regression is active.']};
 }
 else if(name==='form'){formRequests.push(url.pathname+url.search);body={mode:'live',source:'QA empty final-results transport',fetchedAt,games:[],complete:true,limitations:['No completed games are invented for this isolated test.']};}
 else{status=503;body={error:'This service is deliberately unconfigured in the calendar browser test.',code:'NOT_CONFIGURED'};}
 if(name==='calendar'&&status===200&&calendarFault==='timestamp')body.fetchedAt='not-a-real-source-time';
 if(name==='calendar'&&status===200&&calendarFault==='batch')delete body.batch;
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
});
const page=await context.newPage();
page.setDefaultTimeout(10000);
page.on('pageerror',error=>pageErrors.push(error.message));
page.on('console',message=>{if(/Content Security Policy|violates.*directive|Refused to.*(style|script)/i.test(message.text()))cspViolations.push(message.text());});
await page.clock.install({time:clockTime});
try{
 await check('Calendar stays on demand and opens from the actual app navigation',async()=>{
  await page.goto(base+'/?league=americanfootball_nfl');
  await page.locator('#scout-dialog').waitFor({state:'attached'});
  if(await page.locator('#age-dialog').evaluate(d=>d.open))await page.locator('#confirm-age').click();
  await page.waitForFunction(()=>document.getElementById('feed-pill').textContent.includes('Provider data'));
  assert.equal(calendarRequests.length,0,'Board bootstrap must not silently scan calendar leagues.');
  await openCalendar(page);
  assert.equal(calendarRequests.length,1);
  assert.match(calendarRequests[0],/league=americanfootball_nfl/);
  assert.match(await page.locator('#calendar-month').innerText(),/October 2026/);
  assert.match(await page.locator('#calendar-section').innerText(),/America\/New_York|New York|Eastern|EDT|EST/);
 });
 await check('Calendar groups UTC fixtures by device date across midnight and autumn DST',async()=>{
  await date(page,'2026-10-31');
  let text=await page.locator('#calendar-agenda').innerText();assert.match(text,/QA Calendar oct31 Away/);assert.ok(!text.includes('QA Calendar nov1-0030'));
  await page.locator('#calendar-next').click();assert.match(await page.locator('#calendar-month').innerText(),/November 2026/);
  await date(page,'2026-11-01');
  text=await page.locator('#calendar-agenda').innerText();
  for(const id of ['nov1-0030','nov1-edt','nov1-est','nov1-2330'])assert.ok(text.includes(`QA Calendar ${id} Away`),id);
  assert.ok(!text.includes('QA Calendar oct31 Away'));assert.ok(!text.includes('QA Calendar nov2 Away'));
  assert.equal(await page.locator('#calendar-agenda [data-calendar-event]').count(),4);
  assert.match(await page.locator('[data-calendar-date="2026-11-01"]').getAttribute('aria-label'),/4/);
  await date(page,'2026-11-02');assert.equal(await page.locator('#calendar-agenda [data-calendar-event]').count(),1);assert.match(await page.locator('#calendar-agenda').innerText(),/QA Calendar nov2 Away/);
  assert.equal(calendarRequests.length,1,'Day and month navigation should reuse the verified schedule snapshot.');
 });
 await check('Date selection is accessible and an empty date remains a coverage-limited result',async()=>{
  const selected=page.locator('[data-calendar-date="2026-11-02"]');assert.equal(await selected.getAttribute('aria-pressed'),'true');
  assert.match(await selected.getAttribute('aria-label'),/November|Nov/);
  await selected.focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-calendar-date="2026-11-03"]').getAttribute('aria-pressed'),'true');
  await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('[data-calendar-date="2026-11-02"]').getAttribute('aria-pressed'),'true');
  await date(page,'2026-11-03');const text=await page.locator('#calendar-agenda').innerText();
  assert.match(text,/No .*returned|no .*returned|No .*published|No .*loaded/i);
  assert.match((await page.locator('#calendar-section').innerText()),/complete|coverage|published|not.*all|not.*mean/i);
  assert.equal(await page.locator('#calendar-agenda [data-calendar-event]').count(),0);
  await page.locator('#calendar-today').click();assert.match(await page.locator('#calendar-month').innerText(),/October 2026/);assert.equal(await page.locator('[data-calendar-date="2026-10-31"]').getAttribute('aria-pressed'),'true');
 });
 await check('Calendar opens current Game Center by the selected provider event and league',async()=>{
  await date(page,'2026-10-31');await page.locator('[data-calendar-event="americanfootball_nfl|qa-calendar-oct31"]').click();
  await page.locator('#center-dialog[open]').waitFor();await page.waitForFunction(()=>document.getElementById('center-content').textContent.includes('QA Calendar oct31 Away'));
  assert.equal(eventRequests.length,1);assert.match(eventRequests[0],/league=americanfootball_nfl/);assert.match(eventRequests[0],/eventId=qa-calendar-oct31/);
  assert.match(await page.locator('#center-content').innerText(),/No prices available|No fresh quotes|No prices/i);
  await closeDialogs(page);
 });
 await check('Fresh on-demand Game Center prices remain usable when the separate board fails, and save a guest idea',async()=>{
  boardOutage=true;eventQuotes=true;await page.clock.fastForward(11000);await page.locator('#refresh').click();
  await page.waitForFunction(()=>document.getElementById('feed-pill').textContent.includes('unavailable'));
  await date(page,'2026-10-31');await page.locator('[data-calendar-event="americanfootball_nfl|qa-calendar-oct31"]').click();
  await page.locator('#center-market').waitFor();
  assert.match(await page.locator('#center-content .consensus').innerText(),/Fresh books\s*2/);
  assert.equal(await page.locator('[data-center-save]:enabled').count(),1);assert.equal(await page.locator('#center-content [data-lab-add]:enabled').count(),1);
  assert.match(await page.locator('#center-content .swipe-books').innerText(),/Best price/);
  await page.locator('#center-group').selectOption({label:'QA Calendar oct31 Home · 2-way moneyline'});
  await page.locator('[data-center-save]').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('os-bets-guest-v4')||'[]').length===1);
  const records=await page.evaluate(()=>JSON.parse(localStorage.getItem('os-bets-guest-v4')));
  assert.equal(records[0].status,'saved');assert.equal(records[0].mode,'real');assert.equal(records[0].stake,null);assert.equal(records[0].legs[0].eventId,'qa-calendar-oct31');assert.equal(records[0].legs[0].selection,'QA Calendar oct31 Home');assert.equal(records[0].legs[0].decimal,2.2);
 });
 await check('Recent team form opens for a Calendar Game Center event absent from the failed board',async()=>{
  await page.locator('#center-content details').filter({has:page.locator('summary').filter({hasText:'Scout game breakdown'})}).locator('summary').click();
  await page.locator('[data-center-form]').click();await page.locator('#form-dialog[open]').waitFor();await page.waitForFunction(()=>document.getElementById('form-body').textContent.includes('QA empty final-results transport'));
  assert.equal(formRequests.length,1);const params=new URL(formRequests[0],base).searchParams;
  assert.equal(params.get('league'),'americanfootball_nfl');assert.equal(params.get('team'),'QA Calendar oct31 Home');assert.equal(params.get('opponent'),'QA Calendar oct31 Away');
  assert.match(await page.locator('#form-title').innerText(),/QA Calendar oct31 Away/);await page.locator('#form-dialog').evaluate(d=>d.close());
 });
 await check('A failed Game Center refresh removes old fresh-price rankings and save controls',async()=>{
  eventOutage=true;await page.locator('[data-center-retry]').click();await page.waitForFunction(()=>document.getElementById('center-content').textContent.includes('Game data unavailable'));
  assert.equal(await page.locator('[data-center-save]:enabled').count(),0);assert.equal(await page.locator('#center-content .swipe-book.best').count(),0);assert.equal(await page.locator('#center-content [data-lab-add]:enabled').count(),0);
  eventOutage=false;await page.locator('[data-center-retry]').click();await page.locator('#center-market').waitFor();assert.equal(await page.locator('[data-center-save]:enabled').count(),1);
 });
 await check('Offline then online never re-enables old Game Center prices until an explicit refresh succeeds',async()=>{
  const before=eventRequests.length;
  await context.setOffline(true);await page.waitForFunction(()=>navigator.onLine===false);await page.waitForFunction(()=>document.querySelector('[data-center-save]')?.disabled===true);
  assert.equal(await page.locator('#center-content .swipe-book.best').count(),0);
  await context.setOffline(false);await page.waitForFunction(()=>navigator.onLine===true);await page.clock.fastForward(16000);
  assert.equal(eventRequests.length,before);assert.equal(await page.locator('[data-center-save]:enabled').count(),0);assert.equal(await page.locator('#center-content .swipe-book.best').count(),0);
  await page.locator('[data-center-retry]').click();await page.locator('#center-market').waitFor();assert.equal(eventRequests.length,before+1);assert.equal(await page.locator('[data-center-save]:enabled').count(),1);
  await closeDialogs(page);boardOutage=false;
 });
 await check('Successful empty league differs from missing or failed schedule data',async()=>{
  await page.locator('#calendar-league').selectOption('basketball_nba');await calendarReady(page);
  assert.match(calendarRequests.at(-1),/league=basketball_nba/);
  assert.equal(await page.locator('#calendar-agenda [data-calendar-event]').count(),0);
  const text=await page.locator('#calendar-section').innerText();assert.match(text,/No .*returned|no .*returned|No .*published|No .*loaded/i);assert.ok(!text.includes('QA Calendar oct31 Away'));
 });
 await check('All-league pagination merges real-returned fixtures and preserves partial coverage warnings',async()=>{
  await page.locator('#calendar-league').selectOption('all');await calendarReady(page);
  assert.match(await page.locator('#calendar-section').innerText(),/NBA|partial|failed|unavailable/i);
  const firstAll=calendarRequests.filter(url=>url.includes('league=all'));assert.equal(firstAll.length,1);
  await page.locator('#calendar-more').click();await calendarReady(page);assert.match(calendarRequests.at(-1),/page=1/);
  await page.locator('#calendar-next').click();await date(page,'2026-11-01');
  assert.equal(await page.locator('#calendar-agenda [data-calendar-event]').count(),5);assert.match(await page.locator('#calendar-agenda').innerText(),/QA Calendar nhl Away/);
  assert.match(await page.locator('#calendar-section').innerText(),/NBA|partial|failed|unavailable/i);
 });
 for(const width of [320,390,1440])await check(`Calendar dates and agenda fit the ${width}px mobile/desktop viewport`,async()=>{
  await page.setViewportSize({width,height:950});await noOverflow(page,width);
  const day=page.locator('[data-calendar-date="2026-11-01"]');const box=await day.boundingBox();assert.ok(box&&box.width>=28&&box.height>=36,JSON.stringify(box));
  await day.focus();await page.keyboard.press('Enter');assert.equal(await day.getAttribute('aria-pressed'),'true');
  await noOverflow(page,width);
 });
 await check('Closing the calendar on mobile returns focus to a visible calendar opener',async()=>{
  await page.setViewportSize({width:390,height:950});await page.locator('#calendar-hide').click();assert.equal(await page.locator('#calendar-section').isVisible(),false);
  const focused=await page.evaluate(()=>({calendar:document.activeElement?.hasAttribute('data-calendar-open'),visible:Boolean(document.activeElement?.getClientRects().length)}));assert.deepEqual(focused,{calendar:true,visible:true});await openCalendar(page);
 });
 await check('Invalid schedule timestamps and missing all-league batch metadata are rejected visibly',async()=>{
  calendarFault='timestamp';await page.locator('#calendar-refresh').click();await page.waitForFunction(()=>/failed/i.test(document.getElementById('calendar-status').textContent));
  assert.equal(await page.locator('#calendar-agenda [data-calendar-event]').count(),0);assert.match(await page.locator('#calendar-section').innerText(),/invalid|verified|timestamp|unavailable/i);
  calendarFault='batch';await page.locator('#calendar-refresh').click();await page.waitForFunction(()=>/failed/i.test(document.getElementById('calendar-status').textContent));
  assert.equal(await page.locator('#calendar-agenda [data-calendar-event]').count(),0);assert.match(await page.locator('#calendar-section').innerText(),/batch|coverage|unavailable|verified/i);calendarFault='';
 });
 await check('Failed calendar refresh is explicit and never becomes a fake empty or replacement schedule',async()=>{
  outage=true;await page.locator('#calendar-refresh').click();
  await page.waitForFunction(()=>/unavailable|failed|outage/i.test(document.getElementById('calendar-status')?.textContent||''));
  const text=await page.locator('#calendar-section').innerText();assert.match(text,/unavailable|failed|outage/i);assert.ok(!/No upcoming events/i.test(text));
  const retained=await page.locator('#calendar-agenda [data-calendar-event]').count();if(retained)assert.match(text,/previous|unverified|stale|reference/i);
  assert.equal(await page.locator('[data-demo]').count(),0);
 });
 await check('First-load schedule failure shows an unavailable state with zero invented fixtures',async()=>{
  const fresh=await context.newPage();fresh.setDefaultTimeout(10000);fresh.on('pageerror',error=>pageErrors.push(error.message));
  try{
   await fresh.goto(base+'/?league=americanfootball_nfl');await fresh.locator('#scout-dialog').waitFor({state:'attached'});
   if(await fresh.locator('#age-dialog').evaluate(d=>d.open))await fresh.locator('#confirm-age').click();
   await fresh.waitForFunction(()=>document.getElementById('feed-pill').textContent.includes('Provider data'));await openCalendar(fresh);
   assert.match(await fresh.locator('#calendar-section').innerText(),/unavailable|failed|outage/i);assert.equal(await fresh.locator('#calendar-agenda [data-calendar-event]').count(),0);
   assert.ok(!(await fresh.locator('#calendar-agenda').innerText()).includes('QA Calendar'));assert.equal(await fresh.locator('[data-demo]').count(),0);
  }finally{await fresh.close();}
 });
 await check('Calendar tested flows have no JavaScript runtime or production CSP errors',async()=>{assert.deepEqual(pageErrors,[]);assert.deepEqual(cspViolations,[]);});
 await page.screenshot({path:resolve(evidence,'calendar-test-only-outage-1440.png'),fullPage:false});
}finally{
 await context.close();await browser.close();
 const report={testedAt:new Date().toISOString(),base,browser:'Chromium via Playwright',timezone:'America/New_York',clockTime:clockTime.toISOString(),checks,passed:checks.filter(c=>c.status==='passed').length,failed:checks.filter(c=>c.status==='failed').length,pageErrors,cspViolations,calendarRequests,eventRequests,formRequests,limitations:['All calendar/game responses in this test are explicitly isolated Playwright request fixtures. No test transport or fixture rows exist in the app runtime.','These tests verify UI behavior, date conversion and error handling. Actual provider schedule coverage is checked separately against the hosted API.']};
 await writeFile(resolve(evidence,'calendar-browser-report.json'),JSON.stringify(report,null,2));
 console.log(`Calendar browser QA: ${report.passed} passed, ${report.failed} failed.`);if(report.failed)process.exitCode=1;
}

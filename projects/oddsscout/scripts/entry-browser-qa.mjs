/** Actual entry-gate browser checks. No fixture API, account, or community transport is installed. */
import assert from 'node:assert/strict';
import {access,mkdir,readdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const project=fileURLToPath(new URL('../',import.meta.url));
const outputRoot=fileURLToPath(new URL('../../../outputs/',import.meta.url));
const base=new URL(process.env.ODDSSCOUT_QA_URL||'http://localhost:8888');
const unconfigured=process.env.ODDSSCOUT_QA_UNCONFIGURED_URL?new URL(process.env.ODDSSCOUT_QA_UNCONFIGURED_URL):null;
const code=process.env.ODDSSCOUT_QA_ACCESS_CODE;
assert.ok(code,'Provide the entry code through ODDSSCOUT_QA_ACCESS_CODE, never a command-line argument.');
assert.ok(base.protocol==='https:'||(base.protocol==='http:'&&base.hostname==='localhost'),'Entry QA requires HTTPS or localhost for the Secure session cookie.');
assert.equal(base.username,'');assert.equal(base.password,'');
const evidence=resolve(project,'test-evidence/v9/entry-browser.json');
await mkdir(resolve(project,'test-evidence/v9'),{recursive:true});await mkdir(outputRoot,{recursive:true});
const checks=[],runtimeErrors=[],cspViolations=[],requests=[];
const redact=value=>String(value).split(code).join('[redacted entry code]');
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
 catch(error){const message=redact(error.message);checks.push({name,status:'failed',error:message});console.error('FAIL '+name+': '+message);}
}
async function noOverflow(page,width){
 const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
 assert.ok(dimensions.document<=width+1,JSON.stringify(dimensions));assert.ok(dimensions.body<=width+1,JSON.stringify(dimensions));
 const box=await page.locator('#entry-form').boundingBox();assert.ok(box&&box.x>=-1&&box.x+box.width<=width+1,JSON.stringify(box));
}
async function entryReady(page){await page.locator('#entry-form').waitFor({state:'visible'});assert.equal(await page.locator('#entry-code').getAttribute('type'),'password');}
async function appReady(page){
 await page.locator('#scout-dialog').waitFor({state:'attached'});assert.equal(await page.locator('#entry-form').count(),0);
 if(await page.locator('#age-dialog').evaluate(dialog=>dialog.open))await page.locator('#confirm-age').click();
}
async function assertLockedResponse(context,path){
 const response=await context.request.get(new URL(path,base).href,{failOnStatusCode:false,maxRedirects:0});
 const entryDocument=path==='/'||path==='/index.html';
 assert.ok((entryDocument?[200,401,403]:[401,403]).includes(response.status()),`${path}: ${response.status()}`);
 assert.match(response.headers()['cache-control']||'',/no-store/i,`${path} must not cache an unauthorized response.`);
 const text=await response.text();
 if(entryDocument)assert.match(text,/id="entry-form"/,'A protected document must show only the admission screen.');
 assert.ok(!text.includes('id="games"')&&!text.includes('id="scout-dialog"'),`${path} exposed application markup.`);
 assert.ok(!text.includes('function refreshBoard')&&!text.includes('mountTracker'),`${path} exposed the application module.`);
 if(path.startsWith('/api/')||path.startsWith('/.netlify/functions/')){
  assert.match(response.headers()['content-type'],/application\/json/);const body=JSON.parse(text);
  assert.equal(body.events,undefined);assert.equal(body.sports,undefined);assert.equal(body.rows,undefined);assert.equal(body.games,undefined);
 }
}
const browser=await launch();
const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/New_York',locale:'en-US',reducedMotion:'reduce'});
const page=await context.newPage();page.setDefaultTimeout(20000);
page.on('pageerror',error=>runtimeErrors.push(redact(error.message)));
page.on('console',message=>{if(/Content Security Policy|violates.*directive|Refused to.*(style|script)/i.test(message.text()))cspViolations.push(redact(message.text()));});
page.on('request',request=>{
 const url=new URL(request.url());
 if(url.origin!==base.origin)return;
 requests.push({method:request.method(),path:url.pathname,codeInUrl:request.url().includes(code),rawRoomHeader:Boolean(request.headers()['x-room-code']),codeOutsideAccessBody:Boolean(request.postData()?.includes(code)&&url.pathname!=='/api/access')});
});
let entryCookieProperties=null;
try{
 await check('Unauthenticated entry shows the code prompt before loading the application',async()=>{
  const response=await page.goto(base.href,{waitUntil:'domcontentloaded'});assert.ok([200,401,403].includes(response.status()));await entryReady(page);
  assert.equal(await page.locator('#games').count(),0);assert.equal(await page.locator('#scout-dialog').count(),0);
  assert.equal(requests.filter(request=>request.path==='/app.mjs').length,0,'The protected application must not bootstrap before admission.');
  assert.match(response.headers()['cache-control']||'',/no-store/);
  const settings=await context.request.get(new URL('/api/access',base).href);assert.equal(settings.status(),200);const payload=await settings.json();assert.equal(payload.configured,true);assert.equal(payload.authenticated,false);assert.ok(!JSON.stringify(payload).includes(code));
 });
 await check('Missing and incorrect codes fail without exposing odds or a reusable session',async()=>{
  const missing=await context.request.post(new URL('/api/access',base).href,{data:{code:''}});assert.ok([400,401,403].includes(missing.status()));
  const wrong=code==='qa-never-the-entry-code'?'qa-another-wrong-entry-code':'qa-never-the-entry-code';
  await page.locator('#entry-code').fill(wrong);await page.locator('#entry-submit').click();
  await page.waitForFunction(()=>Boolean(document.getElementById('entry-error')?.textContent.trim()));assert.equal(await page.locator('#games').count(),0);
  assert.equal((await context.cookies()).filter(cookie=>cookie.name==='os_entry'&&cookie.value).length,0);
  assert.ok(!(await page.locator('#entry-error').innerText()).includes(wrong),'Errors must not reflect submitted codes.');await page.locator('#entry-code').fill('');
 });
 for(const width of [320,390,1440])await check(`Entry form is usable without horizontal overflow at ${width}px`,async()=>{
  await page.setViewportSize({width,height:width===390?844:950});await noOverflow(page,width);
  const input=await page.locator('#entry-code').boundingBox(),button=await page.locator('#entry-submit').boundingBox();
  assert.ok(input&&input.height>=40&&button&&button.height>=40,'Input and submit should remain practical touch targets.');
  await page.locator('#entry-code').focus();assert.equal(await page.locator('#entry-code').evaluate(element=>element===document.activeElement),true);
 });
 await check('Entry phone and desktop screenshots contain an empty password field',async()=>{
  await page.reload({waitUntil:'domcontentloaded'});await entryReady(page);await page.locator('#entry-code').fill('');await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(outputRoot,'OddsScout9-Entry-Mobile.png'),fullPage:false});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:resolve(outputRoot,'OddsScout9-Entry-Desktop.png'),fullPage:false});
 });
 await check('Direct HTML, application scripts, APIs and function aliases cannot bypass entry',async()=>{
  for(const path of ['/index.html','/app.mjs','/lib/identity-client.mjs','/api/config','/api/calendar?league=americanfootball_nfl','/.netlify/functions/config','/.netlify/functions/board'])await assertLockedResponse(context,path);
 });
 await check('Correct code submits with Enter and establishes an HttpOnly Secure server session',async()=>{
  await page.locator('#entry-code').fill(code);await page.keyboard.press('Enter');await appReady(page);
  const cookie=(await context.cookies()).find(item=>item.name==='os_entry');assert.ok(cookie,'The server must issue its signed entry cookie.');
  assert.equal(cookie.httpOnly,true);assert.equal(cookie.secure,true);assert.ok(['Lax','Strict'].includes(cookie.sameSite));assert.equal(cookie.path,'/');assert.ok(cookie.expires>Date.now()/1000);assert.ok(cookie.expires<=Date.now()/1000+8*3600+120);assert.ok(!cookie.value.includes(code));
  entryCookieProperties={name:cookie.name,httpOnly:cookie.httpOnly,secure:cookie.secure,sameSite:cookie.sameSite,path:cookie.path,maxRemainingSeconds:Math.round(cookie.expires-Date.now()/1000)};
  const status=await context.request.get(new URL('/api/access',base).href);assert.equal(status.status(),200);assert.equal((await status.json()).authenticated,true);
  const config=await context.request.get(new URL('/api/config',base).href);assert.equal(config.status(),200);assert.match(config.headers()['content-type'],/application\/json/);
  assert.ok(!(await page.evaluate(()=>document.cookie)).includes('os_entry='),'Page JavaScript must not read the entry cookie.');
 });
 await check('Entry code never appears in navigation URLs, raw room headers or browser storage',async()=>{
  const storage=await page.evaluate(()=>({url:location.href,local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage))}));
  assert.ok(!storage.url.includes(code));assert.ok(!JSON.stringify(storage.local).includes(code));assert.ok(!JSON.stringify(storage.session).includes(code));assert.equal(storage.session['os-room'],undefined);
  assert.deepEqual(requests.filter(request=>request.codeInUrl||request.rawRoomHeader||request.codeOutsideAccessBody),[]);
 });
 await check('Reload retains entry admission while an independent new browser stays locked',async()=>{
  await page.reload({waitUntil:'domcontentloaded'});await appReady(page);
  const stranger=await browser.newContext();try{await assertLockedResponse(stranger,'/api/config');const status=await stranger.request.get(new URL('/api/access',base).href);assert.equal((await status.json()).authenticated,false);}finally{await stranger.close();}
 });
 await check('Lock preview revokes the entry cookie, removes legacy room code and clears visible private UI',async()=>{
  await page.evaluate(()=>{sessionStorage.setItem('os-room','qa-legacy-room-code');localStorage.setItem('os-bets-guest-v4','[]');});
  await page.locator('[data-lock-preview]:visible').first().click();await entryReady(page);assert.equal(await page.locator('#scout-dialog').count(),0);assert.equal(await page.locator('#games').count(),0);
  const storage=await page.evaluate(()=>({legacy:sessionStorage.getItem('os-room'),guest:localStorage.getItem('os-bets-guest-v4')}));assert.equal(storage.legacy,null);assert.equal(storage.guest,'[]','Lock should preserve the explicitly browser-local guest ledger.');
  assert.equal((await context.cookies()).filter(cookie=>cookie.name==='os_entry'&&cookie.value).length,0);await assertLockedResponse(context,'/api/config');
  const status=await context.request.get(new URL('/api/access',base).href);assert.equal((await status.json()).authenticated,false);await page.reload({waitUntil:'domcontentloaded'});await entryReady(page);
 });
 if(unconfigured)await check('A separate server with no access code fails closed for page and API access',async()=>{
  const unavailable=await browser.newContext({viewport:{width:390,height:844}});try{
   const locked=await unavailable.newPage();const response=await locked.goto(unconfigured.href,{waitUntil:'domcontentloaded'});assert.equal(response.status(),503);await locked.locator('#entry-form').waitFor({state:'attached'});assert.equal(await locked.locator('html').getAttribute('data-entry-configured'),'false');assert.equal(await locked.locator('#entry-code').isDisabled(),true);assert.equal(await locked.locator('#entry-submit').isDisabled(),true);assert.equal(await locked.locator('#games').count(),0);
   for(const path of ['/api/config','/.netlify/functions/config','/app.mjs','/index.html']){const denied=await unavailable.request.get(new URL(path,unconfigured).href,{maxRedirects:0});assert.equal(denied.status(),503,`${path} must fail closed.`);}
   const submitted=await unavailable.request.post(new URL('/api/access',unconfigured).href,{data:{code:'qa-cannot-unlock-an-unconfigured-server'}});assert.equal(submitted.status(),503);
  }finally{await unavailable.close();}
 });
 await check('Entry flow has no JavaScript runtime errors or Content Security Policy violations',async()=>{assert.deepEqual(runtimeErrors,[]);assert.deepEqual(cspViolations,[]);});
}finally{
 await context.close();await browser.close();
 const report={testedAt:new Date().toISOString(),url:base.origin,unconfiguredUrl:unconfigured?.origin||null,browser:'Chromium via Playwright',checks,passed:checks.filter(result=>result.status==='passed').length,failed:checks.filter(result=>result.status==='failed').length,runtimeErrors,cspViolations,entryCookieProperties,requests,limitations:['Actual application entry routes and server cookie behavior are tested without intercepted API data.','This fresh isolated browser does not create accounts, post community messages, place bets, or exercise a signed-in member session.','The entry code is supplied through process environment and deliberately omitted from output and screenshots.','Local Secure-cookie behavior is tested on localhost; a hosted HTTPS run is still required before release.']};
 await writeFile(evidence,JSON.stringify(report,null,2));console.log(`Entry browser QA: ${report.passed} passed, ${report.failed} failed.`);if(report.failed)process.exitCode=1;
}

/** Read-only hosted Scout acceptance. Uses real deployed routes, without fixtures or request interception. */
import assert from 'node:assert/strict';
import {access,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const project=fileURLToPath(new URL('../',import.meta.url));
const outputRoot=fileURLToPath(new URL('../../../outputs/',import.meta.url));
const base=new URL(process.env.ODDSSCOUT_QA_URL||'https://example.invalid/');
assert.equal(base.protocol,'https:');assert.equal(base.hostname,'preview.example.invalid','Only the authorized immutable preview is accepted.');
const secretFile=await readFile(resolve(project,'.env.preview-access'),'utf8');
const rawCode=secretFile.match(/^ACCESS_CODE\s*=\s*(.*)$/m)?.[1]?.trim();
const code=rawCode?.replace(/^(["'])(.*)\1$/,'$2');
assert.ok(code,'Preview access code must be privately configured.');
const redact=value=>String(value).split(code).join('[redacted]');
const evidence=resolve(project,'test-evidence/v8-scout-hosted-browser.json');
await mkdir(outputRoot,{recursive:true});
const checks=[],runtimeErrors=[],consoleErrors=[],apiResponses=[];
let board=null,event=null,reply=null,question=null,model=null,selectedGroupId=null,selectedMarket=null;
async function launch(){
 try{return await chromium.launch();}catch(error){
  const cache=resolve(homedir(),'Library/Caches/ms-playwright');let directories;try{directories=await readdir(cache);}catch{throw error;}
  for(const directory of directories.filter(d=>d.startsWith('chromium_headless_shell-')).sort().reverse()){
   const executablePath=resolve(cache,directory,'chrome-headless-shell-mac-arm64/chrome-headless-shell');
   try{await access(executablePath);return await chromium.launch({executablePath});}catch{/* Try an installed compatible browser. */}
  }
  throw error;
 }
}
async function check(name,run){
 try{await run();checks.push({name,status:'passed'});console.log('PASS '+name);return true;}
 catch(error){const message=redact(error.message);checks.push({name,status:'failed',error:message});console.error('FAIL '+name+': '+message);return false;}
}
const browser=await launch();
const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/New_York',locale:'en-US',reducedMotion:'reduce'});
const page=await context.newPage();page.setDefaultTimeout(30000);
page.on('pageerror',error=>runtimeErrors.push(redact(error.message)));
page.on('console',message=>{if(message.type()==='error')consoleErrors.push(redact(message.text()));});
page.on('response',response=>{const url=new URL(response.url());if(url.origin===base.origin&&url.pathname.startsWith('/api/'))apiResponses.push({path:url.pathname+url.search,status:response.status()});});
let ready,answered=false;
try{
 ready=await check('Protected hosted entry opens without loading the app before admission',async()=>{
  const target=new URL(base);target.searchParams.set('league','americanfootball_nfl');
  await page.goto(target.href,{waitUntil:'domcontentloaded'});await page.locator('#entry-code').waitFor({state:'visible'});
  assert.equal(await page.locator('#entry-code').getAttribute('type'),'password');assert.equal(await page.locator('#games').count(),0);assert.equal(await page.locator('#scout-dialog').count(),0);
 });
 if(ready){
  for(const width of [320,390,1440])await check(`Private entry form fits the ${width}px viewport without horizontal overflow`,async()=>{
   await page.setViewportSize({width,height:width===1440?1000:844});
   const sizes=await page.evaluate(()=>{const form=document.getElementById('entry-form'),box=form.getBoundingClientRect();return {document:document.documentElement.scrollWidth,body:document.body.scrollWidth,left:box.left,right:box.right};});
   assert.ok(sizes.document<=width+1&&sizes.body<=width+1&&sizes.left>=-1&&sizes.right<=width+1,JSON.stringify(sizes));
   const input=await page.locator('#entry-code').boundingBox(),button=await page.locator('#entry-submit').boundingBox();assert.ok(input.height>=40&&button.height>=40);
  });
  await check('Entry phone screenshot is captured with the password field empty',async()=>{
   await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('#entry-code').inputValue(),'');
   await page.screenshot({path:resolve(outputRoot,'OddsScout-Entry-Test-Mobile.png'),fullPage:false});
  });
 }
 if(ready)ready=await check('Protected hosted entry accepts the private code and loads a real NFL board',async()=>{
  const boardResponse=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/board'&&url.searchParams.get('league')==='americanfootball_nfl';},{timeout:60000});
  await page.locator('#entry-code').fill(code);await page.locator('#entry-submit').click();await page.locator('#scout-dialog').waitFor({state:'attached'});
  if(await page.locator('#age-dialog').evaluate(dialog=>dialog.open))await page.locator('#confirm-age').click();
  const response=await boardResponse;assert.equal(response.status(),200);board=await response.json();assert.equal(board.mode,'live');assert.ok(board.events?.length>0);
  await page.locator('[data-center]').first().waitFor({state:'visible'});
  assert.ok(!page.url().includes(code));assert.equal(await page.locator('#entry-form').count(),0);
  const config=await context.request.get(new URL('/api/config',base).href);assert.equal(config.status(),200);const settings=await config.json();model=settings.aiModel||settings.scoutModel||settings.model||null;
 });
 if(ready)ready=await check('Game Center loads an actual upcoming NFL event and fresh sportsbook prices',async()=>{
  const button=page.locator('[data-center]').first();const id=await button.getAttribute('data-center');
  const responsePromise=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/event'&&url.searchParams.get('eventId')===id;},{timeout:60000});
  await button.click();await page.locator('#center-dialog[open]').waitFor();const response=await responsePromise;assert.equal(response.status(),200);const payload=await response.json();
  assert.equal(payload.mode,'live');assert.equal(payload.event.id,id);assert.ok(payload.event.bookmakers?.length>0);event=payload.event;
  await page.locator('#center-group').waitFor({state:'visible'});assert.ok(await page.locator('#center-content .swipe-book').count()>0);
  selectedGroupId=await page.locator('#center-group').inputValue();selectedMarket=await page.locator('#center-market').inputValue();assert.ok(selectedGroupId,'Game Center must select an exact line.');
 });
 if(ready)answered=await check('A real Scout game-context request renders the exact response and its actual AI or rules source',async()=>{
  await page.locator('#center-dialog [data-close="center-dialog"]').click();await page.locator('.scout-float').click();await page.locator('#scout-dialog[open]').waitFor();
  assert.match(await page.locator('#scout-context').innerText(),new RegExp(event.away_team.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  question='For the exact moneyline selection shown, compare the returned sportsbook prices and explain the main missing information and risks. State when this snapshot was observed.';
  await page.locator('#scout-question').fill(question);const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/ask',{timeout:45000});
  await page.locator('#scout-send').click();assert.equal(await page.locator('#scout-send').isDisabled(),true);
  const response=await responsePromise;assert.equal(response.status(),200);const sent=response.request().postDataJSON();assert.equal(sent.eventId,event.id);assert.equal(sent.league,event.sport_key);assert.equal(sent.market,selectedMarket);assert.equal(sent.groupId,selectedGroupId);
  reply=await response.json();assert.ok(['ai','rules'].includes(reply.mode));
  assert.ok(reply.text?.trim().length>80);assert.ok(reply.verified?.observedAt);assert.equal(reply.context?.kind,'event');assert.equal(reply.context.event,`${event.away_team} at ${event.home_team}`);assert.equal(reply.context.market,selectedMarket);assert.equal(reply.context.selectedOutcome?.id,selectedGroupId);
  await page.waitForFunction(()=>document.getElementById('scout-send').disabled===false);
  assert.equal(await page.locator('#scout-answer').innerText(),reply.text);assert.match(await page.locator('#scout-source').innerText(),reply.mode==='ai'?/^AI narration/:/^Rules-based education/);
 });
 if(answered){
  await check('Generated Scout AI is actually available from the configured provider',async()=>{assert.equal(reply.mode,'ai',JSON.stringify({mode:reply.mode,aiStatus:reply.aiStatus,note:reply.note}));});
  for(const width of [390,320,1440])await check(`Scout reply and controls fit the ${width}px viewport without horizontal overflow`,async()=>{
   await page.setViewportSize({width,height:width===1440?1000:844});
   const sizes=await page.evaluate(()=>{const dialog=document.getElementById('scout-dialog'),box=dialog.getBoundingClientRect();return {document:document.documentElement.scrollWidth,body:document.body.scrollWidth,dialogWidth:box.width,dialogLeft:box.left,dialogRight:box.right,clientWidth:dialog.clientWidth,scrollWidth:dialog.scrollWidth};});
   assert.ok(sizes.document<=width+1&&sizes.body<=width+1,JSON.stringify(sizes));assert.ok(sizes.dialogLeft>=-1&&sizes.dialogRight<=width+1,JSON.stringify(sizes));assert.ok(sizes.scrollWidth<=sizes.clientWidth+1,JSON.stringify(sizes));
   assert.equal(await page.locator('#scout-send').isEnabled(),true);assert.ok(await page.locator('#scout-question').isVisible());
  });
  await check('Actual Scout reply and source are captured honestly in the phone screenshot',async()=>{
   await page.setViewportSize({width:390,height:844});await page.locator('#scout-dialog').evaluate(dialog=>{dialog.scrollTop=0;});
   await page.screenshot({path:resolve(outputRoot,'OddsScout-Scout-Preview-Mobile.png'),fullPage:false});
   await page.locator('#scout-source').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(outputRoot,'OddsScout-Scout-Source-Mobile.png'),fullPage:false});
   if(reply.mode==='ai')await page.screenshot({path:resolve(outputRoot,'OddsScout-Scout-AI-Mobile.png'),fullPage:false});
  });
 }
 await check('Hosted Scout flow has no JavaScript runtime or browser console errors',async()=>{assert.deepEqual(runtimeErrors,[]);assert.deepEqual(consoleErrors,[]);});
}finally{
 await context.close();await browser.close();
 const report={testedAt:new Date().toISOString(),url:base.origin,browser:'Chromium via Playwright',timezone:'America/New_York',checks,passed:checks.filter(check=>check.status==='passed').length,failed:checks.filter(check=>check.status==='failed').length,runtimeErrors,consoleErrors,apiResponses,model,board:board?{source:board.source,mode:board.mode,eventCount:board.events?.length,fetchedAt:board.fetchedAt}:null,event:event?{id:event.id,league:event.sport_key,away:event.away_team,home:event.home_team,commenceTime:event.commence_time,bookmakers:event.bookmakers?.length,selectedMarket,selectedGroupId}:null,scout:reply?{status:200,mode:reply.mode,aiStatus:reply.aiStatus||null,note:reply.note,question,text:reply.text,verified:reply.verified,contextKind:reply.context?.kind,contextEvent:reply.context?.event,contextMarket:reply.context?.market,selectedOutcome:reply.context?.selectedOutcome,serverCalculatedPayout:reply.context?.calculated}:null,limitations:['The test used real deployed provider and OpenAI requests. No fixtures, API interception, invented games or canned replies were used.','Only one Scout request was issued. No bets, likes, chat messages, member account actions, deployment or production configuration changes were made.','Viewport tests used Chromium. No claim of physical iPhone or Safari testing is made.','The entry code and all cookie or signing-secret values are deliberately excluded from this report and screenshots.']};
 await writeFile(evidence,JSON.stringify(report,null,2));console.log(`Hosted Scout browser QA: ${report.passed} passed, ${report.failed} failed.`);if(report.failed)process.exitCode=1;
}

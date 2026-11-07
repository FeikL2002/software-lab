/** Actual protected-preview acceptance. Secrets/cookies never enter its report. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const [target]=process.argv.slice(2),base=new URL(target);
assert.equal(base.protocol,'https:');assert.equal(base.pathname,'/');assert.equal(base.search,'');assert.equal(base.hash,'');
const code=process.env.ACCESS_CODE;assert.ok(code,'Supply ACCESS_CODE privately in the process environment.');
const checks=[],headers={};let cookie='';
async function check(path,{method='GET',body,expected=200,authenticated=true}={}){
 const response=await fetch(new URL(path,base),{method,headers:{...headers,...(authenticated&&cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
 assert.equal(response.status,expected,`${method} ${path} HTTP ${response.status}`);assert.match(response.headers.get('content-type')||'',/application\/json/);
 const data=await response.json();assert.ok(!JSON.stringify(data).includes(code));
 checks.push({path,method,status:response.status,passed:true});console.log(`PASS ${method} ${path}: ${response.status}`);return {response,data};
}
await check('/api/config',{expected:401,authenticated:false});
const unlock=await check('/api/access',{method:'POST',body:{code},authenticated:false});assert.equal(unlock.data.authenticated,true);
cookie=unlock.response.headers.get('set-cookie')?.split(';')[0]||'';assert.ok(cookie.startsWith('os_entry='));
const config=(await check('/api/config')).data;assert.equal(config.entryAuthenticated,true);assert.equal(config.aiEnabled,true);
const calendar=(await check('/api/calendar?league=americanfootball_nfl')).data;assert.equal(calendar.mode,'live');assert.equal(calendar.source,'The Odds API');assert.ok(calendar.events.length);
const board=(await check('/api/board?league=americanfootball_nfl&market=h2h')).data;assert.equal(board.mode,'live');assert.ok(Array.isArray(board.events));
const stats=(await check('/api/performance?league=americanfootball_nfl&player=Patrick+Mahomes&statType=passing_yards&window=5')).data;assert.ok(stats.rows?.length);assert.ok(stats.source);assert.ok(stats.rows.every(row=>Number.isFinite(row.value)));
const account=(await check('/api/account')).data;
await check('/api/my-bets',{expected:401});await check('/api/chat',{expected:401});await check('/api/winnings',{expected:401});
await check('/api/ask',{expected:405});await check('/api/ask',{method:'POST',body:{},expected:400});
await check('/api/calendar?league=invalid-calendar-league',{expected:400});await check('/api/not-a-route',{expected:404});
const scout=(await check('/api/ask',{method:'POST',body:{question:'Explain the difference between returned cash and net profit with a $25 stake and $62.50 total returned.'}})).data;
assert.ok(['ai','rules'].includes(scout.mode));
if(scout.mode!=='ai')assert.equal(scout.aiStatus,'credits_exhausted','A rules fallback is not successful generated AI.');
await check('/api/access',{method:'DELETE'});cookie='';await check('/api/config',{expected:401});
const report={checkedAt:new Date().toISOString(),origin:base.origin,checks,passed:checks.length,failed:0,realData:{calendarEvents:calendar.events.length,boardEvents:board.events.length,playerStatsSource:stats.source,playerStatsRows:stats.rows.length},scout:{mode:scout.mode,aiStatus:scout.aiStatus||'available',generatedAiVerified:scout.mode==='ai',text:scout.text,note:scout.note},account:{configured:account.configured,provider:account.provider,storageConfigured:account.storageConfigured,signedIn:Boolean(account.user)},entrySessionVerified:true,plaintextSecretPrinted:false,productionDeployPerformed:false};
await writeFile('test-evidence/v8-hosted-private-api.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({apiChecks:checks.length,generatedAiVerified:report.scout.generatedAiVerified,aiStatus:report.scout.aiStatus,storageConfigured:account.storageConfigured}));

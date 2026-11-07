/** Read-only acceptance of actual provider schedule routes. No fixture transport. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const [target]=process.argv.slice(2);
if(!target)throw new Error('Supply the draft origin.');
const base=new URL(target);
if(base.protocol!=='https:'||base.pathname!=='/'||base.search||base.hash||base.username||base.password)throw new Error('Use the HTTPS draft origin without query or path.');
const checks=[],results=[];
for(const league of ['americanfootball_nfl','basketball_nba','icehockey_nhl','all']){
 const path='/api/calendar?'+new URLSearchParams({league,...(league==='all'?{page:'0'}:{})});
 const response=await fetch(new URL(path,base),{signal:AbortSignal.timeout(45000)});
 assert.equal(response.status,200,`${league} HTTP ${response.status}`);
 assert.match(response.headers.get('content-type'),/application\/json/);
 const data=await response.json();
 assert.equal(data.mode,'live');assert.equal(data.source,'The Odds API');assert.ok(Array.isArray(data.events));assert.ok(Number.isFinite(Date.parse(data.fetchedAt)));assert.equal(data.refreshSeconds,300);
 for(const event of data.events){assert.ok(event.id&&event.sport_key&&event.home_team&&event.away_team);assert.ok(Date.parse(event.commence_time)>Date.parse(data.fetchedAt));assert.equal(event.status,'upcoming');assert.deepEqual(event.bookmakers,[]);}
 if(league==='all'){assert.equal(data.batch.page,0);assert.ok(data.batch.loaded.length<=3);assert.ok(Array.isArray(data.batch.failed));}
 const dates=data.events.map(e=>e.commence_time).sort();
 results.push({league,eventCount:data.events.length,fetchedAt:data.fetchedAt,firstStart:dates[0]||null,lastStart:dates.at(-1)||null,reportedUsageCost:data.usage?.cost??null,batch:data.batch||null,source:data.source,coverage:data.coverage});
 checks.push({path,status:response.status,passed:true});console.log(`PASS actual calendar ${league}: ${data.events.length} upcoming provider fixtures`);
}
for(const [path,method,status] of [['/api/calendar','POST',405],['/api/calendar?league=invalid-calendar-league','GET',400],['/api/calendar?league=americanfootball_nfl&page=1','GET',400]]){
 const response=await fetch(new URL(path,base),{method,signal:AbortSignal.timeout(45000)});assert.equal(response.status,status);assert.match(response.headers.get('content-type'),/application\/json/);checks.push({path,method,status,passed:true});console.log(`PASS calendar guard ${method} ${path}: ${status}`);
}
const accountResponse=await fetch(new URL('/api/account',base));const account=await accountResponse.json();
const report={checkedAt:new Date().toISOString(),origin:base.origin,checks,results,account:{status:accountResponse.status,provider:account.provider,configured:account.configured,storageConfigured:account.storageConfigured,signedIn:Boolean(account.user)},productionDeployPerformed:false,limitations:['These are actual provider-published upcoming fixtures, not a complete season calendar.','No confirmed in-play games, completed sign-in, cloud persistence, chat post or generated AI acceptance is inferred from calendar success.']};
await writeFile('test-evidence/v7-hosted-calendar-api.json',JSON.stringify(report,null,2));console.log(`${checks.length} actual calendar API checks passed. No fixture injection or production write.`);

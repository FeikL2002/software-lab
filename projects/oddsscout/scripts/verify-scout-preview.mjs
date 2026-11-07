/** Actual AI acceptance against an explicitly protected draft. No fixture transport. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {compareGroups,formatOdds,groupLabel,payout} from '../public/lib/odds.mjs';
const base=new URL(process.argv[2]);
assert.equal(base.protocol,'https:');assert.match(base.hostname,/^[0-9a-f]{24}--oddsscout-lewis-preview\.netlify\.app$/);assert.equal(base.pathname,'/');assert.equal(base.search,'');assert.equal(base.hash,'');
const code=process.env.ACCESS_CODE;assert.ok(code,'Provide the private entry code through the process environment.');
const checks=[],answers=[];let cookie='';
async function api(path,{method='GET',body,status=200,useSession=true}={}){
 const start=Date.now(),response=await fetch(new URL(path,base),{method,headers:{...(cookie&&useSession?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
 assert.equal(response.status,status,`${method} ${path}: HTTP ${response.status}`);assert.match(response.headers.get('content-type')||'',/application\/json/);
 const data=await response.json();assert.ok(!JSON.stringify(data).includes(code));
 checks.push({path,method,status,elapsedMs:Date.now()-start,passed:true});console.log(`PASS ${method} ${path}: ${status}`);return {response,data};
}
try{
 const locked=(await api('/api/ask',{method:'POST',body:{question:'Explain total returned.'},status:401,useSession:false})).data;assert.equal(locked.code,'ROOM_LOCKED');
 const access=await api('/api/access',{method:'POST',body:{code},useSession:false});cookie=access.response.headers.get('set-cookie')?.split(';')[0]||'';assert.ok(cookie.startsWith('os_entry='));
 const education=(await api('/api/ask',{method:'POST',body:{question:'How are net profit and total returned different? Use a hypothetical $25 wager with a $62.50 return.'}})).data;
 answers.push({kind:'education',...education});assert.equal(education.mode,'ai',`Education returned ${education.mode}/${education.aiStatus||'no status'}`);assert.ok(education.text.length>30);assert.match(education.text,/37\.50\b/);assert.match(education.note,/AI-generated/);
 const board=(await api('/api/board?league=americanfootball_nfl&market=h2h')).data;assert.equal(board.mode,'live');
 const event=board.events.find(e=>compareGroups(e,'h2h').some(g=>g.best&&g.comparable));assert.ok(event,'Need a real upcoming or live comparable selection.');const group=compareGroups(event,'h2h').find(g=>g.best&&g.comparable);
 const answer=(await api('/api/ask',{method:'POST',body:{question:'For this exact selection, name the highest-paying sportsbook and its American odds. Explain what a $25 winning wager would return including the original $25, and state what is uncertain. Do not predict a winner.',league:event.sport_key,eventId:event.id,market:'h2h',groupId:group.id,stake:25}})).data;
 answers.push({kind:'event',...answer});assert.equal(answer.mode,'ai',`Game context returned ${answer.mode}/${answer.aiStatus||'no status'}`);assert.ok(answer.text.length>30);assert.ok(answer.verified?.observedAt);assert.equal(answer.context.event,`${event.away_team} at ${event.home_team}`);assert.equal(answer.context.selectedOutcome.id,group.id);
 const selected=answer.context.selectedOutcome;assert.equal(answer.verified.bestBook,selected.bestBook);assert.equal(answer.verified.bestOdds,selected.bestOdds);assert.ok(selected.booksCompared>=2);assert.ok(answer.text.toLowerCase().includes(selected.bestBook.toLowerCase()),'Generated answer should identify the authoritative best book.');
 const report={checkedAt:new Date().toISOString(),origin:base.origin,generatedAiVerified:true,checks,answers,event:{id:event.id,league:event.sport_key,away:event.away_team,home:event.home_team,selection:groupLabel(group),boardBestBook:group.best.title,boardBestOdds:formatOdds(group.best.price),verifiedBestBook:selected.bestBook,verifiedBestOdds:selected.bestOdds,verifiedBestDecimal:selected.bestDecimal,hypotheticalStake:25,returnAtBoardPrice:payout(25,group.best.price),returnAtVerifiedPrice:payout(25,selected.bestDecimal),serverCalculatedPayout:answer.context.calculated,observedAt:answer.verified.observedAt},configuredModelExpected:'gpt-4.1-mini',runtimeModelVerified:false,fixtureTransport:false,productionDeployPerformed:false,limitations:['Only these bounded education/game samples are verified. Generated text remains an explanation, not a calibrated prediction or guarantee.','Generated odds, payout and observation-time wording require manual comparison with the authoritative event fields and stored answer text; only the best-book name is automatically checked in the narration.','The expected model name is recorded from project configuration knowledge; the deployed response does not expose runtime model metadata.','Private entry protection is separate from still-unresolved cloud user storage.']};
 await writeFile('test-evidence/v8-scout-credit-retest.json',JSON.stringify(report,null,2));console.log(JSON.stringify({generatedAiVerified:true,educationCharacters:education.text.length,eventCharacters:answer.text.length,verifiedBestBook:selected.bestBook,verifiedBestOdds:selected.bestOdds}));
}catch(error){
 const report={checkedAt:new Date().toISOString(),origin:base.origin,generatedAiVerified:false,checks,answers,error:error.message,fixtureTransport:false,productionDeployPerformed:false};
 await writeFile('test-evidence/v8-scout-credit-retest.json',JSON.stringify(report,null,2));throw error;
}finally{
 if(cookie)await api('/api/access',{method:'DELETE'}).catch(()=>console.error('Could not confirm private test-session cleanup.'));
}

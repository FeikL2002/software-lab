/** Check a deployed preview; never print credentials or upstream response bodies. */
import {compareGroups} from '../public/lib/odds.mjs';
const [target,...flags]=process.argv.slice(2);
if(!target){console.error('Usage: npm run verify:routes -- https://example.invalid [--require-live] [--exercise-ask] [--exercise-form]');process.exit(1);}
const base=new URL(target);
if(base.username||base.password||base.search||base.hash||base.pathname!=='/')throw new Error('Supply only the site origin, without credentials, query, or path.');
if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw new Error('Use HTTPS for a deployed site.');
let failed=0;
const headers={};
// Exercise the same signed admission as browsers; do not send raw access headers to app APIs.
const accessCode=process.env.ODDSSCOUT_QA_ACCESS_CODE||process.env.ACCESS_CODE;
if(accessCode){
 const admission=await fetch(new URL('/api/access',base),{method:'POST',headers:{'Content-Type':'application/json',Origin:base.origin},body:JSON.stringify({code:accessCode}),signal:AbortSignal.timeout(15000)});
 if(!admission.ok||(await admission.json()).authenticated!==true)throw new Error('Preview admission failed; no credentials were recorded.');
 const cookie=admission.headers.getSetCookie().find(value=>value.startsWith('os_entry='));
 if(!cookie)throw new Error('Admission did not issue a session cookie.');
 headers.Cookie=cookie.split(';')[0];
}
async function check(path,{method='GET',body,allowed=[200]}={}){
 try{
  const r=await fetch(new URL(path,base),{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(35000)});
  if(!r.headers.get('content-type')?.includes('application/json'))throw new Error(`HTTP ${r.status}, not JSON (missing function or HTML fallback)`);
  const data=await r.json();
  if(!allowed.includes(r.status))throw new Error(`HTTP ${r.status}, ${/^[A-Z_]+$/.test(data.code||'')?data.code:'request failed'}`);
  console.log(`PASS ${method} ${path}: HTTP ${r.status}, JSON`);
  return {status:r.status,data};
 }catch(e){failed++;console.error(`FAIL ${method} ${path}: ${e.name==='TypeError'?'network request failed':e.message}`);return null;}
}
const config=await check('/api/config');
const sports=await check('/api/sports',{allowed:[200,401,403,429,502,503]});
const board=await check('/api/board?league=upcoming&market=h2h',{allowed:[200,401,403,429,502,503]});
await check('/api/ask',{method:'POST',body:{},allowed:[400,401]});
await check('/api/ask',{allowed:[405]});
await check('/api/form',{allowed:[400,401]});
await check('/api/form',{method:'POST',body:{},allowed:[405]});
await check('/api/event',{allowed:[400,401,503]});
await check('/api/calendar?league=americanfootball_nfl',{allowed:[200,401,403,429,502,503]});
await check('/api/calendar',{method:'POST',body:{},allowed:[405]});
await check('/api/calendar?league=invalid-calendar-league',{allowed:[400,401]});
await check('/api/chat',{allowed:[401]});
await check('/api/winnings',{allowed:[401]});
await check('/api/performance',{allowed:[400,401,422,503]});
await check('/api/community',{allowed:[200,401,503]});
await check('/api/account',{allowed:[200,503]});
await check('/api/account',{method:'PUT',body:{},allowed:[405]});
await check('/api/my-bets',{allowed:[401]});
await check('/api/my-bets',{method:'PUT',body:{},allowed:[405]});
const missing=await check('/api/not-a-route',{allowed:[404]});
if(missing&&missing.data.code!=='API_NOT_FOUND'){failed++;console.error('FAIL API miss does not use the JSON route-not-found handler.');}
if(config&&(config.data.apiVersion!==3||typeof config.data.oddsConfigured!=='boolean')){failed++;console.error('FAIL configuration schema/version mismatch.');}
const live=board?.status===200&&board.data.mode==='live'&&board.data.source==='The Odds API'&&Array.isArray(board.data.events)&&sports?.status===200&&sports.data.mode==='live';
if(live)console.log(`Provider data path responded successfully: ${board.data.events.length} returned events. Verify fixture coverage and individual timestamps before use.`);
else {console.log('LIVE DATA NOT VERIFIED. Routes may exist, but a configured, authorized provider response is still required.');if(flags.includes('--require-live'))failed++;}
if(flags.includes('--exercise-ask')){
 if(!live){failed++;console.error('Cannot exercise the explainer until the real-data board succeeds.');}
 else {
  const event=board.data.events.find(e=>compareGroups(e,'h2h').some(g=>g.best));
  const group=event&&compareGroups(event,'h2h').find(g=>g.best);
  if(!event||!group){failed++;console.error('No fresh line available; explainer connectivity not verified.');}
  else {
   const result=await check('/api/ask',{method:'POST',body:{eventId:event.id,groupId:group.id,question:'Explain this exact price comparison.',league:'upcoming',market:'h2h',stake:25}});
   if(result){if(!['ai','rules'].includes(result.data.mode)||typeof result.data.text!=='string'){failed++;console.error('FAIL invalid explainer result.');}else console.log(`Explainer returned ${result.data.mode==='ai'?'an AI response':'a rules-based explanation (AI not verified)'}.`);}
  }
 }
}
if(flags.includes('--exercise-form')){
 const supported=new Set(['basketball_nba','americanfootball_nfl','baseball_mlb','icehockey_nhl']);
 const event=live&&board.data.events.find(e=>supported.has(e.sport_key));
 if(!event){failed++;console.error('No supported real event is available to exercise the form adapter.');}
 else {
  const q=new URLSearchParams({league:event.sport_key,team:event.home_team,opponent:event.away_team});
  const result=await check('/api/form?'+q);
  if(result){if(result.data.mode!=='live'||!Array.isArray(result.data.games)||result.data.complete!==true){failed++;console.error('Recent-form data is not live-provider data with complete pagination.');}else console.log(`Recent-results provider returned ${result.data.games.length} final-score rows. Suggestions additionally require adequate recent samples and fresh odds.`);}
 }
}
console.log(`Result: ${failed} failed check(s). Production was not modified.`);
process.exitCode=failed?1:0;

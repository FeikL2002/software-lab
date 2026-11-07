import test,{beforeEach,afterEach} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import account from '../netlify/functions/account.mjs';import myBets from '../netlify/functions/my-bets.mjs';
import {accountConfig} from '../server/accounts.mjs';
import {makeDemo} from './fixtures/demo.mjs';import {compareGroups,eventStatus} from '../public/lib/odds.mjs';
import {singleSnapshot,makeSavedBet,recordPlacement} from '../public/lib/bets.mjs';
const ORIGINAL=globalThis.fetch,env={...process.env};const A='10000000-0000-4000-8000-000000000001',B='20000000-0000-4000-8000-000000000002';let calls,rows,upstreamStatus;
const users={token_access_user_a:{id:A,email:'a@example.test'},token_access_user_b:{id:B,email:'b@example.test'}};
function fixture(demo=false){const now=Date.now(),e=makeDemo('all','h2h',now).events.find(e=>eventStatus(e,now)==='upcoming'),g=compareGroups(e,'h2h',{now})[0];return makeSavedBet([singleSnapshot(e,g.id,'h2h',null,null,now)],{demo,now});}
function req(path,method='GET',body,token='token_access_user_a',origin='https://app.example.test'){
 return new Request('https://app.example.test'+path,{method,headers:{Origin:origin,...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Cookie:`__Host-os-access=${token}; __Host-os-refresh=token_refresh_user_a`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
beforeEach(()=>{
 process.env.SUPABASE_URL='https://mock-project.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test_only';calls=[];rows=[];upstreamStatus=null;
 globalThis.fetch=async(url,opt={})=>{
  const u=new URL(url),method=opt.method||'GET',body=opt.body?JSON.parse(opt.body):null,token=opt.headers.Authorization?.replace('Bearer ','');calls.push({url:u.toString(),method,body,headers:opt.headers});
  if(upstreamStatus)return Response.json({error:'private upstream details that must not leak',secret:'secret-value'}, {status:upstreamStatus});
  if(u.pathname==='/auth/v1/user')return users[token]?Response.json(users[token]):Response.json({error:'expired'}, {status:401});
  if(u.pathname==='/auth/v1/signup')return Response.json({user:{id:A,email:'a@example.test'}});
  if(u.pathname==='/auth/v1/recover')return Response.json({});
  if(u.pathname==='/auth/v1/logout')return new Response(null,{status:204});
  if(u.pathname==='/auth/v1/token'||u.pathname==='/auth/v1/verify')return Response.json({access_token:'token_access_user_a',refresh_token:'token_refresh_user_a',expires_in:3600,user:users.token_access_user_a});
  if(u.pathname==='/rest/v1/oddsscout_bets'){
   const who=users[token]?.id;if(!who)return Response.json({error:'auth'}, {status:401});
   if(method==='POST'){
    if(body.user_id!==who)return Response.json({error:'RLS denied'}, {status:403});
    if(rows.some(r=>r.id===body.id))return Response.json({error:'duplicate'}, {status:409});
    const row={...body,version:1};rows.push(row);return Response.json([row]);
   }
   const id=u.searchParams.get('id')?.replace('eq.',''),version=u.searchParams.get('version')?.replace('eq.','');
   const matches=rows.filter(r=>r.user_id===who&&(!id||r.id===id)&&(!version||r.version===Number(version)));
   if(method==='PATCH'){for(const r of matches){r.record=body.record;r.version++;}return Response.json(matches);}
   if(method==='DELETE'){rows=rows.filter(r=>!matches.includes(r));return Response.json(matches);}
   return Response.json(matches.slice(Number(u.searchParams.get('offset')||0),Number(u.searchParams.get('offset')||0)+100));
  }
  throw new Error('Unexpected path in test '+u.pathname);
 };
});
afterEach(()=>{globalThis.fetch=ORIGINAL;for(const k of ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY'])if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];});
test('No account config returns a clear guest-only flag without keys',async()=>{delete process.env.SUPABASE_URL;const r=await account(req('/api/account'));assert.equal(r.status,200);assert.deepEqual(await r.json(),{configured:false,user:null});assert.equal(calls.length,0);});
test('Account configuration rejects secret and service-role keys',()=>{process.env.SUPABASE_PUBLISHABLE_KEY='sb_secret_forbidden';assert.throws(accountConfig);process.env.SUPABASE_PUBLISHABLE_KEY='eyJ.test.bad';assert.throws(accountConfig);});
test('Account config only permits expected HTTPS Supabase project hosts',()=>{for(const url of ['http://mock.supabase.co','https://evil.test','https://good.supabase.co.evil.test','https://x:secret@mock.supabase.co']){process.env.SUPABASE_URL=url;assert.throws(accountConfig);}});
test('Private account GET validates user via Supabase, not a client-supplied user id',async()=>{const r=await account(req('/api/account'));assert.equal((await r.json()).user.id,A);assert.ok(calls[0].url.endsWith('/auth/v1/user'));});
test('Expired or forged access token cannot read bets',async()=>{const r=await myBets(req('/api/my-bets','GET',undefined,'forged_token'));assert.equal(r.status,401);assert.equal(calls.filter(c=>c.url.includes('/rest/')).length,0);});
test('Signed-out users cannot enumerate private bets',async()=>{const r=await myBets(req('/api/my-bets','GET',undefined,null));assert.equal(r.status,401);assert.equal(calls.length,0);});
test('Login returns HttpOnly secure same-site cookies without tokens in JSON',async()=>{const r=await account(req('/api/account','POST',{action:'login',email:'a@example.test',password:'password_for_test'},null));assert.equal(r.status,200);const headers=r.headers.getSetCookie();assert.equal(headers.length,2);for(const h of headers){assert.match(h,/HttpOnly/);assert.match(h,/Secure/);assert.match(h,/SameSite=Lax/);assert.match(h,/Path=\//);}const body=await r.text();assert.ok(!body.includes('token_access'));assert.ok(!body.includes('refresh_token'));assert.match(r.headers.get('cache-control'),/no-store/);});
test('Signup requires age self-attestation',async()=>{const r=await account(req('/api/account','POST',{action:'signup',email:'a@example.test',password:'password_for_test'},null));assert.equal(r.status,400);assert.equal(calls.length,0);});
test('Signup with email confirmation does not pretend the user is signed in',async()=>{const r=await account(req('/api/account','POST',{action:'signup',email:'a@example.test',password:'password_for_test',ageConfirmed:true},null));const d=await r.json();assert.equal(d.user,null);assert.match(d.message,/email/);assert.equal(r.headers.getSetCookie().length,0);});
test('Cross-origin account and ledger mutations are denied',async()=>{for(const handler of [account,myBets]){const r=await handler(req('/api/account','POST',{action:'login'},'token_access_user_a','https://evil.test'));assert.equal(r.status,403);}assert.equal(calls.length,0);});
test('Account API rejects non-JSON and oversized bodies',async()=>{const a=await account(new Request('https://app.example.test/api/account',{method:'POST',body:'{}'}));assert.equal(a.status,415);const b=await account(req('/api/account','POST',{padding:'a'.repeat(21000)}));assert.equal(b.status,413);});
test('Account service error body and credentials do not leak',async()=>{upstreamStatus=400;const r=await account(req('/api/account','POST',{action:'login',email:'a@example.test',password:'password_for_test'}));const t=await r.text();for(const value of ['private upstream','secret-value','password_for_test','sb_publishable'])assert.ok(!t.includes(value));});
test('Rate limit is explicit and asks for cooldown',async()=>{upstreamStatus=429;const r=await account(req('/api/account'));assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');});
test('Refresh uses HTTP-only refresh cookie and never returns the new token in JSON',async()=>{const r=await account(req('/api/account','POST',{action:'refresh'}));assert.equal(r.status,200);assert.equal(calls[0].body.refresh_token,'token_refresh_user_a');assert.ok(!(await r.text()).includes('token_refresh'));});
test('Logout expires both cookies even when upstream revocation is down',async()=>{upstreamStatus=502;const r=await account(req('/api/account','POST',{action:'logout'}));assert.equal(r.status,200);assert.ok(r.headers.getSetCookie().every(h=>h.includes('Max-Age=0')));});
test('Recovery requests do not reveal whether an email exists',async()=>{const r=await account(req('/api/account','POST',{action:'recover',email:'unknown@example.test'},null));assert.equal(r.status,200);assert.match((await r.json()).message,/If this email/);});
test('Confirmation-link session is verified before cookies are issued',async()=>{const r=await account(req('/api/account','POST',{action:'session',access_token:'forged_token',refresh_token:'forged_refresh_token'},null));assert.equal(r.status,401);assert.equal(r.headers.getSetCookie().length,0);});
test('Owner A can save a bet and receives server revision',async()=>{const b=fixture(),r=await myBets(req('/api/my-bets','POST',{record:b,user_id:B}));assert.equal(r.status,201);const d=await r.json();assert.equal(d.record._version,1);assert.equal(rows[0].user_id,A);});
test('Demo records cannot enter real cloud ledger',async()=>{const r=await myBets(req('/api/my-bets','POST',{record:fixture(true)}));assert.equal(r.status,400);assert.equal(rows.length,0);});
test('Malformed self-reported financial records are rejected',async()=>{const b=fixture();b.status='won';b.returnAmount=999999;const r=await myBets(req('/api/my-bets','POST',{record:b}));assert.equal(r.status,400);});
test('Owner B cannot read, modify or delete owner A records in RLS-mocked API',async()=>{const b=fixture();await myBets(req('/api/my-bets','POST',{record:b}));let r=await myBets(req('/api/my-bets','GET',undefined,'token_access_user_b'));assert.deepEqual((await r.json()).records,[]);r=await myBets(req('/api/my-bets','PATCH',{record:b,version:1},'token_access_user_b'));assert.equal(r.status,409);r=await myBets(req('/api/my-bets','DELETE',{id:b.id,version:1},'token_access_user_b'));assert.equal(r.status,409);assert.equal(rows.length,1);});
test('Private responses are not cached and are cookie-varying',async()=>{const r=await myBets(req('/api/my-bets'));assert.match(r.headers.get('cache-control'),/private, no-store/);assert.equal(r.headers.get('vary'),'Cookie');});
test('Optimistic concurrency rejects a stale revision without overwriting',async()=>{const b=fixture();await myBets(req('/api/my-bets','POST',{record:b}));const next={...b,notes:'Changed'};const a=await myBets(req('/api/my-bets','PATCH',{record:next,version:1}));assert.equal(a.status,200);assert.equal((await a.json()).record._version,2);const r=await myBets(req('/api/my-bets','PATCH',{record:{...b,notes:'Old device'},version:1}));assert.equal(r.status,409);assert.equal(rows[0].record.notes,'Changed');});
test('Original snapshot cannot be silently replaced during placement',async()=>{const b=fixture();await myBets(req('/api/my-bets','POST',{record:b}));const c=structuredClone(b);c.quotedDecimal=3;const r=await myBets(req('/api/my-bets','PATCH',{record:c,version:1}));assert.equal(r.status,400);assert.equal(rows[0].record.quotedDecimal,b.quotedDecimal);});
test('Owner deletion removes a record only with matching revision',async()=>{const b=fixture();await myBets(req('/api/my-bets','POST',{record:b}));const r=await myBets(req('/api/my-bets','DELETE',{id:b.id,version:1}));assert.equal(r.status,200);assert.equal(rows.length,0);});
test('Invalid ID and pagination injection are rejected',async()=>{const r=await myBets(req('/api/my-bets','DELETE',{id:'x&user_id=neq.me',version:1}));assert.equal(r.status,400);const q=await myBets(req('/api/my-bets?offset=0&user_id='+B));assert.equal(q.status,400);});
test('RLS migration contains all four ownership policies and anonymous revocation (static check, not execution)',async()=>{const sql=await readFile(new URL('../supabase/migrations/001_my_bets.sql',import.meta.url),'utf8');assert.match(sql,/enable row level security/i);assert.match(sql,/force row level security/i);assert.match(sql,/revoke all on table.*from anon, authenticated, public/i);assert.match(sql,/for select to authenticated/i);assert.match(sql,/for insert to authenticated/i);assert.match(sql,/for update to authenticated/i);assert.match(sql,/for delete to authenticated/i);assert.equal((sql.match(/auth.uid\(\)/g)||[]).length,5);assert.match(sql,/on delete cascade/i);});

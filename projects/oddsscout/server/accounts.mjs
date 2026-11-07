/** Same-origin Supabase adapter. Supabase verifies passwords and JWTs; we never log them.
 * Uses a publishable/anon key plus the user's JWT. NEVER uses a service-role key.
 */
import {env,AppError,json,sameOrigin} from './common.mjs';
export function accountConfig(){
 if(env('ACCOUNTS_PROVIDER').trim()==='netlify'||env('NETLIFY_DB_URL').trim())return {provider:'netlify'};
 const raw=env('SUPABASE_URL').trim(),key=env('SUPABASE_PUBLISHABLE_KEY').trim();
 if(!raw||!key)return null;
 let url;try{url=new URL(raw);}catch{throw new AppError('The owner must fix SUPABASE_URL.',503,'ACCOUNT_CONFIG');}
 if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.username||url.password||url.search||url.hash||(url.pathname!=='/'&&url.pathname!==''))throw new AppError('Use the HTTPS project URL from Supabase, ending in .supabase.co.',503,'ACCOUNT_CONFIG');
 if(key.startsWith('sb_secret_'))throw new AppError('Use a Supabase publishable or anon key, never a secret/service-role key.',503,'ACCOUNT_CONFIG');
 if(key.startsWith('ey')){try{if(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role!=='anon')throw new Error();}catch{throw new AppError('Use the anon key, not the service-role key.',503,'ACCOUNT_CONFIG');}}
 else if(!key.startsWith('sb_publishable_'))throw new AppError('Use a Supabase publishable or anon key.',503,'ACCOUNT_CONFIG');
 return {url:url.origin,key};
}
export function accountProvider(){const config=accountConfig();return config?.provider||(config?'supabase':null);}
export function requireAccountConfig(){const c=accountConfig();if(!c)throw new AppError('Private account sync is not configured. The owner must set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, apply the included SQL migration, and redeploy. Guest saves remain on this browser only.',503,'ACCOUNTS_NOT_CONFIGURED');return c;}
export async function limitedJSON(request,max=24000){
 sameOrigin(request);if(!request.headers.get('content-type')?.includes('application/json'))throw new AppError('Use a JSON request.',415,'JSON_REQUIRED');
 if(Number(request.headers.get('content-length'))>max)throw new AppError('Request too large.',413,'TOO_LARGE');
 const reader=request.body?.getReader();if(!reader)throw new AppError('Request body required.',400,'BAD_REQUEST');let size=0,parts=[];
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new AppError('Request too large.',413,'TOO_LARGE');}parts.push(value);}
 try{return JSON.parse(Buffer.concat(parts).toString());}catch{throw new AppError('Invalid JSON.',400,'BAD_REQUEST');}
}
export async function supa(path,{method='GET',body,token,headers={}}={}){
 const c=requireAccountConfig();let r;
 try{r=await fetch(c.url+path,{method,headers:{apikey:c.key,Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}) ,...headers},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});}catch{throw new AppError('Account service unavailable. No cloud changes were confirmed. Retry when connected.',502,'ACCOUNT_UNAVAILABLE');}
 if(!r.ok){
  if(r.status===429)throw new AppError('The account service requested a cooldown. Please try again later.',429,'ACCOUNT_LIMIT',60);
  if(r.status===401||r.status===403)throw new AppError('Sign in again to access your private records.',401,'SIGN_IN_REQUIRED');
  if(r.status===409)throw new AppError('This record already exists. Refresh My Bets before trying again.',409,'RECORD_CONFLICT');
  if(r.status===404)throw new AppError('Account storage is not ready. The owner should run supabase/migrations/001_my_bets.sql.',503,'STORAGE_NOT_READY');
  if(path.startsWith('/auth/')&&r.status<500)throw new AppError('The account request was not accepted. Check the email, password, confirmation link or recovery code; then try again.',400,'AUTH_REQUEST_FAILED');
  throw new AppError('The account service could not complete this request. Check the project configuration and database migration. Nothing was silently saved locally.',502,'ACCOUNT_REQUEST_FAILED');
 }
 if(r.status===204||r.headers.get('content-length')==='0')return null;
 const t=await r.text();if(!t)return null;try{return JSON.parse(t);}catch{throw new AppError('Account service returned invalid data.',502,'ACCOUNT_BAD_RESPONSE');}
}
function cookieNames(request){const secure=new URL(request.url).protocol==='https:';return {secure,access:secure?'__Host-os-access':'os-dev-access',refresh:secure?'__Host-os-refresh':'os-dev-refresh'};}
export function readCookies(request){const cookies={};for(const part of (request.headers.get('cookie')||'').split(';')){const i=part.indexOf('=');if(i>0)cookies[part.slice(0,i).trim()]=part.slice(i+1).trim();}return cookies;}
export function tokens(request){const n=cookieNames(request),c=readCookies(request);return {access:c[n.access],refresh:c[n.refresh]};}
export function withSession(response,request,session=null){
 const n=cookieNames(request),clear=!session;const tokenSafe=t=>typeof t==='string'&&/^[A-Za-z0-9._~-]{10,10000}$/.test(t);
 if(!clear&&(!tokenSafe(session.access_token)||!tokenSafe(session.refresh_token)))throw new AppError('Account service did not return a valid session.',502,'ACCOUNT_BAD_SESSION');
 const expires=clear?0:Math.min(86400,Math.max(60,Number(session.expires_in)||3600));
 for(const [name,value,age]of [[n.access,session?.access_token||'',expires],[n.refresh,session?.refresh_token||'',clear?0:7*86400]])response.headers.append('Set-Cookie',`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${n.secure?'; Secure':''}`);
 response.headers.set('Cache-Control','private, no-store');response.headers.set('Vary','Cookie');return response;
}
export function identityAccount(user){
 if(!user||typeof user.id!=='string'||!user.id||user.id.length>128||typeof user.email!=='string'||user.email.length>254)throw new AppError('Sign in to access your private cloud records.',401,'SIGN_IN_REQUIRED');
 return {user:{id:user.id,email:user.email},provider:'netlify'};
}
export async function verifiedUser(request){
 if(accountConfig()?.provider==='netlify'){
  // The official SDK reads the platform's verified request context / session, never a client user ID.
  try{const {getUser}=await import('@netlify/identity');return identityAccount(await getUser());}catch(error){if(error instanceof AppError)throw error;throw new AppError('Your account session could not be verified. Sign in again.',401,'SIGN_IN_REQUIRED');}
 }
 const token=tokens(request).access;if(!token)throw new AppError('Sign in to access your private cloud records.',401,'SIGN_IN_REQUIRED');const user=await supa('/auth/v1/user',{token});if(!user?.id||!user.email)throw new AppError('Unable to verify your account.',401,'SIGN_IN_REQUIRED');return {user:{id:user.id,email:user.email},token};}
export const privateJSON=(body,status=200)=>{const r=json(body,status);r.headers.set('Cache-Control','private, no-store');r.headers.set('Vary','Cookie');return r;};

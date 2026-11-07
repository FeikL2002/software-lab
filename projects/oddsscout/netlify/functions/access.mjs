import {env,json,handleError,AppError,sameOrigin,readJsonBody} from '../../server/common.mjs';
import {entryConfigured,accessCodeMatches,createEntrySession,getEntrySession,entryCookie,clearEntryCookie} from '../../server/entry-session.mjs';

const attempts=new Map();
const ATTEMPT_WINDOW=10*60*1000,MAX_FAILURES=5;
function checkAttempts(client,now=Date.now()) {
 const found=attempts.get(client);
 if(found&&found.expires<=now)attempts.delete(client);
 else if(found&&found.count>=MAX_FAILURES)throw new AppError('Too many incorrect codes. Please wait before trying again.',429,'ACCESS_RATE_LIMITED',Math.ceil((found.expires-now)/1000));
}
function recordFailure(client,now=Date.now()) {
 const found=attempts.get(client);
 attempts.set(client,{count:found&&found.expires>now?found.count+1:1,expires:found&&found.expires>now?found.expires:now+ATTEMPT_WINDOW});
 if(attempts.size>10000)for(const [key,bucket] of attempts)if(bucket.expires<=now)attempts.delete(key);
 if(attempts.size>10000)attempts.delete(attempts.keys().next().value);
}
function mutationOrigin(request) {
 sameOrigin(request);
 if(request.headers.get('sec-fetch-site')==='cross-site')throw new AppError('Cross-site requests are not allowed.',403,'ORIGIN_DENIED');
}
function privateResponse(data,status=200) {
 const response=json(data,status);
 response.headers.set('Cache-Control','private, no-store');
 response.headers.set('Netlify-CDN-Cache-Control','no-store');
 response.headers.set('Vary','Cookie');
 return response;
}

export default async function(request,context={}) {
 const supported=['GET','POST','DELETE'];
 if(!supported.includes(request.method)) {
  const response=privateResponse({error:'Method not allowed.',code:'METHOD_NOT_ALLOWED'},405);
  response.headers.set('Allow',supported.join(', '));return response;
 }
 try {
  if(new URL(request.url).search)throw new AppError('Unsupported access query parameters.',400,'BAD_QUERY');
  if(request.method!=='GET')mutationOrigin(request);
  if(request.method==='DELETE') {
   const response=privateResponse({authenticated:false,configured:entryConfigured(env('ACCESS_CODE'))});
   response.headers.set('Set-Cookie',clearEntryCookie());return response;
  }
  const accessCode=env('ACCESS_CODE');
  if(!entryConfigured(accessCode))return privateResponse({authenticated:false,configured:false,error:'Private access is not configured. Ask the site owner to configure access and redeploy.',code:'ACCESS_NOT_CONFIGURED'},503);
  if(request.method==='GET') {
   const session=getEntrySession(request,accessCode);
   return privateResponse({authenticated:Boolean(session),configured:true,expiresAt:session?.expiresAt??null});
  }
  // Netlify's configured platform limiter enforces a shared IP limit. This additional
  // warm-instance cooldown slows repeated incorrect guesses without persisting codes.
  const client=typeof context.ip==='string'&&context.ip?context.ip:'unknown';
  checkAttempts(client);
  const body=await readJsonBody(request,1024);
  if(Object.keys(body).length!==1||!Object.hasOwn(body,'code')||typeof body.code!=='string')throw new AppError('Enter an access code.',400,'BAD_BODY');
  if(!accessCodeMatches(body.code,accessCode)) {
   recordFailure(client);return privateResponse({authenticated:false,configured:true,error:'That access code is incorrect.',code:'ACCESS_DENIED'},401);
  }
  attempts.delete(client);
  const session=createEntrySession(request,accessCode);
  const response=privateResponse({authenticated:true,configured:true,expiresAt:session.expiresAt});
  response.headers.set('Set-Cookie',entryCookie(session.token,session.ttlSeconds));return response;
 }catch(error) {
  const response=handleError(error);
  response.headers.set('Cache-Control','private, no-store');response.headers.set('Netlify-CDN-Cache-Control','no-store');response.headers.set('Vary','Cookie');return response;
 }
}

export const config={rateLimit:{action:'rate_limit',windowLimit:12,windowSize:60,aggregateBy:['domain','ip']}};
// Test isolation only. This is not exposed by any HTTP route.
export function clearEntryAttemptsForTests(){attempts.clear();}

import {validateEntrySession} from './entry-session.mjs';
import {timingSafeEqual} from 'node:crypto';
export const env = key => globalThis.Netlify?.env?.get(key) ?? process.env[key] ?? '';
export class AppError extends Error { constructor(message,status=500,code='ERROR',retryAfter=null) {super(message);this.status=status;this.code=code;this.retryAfter=retryAfter;} }
export function json(data,status=200,cacheSeconds=0) {
 const headers={'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'};
 if(cacheSeconds>0 && !env('ACCESS_CODE')) {
  headers['Cache-Control']='public, max-age=0, must-revalidate';
  headers['Netlify-CDN-Cache-Control']=`public, durable, max-age=${Math.max(1,Math.floor(cacheSeconds))}`;
  headers['Netlify-Vary']='query=league|market|page|eventId|markets';
 }
 return new Response(JSON.stringify(data),{status,headers});
}
export function handleError(error) {
 // Never log an upstream URL: the provider key is a query parameter.
 const safe=error instanceof AppError;
 if(!safe||error.status>=500)console.warn('OddsScout backend unavailable', {code:safe?error.code:'SERVER_ERROR',status:safe?error.status:500});
 const retryAfter=safe&&Number.isFinite(error.retryAfter)?Math.max(1,Math.ceil(error.retryAfter)):null;
 const response=json({error:safe?error.message:'The server could not complete this request. Please try again.',code:safe?error.code:'SERVER_ERROR',...(retryAfter?{retryAfter}:{})},safe?error.status:500);
 if(retryAfter)response.headers.set('Retry-After',String(retryAfter));
 return response;
}
export function authorize(request) {
 const code=env('ACCESS_CODE'); if(!code) return;
 if(validateEntrySession(request,code))return;
 const supplied=request.headers.get('X-Room-Code')||'';
 const a=Buffer.from(code),b=Buffer.from(supplied);
 if(a.length!==b.length || !timingSafeEqual(a,b)) throw new AppError('Enter the room code from the site owner.',401,'ROOM_LOCKED');
}
export function sameOrigin(request) {
 const origin=request.headers.get('origin');
 if(origin && origin!==new URL(request.url).origin) throw new AppError('Cross-site requests are not allowed.',403,'ORIGIN_DENIED');
}
export function readScope(url) {
 for(const key of url.searchParams.keys()) if(!['league','market','page'].includes(key) || url.searchParams.getAll(key).length!==1) throw new AppError('Unsupported query parameters.',400,'BAD_QUERY');
 const league=url.searchParams.get('league')||'upcoming', market=url.searchParams.get('market')||'h2h';
 if(!/^[a-z][a-z0-9_]{0,90}$/.test(league) || !['h2h','spreads','totals','outrights'].includes(market)) throw new AppError('Choose a supported league and market.',400,'BAD_QUERY');
 const rawPage=url.searchParams.get('page')||'0';
 if(!/^(0|[1-9]\d{0,3})$/.test(rawPage) || (url.searchParams.has('page') && league!=='all')) throw new AppError('Invalid league batch.',400,'BAD_QUERY');
 return {league,market,page:Number(rawPage)};
}
export function readEventScope(url) {
 for(const key of url.searchParams.keys())if(!['league','eventId','markets'].includes(key)||url.searchParams.getAll(key).length!==1)throw new AppError('Unsupported event query parameters.',400,'BAD_QUERY');
 const league=url.searchParams.get('league')||'',eventId=url.searchParams.get('eventId')||'';
 const markets=(url.searchParams.get('markets')||'h2h,spreads,totals').split(',').map(m=>m.trim());
 if(!/^[a-z][a-z0-9_]{0,90}$/.test(league)||['all','upcoming'].includes(league)||!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)||!markets.length||markets.length>20||markets.some(m=>!/^[a-z][a-z0-9_]{0,90}$/.test(m))||(markets.includes('available')&&markets.length!==1))throw new AppError('Choose an event, league and up to 20 valid market keys. Market discovery must be requested by itself.',400,'BAD_QUERY');
 return {league,eventId,markets:[...new Set(markets)]};
}
// Warm-instance single-flight cache; the public endpoints additionally use Netlify's durable CDN cache.
const cache=new Map();
export async function cached(key,seconds,work) {
 const found=cache.get(key); if(found && found.expires>Date.now()) return await found.promise;
 const duration=value=>Math.max(1,typeof seconds==='function'?seconds(value):seconds);
 const entry={expires:Date.now()+duration()*1000,promise:null};
 entry.promise=Promise.resolve().then(work).then(value=>{entry.expires=Date.now()+duration(value)*1000;return value;}).catch(e=>{
  if(Number.isFinite(e.retryAfter)&&e.retryAfter>0)entry.expires=Date.now()+e.retryAfter*1000;
  else if(cache.get(key)===entry)cache.delete(key);
  throw e;
 });
 cache.set(key,entry);
 if(cache.size>250)for(const [k,v] of cache)if(v.expires<Date.now())cache.delete(k);
 if(cache.size>500)for(const key of [...cache.keys()].slice(0,cache.size-500))cache.delete(key);
 return await entry.promise;
}
export const cacheTTL = (fetchedAt,seconds) => Math.max(1,seconds-(Date.now()-Date.parse(fetchedAt))/1000);
export async function mapConcurrent(items,limit,fn) {
 let next=0; const result=new Array(items.length);
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;result[i]=await fn(items[i],i);}}));
 return result;
}
export async function readJsonBody(request,maxBytes=4096) {
 if(!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError('Send a JSON request.',415,'BAD_BODY');
 if(Number(request.headers.get('content-length')||0)>maxBytes) throw new AppError('Request is too large.',413,'TOO_LARGE');
 const reader=request.body?.getReader(); if(!reader) throw new AppError('A request body is required.',400,'BAD_BODY');
 let size=0; const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw new AppError('Request is too large.',413,'TOO_LARGE');}chunks.push(value);}
 try {const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body||typeof body!=='object'||Array.isArray(body))throw 0;return body;}catch{throw new AppError('Invalid JSON body.',400,'BAD_BODY');}
}

// Test isolation only; no HTTP route exposes this helper.
export function clearCacheForTests(){ cache.clear(); }

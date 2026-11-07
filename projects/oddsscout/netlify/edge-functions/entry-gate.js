import {entryPage,ENTRY_SECURITY_HEADERS} from '../../server/entry-page.mjs';

const COOKIE_NAME='os_entry',MAX_TTL=8*60*60;
const encoder=new TextEncoder();
const PUBLIC_PATHS=new Set(['/api/access','/.netlify/functions/access','/entry.css','/entry.mjs','/icon.svg','/icon-192.png','/icon-512.png','/favicon.ico']);
const env=key=>globalThis.Netlify?.env?.get(key)??'';
const byteLength=value=>typeof value==='string'?encoder.encode(value).length:0;
const configured=(code,secret)=>byteLength(code)>=1&&byteLength(code)<=256&&byteLength(secret)>=32&&byteLength(secret)<=1024;
const unbase64url=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),character=>character.charCodeAt(0));

async function hmacKey(code,secret) {
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const derived=await crypto.subtle.sign('HMAC',key,encoder.encode(`OddsScout entry session v1\0${code}`));
 return await crypto.subtle.importKey('raw',derived,{name:'HMAC',hash:'SHA-256'},false,['verify']);
}

export async function validEdgeSession(request,code,secret,now=Date.now()) {
 if(!configured(code,secret))return false;
 const values=(request.headers.get('cookie')||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(`${COOKIE_NAME}=`));
 if(values.length!==1)return false;
 const token=values[0].slice(COOKIE_NAME.length+1);
 if(token.length>180||!/^v1\.[a-z0-9]{1,12}\.[a-z0-9]{1,12}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(token))return false;
 const parts=token.split('.'),issued=parseInt(parts[1],36),expires=parseInt(parts[2],36),current=Math.floor(now/1000);
 if(!Number.isSafeInteger(issued)||!Number.isSafeInteger(expires)||!Number.isSafeInteger(current)||issued>current+30||expires<=current||expires<=issued||expires-issued>MAX_TTL)return false;
 try {
  return await crypto.subtle.verify('HMAC',await hmacKey(code,secret),unbase64url(parts[4]),encoder.encode(`${parts.slice(0,4).join('.')}\n${new URL(request.url).origin}`));
 }catch{return false;}
}

async function validLegacyHeader(request,code) {
 const supplied=request.headers.get('x-room-code')||'';
 if(byteLength(supplied)<1||byteLength(supplied)>256)return false;
 const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(supplied)),crypto.subtle.digest('SHA-256',encoder.encode(code))]);
 let difference=0;const left=new Uint8Array(a),right=new Uint8Array(b);
 for(let i=0;i<left.length;i++)difference|=left[i]^right[i];
 return difference===0;
}

export default async function(request,context) {
 const url=new URL(request.url);
 if(PUBLIC_PATHS.has(url.pathname))return;
 const code=env('ACCESS_CODE'),secret=env('ENTRY_SESSION_SECRET'),ready=configured(code,secret);
 const api=url.pathname.startsWith('/api/')||url.pathname.startsWith('/.netlify/functions/')||url.pathname.startsWith('/.netlify/identity');
 const document=!api&&['GET','HEAD'].includes(request.method)&&(url.pathname==='/'||url.pathname==='/index.html'||request.headers.get('accept')?.includes('text/html')||request.headers.get('sec-fetch-dest')==='document');
 const allowed=ready&&(await validEdgeSession(request,code,secret)||(api&&await validLegacyHeader(request,code)));
 if(allowed) {
  // All app resources are private. Override downstream static/CDN cache headers so
  // a previous visitor's unlocked response cannot become a public cache hit.
  const response=await context.next();
  const headers=new Headers(response.headers);
  headers.set('Cache-Control','private, no-store');headers.set('Netlify-CDN-Cache-Control','no-store');headers.set('Vary',headers.get('Vary')?`${headers.get('Vary')}, Cookie`:'Cookie');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 }
 const headers=new Headers(ENTRY_SECURITY_HEADERS);
 if(document) {
  headers.set('Content-Type','text/html; charset=utf-8');
  return new Response(request.method==='HEAD'?null:entryPage({configured:ready}),{status:ready?200:503,headers});
 }
 headers.set('Content-Type','application/json; charset=utf-8');
 return new Response(JSON.stringify({error:ready?'Enter the access code from the site owner.':'Private access is not configured. Ask the site owner to configure access and redeploy.',code:ready?'ROOM_LOCKED':'ACCESS_NOT_CONFIGURED'}),{status:ready?401:503,headers});
}

// All app assets must be protected, including aliases and direct module requests.
// An exact allowlist above keeps the entry form usable before authentication.
export const config={path:'/*',onError:'fail'};

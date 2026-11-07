import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

export const ENTRY_COOKIE_NAME='os_entry';
export const ENTRY_TTL_SECONDS=8*60*60;
const readEnv=key=>globalThis.Netlify?.env?.get(key)??process.env[key]??'';
const validAccessCode=value=>typeof value==='string'&&Buffer.byteLength(value,'utf8')>=1&&Buffer.byteLength(value,'utf8')<=256;
const validSigningSecret=value=>typeof value==='string'&&Buffer.byteLength(value,'utf8')>=32&&Buffer.byteLength(value,'utf8')<=1024;

export function entryConfigured(accessCode,signingSecret=readEnv('ENTRY_SESSION_SECRET')) {
 return validAccessCode(accessCode)&&validSigningSecret(signingSecret);
}

export function accessCodeMatches(supplied,accessCode) {
 if(!validAccessCode(supplied)||!validAccessCode(accessCode))return false;
 return timingSafeEqual(createHash('sha256').update(supplied).digest(),createHash('sha256').update(accessCode).digest());
}

function signingKey(accessCode,signingSecret) {
 // A separate random server secret prevents offline guessing of an owner's entry code.
 // Binding the code to the signing key invalidates every session when that code changes.
 return createHmac('sha256',signingSecret).update('OddsScout entry session v1\0').update(accessCode).digest();
}

export function createEntrySession(request,accessCode,{signingSecret=readEnv('ENTRY_SESSION_SECRET'),now=Date.now(),ttlSeconds=ENTRY_TTL_SECONDS}={}) {
 if(!entryConfigured(accessCode,signingSecret))throw new Error('Entry access is not configured.');
 const issued=Math.floor(now/1000),ttl=Math.min(ENTRY_TTL_SECONDS,Math.max(1,Math.floor(ttlSeconds)));
 if(!Number.isSafeInteger(issued)||!Number.isSafeInteger(ttl))throw new Error('Invalid entry session lifetime.');
 const expires=issued+ttl;
 const payload=`v1.${issued.toString(36)}.${expires.toString(36)}.${randomBytes(16).toString('base64url')}`;
 const signature=createHmac('sha256',signingKey(accessCode,signingSecret)).update(`${payload}\n${new URL(request.url).origin}`).digest('base64url');
 return {token:`${payload}.${signature}`,expiresAt:new Date(expires*1000).toISOString(),ttlSeconds:ttl};
}

export function readEntryToken(request) {
 const values=(request.headers.get('cookie')||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(`${ENTRY_COOKIE_NAME}=`));
 if(values.length!==1)return null;
 const token=values[0].slice(ENTRY_COOKIE_NAME.length+1);
 return token.length<=180?token:null;
}

export function getEntrySession(request,accessCode,{signingSecret=readEnv('ENTRY_SESSION_SECRET'),now=Date.now()}={}) {
 if(!entryConfigured(accessCode,signingSecret))return null;
 const token=readEntryToken(request);
 if(!token||!/^v1\.[a-z0-9]{1,12}\.[a-z0-9]{1,12}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(token))return null;
 const parts=token.split('.'),issued=parseInt(parts[1],36),expires=parseInt(parts[2],36),current=Math.floor(now/1000);
 if(!Number.isSafeInteger(issued)||!Number.isSafeInteger(expires)||!Number.isSafeInteger(current)||issued>current+30||expires<=current||expires<=issued||expires-issued>ENTRY_TTL_SECONDS)return null;
 const expected=createHmac('sha256',signingKey(accessCode,signingSecret)).update(`${parts.slice(0,4).join('.')}\n${new URL(request.url).origin}`).digest();
 const supplied=Buffer.from(parts[4],'base64url');
 if(supplied.length!==expected.length||!timingSafeEqual(expected,supplied))return null;
 return {expiresAt:new Date(expires*1000).toISOString()};
}

export function validateEntrySession(request,accessCode,options) {
 return getEntrySession(request,accessCode,options)!==null;
}

export function entryCookie(token,ttlSeconds=ENTRY_TTL_SECONDS) {
 if(!/^v1\.[A-Za-z0-9_.-]+$/.test(token))throw new Error('Invalid entry cookie.');
 return `${ENTRY_COOKIE_NAME}=${token}; Path=/; Max-Age=${Math.min(ENTRY_TTL_SECONDS,Math.max(1,Math.floor(ttlSeconds)))}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearEntryCookie() {
 return `${ENTRY_COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}

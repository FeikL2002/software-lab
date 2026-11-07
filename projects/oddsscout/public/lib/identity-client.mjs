/** Browser-only adapter for the official Netlify Identity SDK. No application passwords pass through our API. */
let sdk=null,flight=null,snapshot={user:null,settings:null,callback:null,error:null},listening=false;
const listeners=new Set();
export const hasAuthCallback=()=>/^(?:#|&)(?:confirmation_token|recovery_token|invite_token|email_change_token|access_token|error)=/.test(location.hash);
export const identitySnapshot=()=>snapshot;
function publish(event='change'){for(const fn of listeners)fn(event,snapshot);}
export function onIdentityChange(fn){listeners.add(fn);return()=>listeners.delete(fn);}
export async function initializeIdentity(){
 if(flight)return flight;
 flight=(async()=>{
  try{
   sdk=await import('/vendor/identity.mjs');
   if(!listening){sdk.onAuthChange((event,user)=>{snapshot={...snapshot,user:user||null};publish(event);});listening=true;}
   // Every landing page processes confirmation, recovery, invite and OAuth callbacks.
   const callback=await sdk.handleAuthCallback();
   const settings=await sdk.getSettings();
   const user=await sdk.getUser();
   snapshot={user:user||null,settings,callback:callback||null,error:null};publish('ready');return snapshot;
  }catch(error){
   snapshot={...snapshot,error:new Error(error?.message||'Account service is unavailable. Reconnect and retry.')};
   publish('error');throw snapshot.error;
  }
 })().catch(error=>{flight=null;throw error;});
 return flight;
}
export async function identityAction(action,fields={}){
 await initializeIdentity();let result;
 if(action==='login')result=await sdk.login(fields.email,fields.password);
 else if(action==='signup')result=await sdk.signup(fields.email,fields.password,{full_name:fields.displayName,age_confirmed:fields.ageConfirmed===true});
 else if(action==='logout')result=await sdk.logout();
 else if(action==='recover')result=await sdk.requestPasswordRecovery(fields.email);
 else if(action==='password')result=await sdk.updateUser({password:fields.password});
 else if(action==='invite')result=await sdk.acceptInvite(fields.token,fields.password);
 else if(action==='oauth')return sdk.oauthLogin(fields.provider);
 else if(action==='refresh')result=await sdk.refreshSession();
 else throw new Error('Unsupported account action.');
 snapshot={...snapshot,user:await sdk.getUser(),error:null};publish(action);return {user:snapshot.user,result};
}
/** Consume an email link inside this preview when the email opens the site's other domain. */
export async function processIdentityEmailLink(value){
 let url;try{url=new URL(value);}catch{throw new Error('Paste the complete secure account link from your email.');}
 if(url.protocol!=='https:'||url.username||url.password)throw new Error('Use the HTTPS account link from your email.');
 const params=new URLSearchParams(url.hash.slice(1)),supported=['confirmation_token','recovery_token','invite_token','email_change_token'],found=supported.filter(k=>params.has(k));
 if(found.length!==1||!params.get(found[0])||params.get(found[0]).length>10000)throw new Error('This link has no supported confirmation, recovery or invitation token.');
 await initializeIdentity();
 const clean=new URLSearchParams({[found[0]]:params.get(found[0])});
 history.replaceState(null,'',location.pathname+location.search+'#'+clean.toString());
 try{
  const callback=await sdk.handleAuthCallback();snapshot={...snapshot,user:await sdk.getUser(),callback,error:null};publish('callback');return callback;
 }finally{history.replaceState(null,'',location.pathname+location.search);}
}

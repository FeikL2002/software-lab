import {socialRepository} from '../../server/social-repository.mjs';
import {AppError,handleError,authorize} from '../../server/common.mjs';
import {accountConfig,requireAccountConfig,limitedJSON,supa,tokens,withSession,verifiedUser,privateJSON} from '../../server/accounts.mjs';
export default async function(request){try{authorize(request);
 if(accountConfig()?.provider==='netlify'){
  if(request.method!=='GET')return privateJSON({error:'Use the secure Identity sign-in controls for account actions.',code:'IDENTITY_CLIENT_REQUIRED'},405);
  let user=null;try{({user}=await verifiedUser(request));}catch(error){if(error.code!=='SIGN_IN_REQUIRED')throw error;}
  const storageConfigured=Boolean(globalThis.Netlify?.env?.get('NETLIFY_DB_URL')||process.env.NETLIFY_DB_URL);
  let profile=null,storageError=null;
  if(user&&storageConfigured){try{profile=await socialRepository.profile(user.id);}catch(error){storageError=error.code||'STORAGE_UNAVAILABLE';}}
  return privateJSON({configured:true,provider:'netlify',storageConfigured,user,profile,...(storageError?{storageError}:{})});
 }
 if(request.method==='GET'){
  if(!accountConfig())return privateJSON({configured:false,user:null});
  if(!tokens(request).access)return privateJSON({configured:true,user:null,refreshAvailable:Boolean(tokens(request).refresh)});
  const {user}=await verifiedUser(request);return privateJSON({configured:true,user});
 }
 if(request.method!=='POST')return privateJSON({error:'Method not allowed.',code:'METHOD_NOT_ALLOWED'},405);
 const body=await limitedJSON(request,20000);const action=body?.action;
 if(action==='logout'){
  const token=tokens(request).access;if(token){try{await supa('/auth/v1/logout?scope=local',{method:'POST',token});}catch{/* Local cookies are cleared even when revocation is unavailable. */}}
  return withSession(privateJSON({user:null,loggedOut:true}),request);
 }
 requireAccountConfig();
 if(action==='refresh'){
  const refresh=tokens(request).refresh;if(!refresh)throw new AppError('Please sign in.',401,'SIGN_IN_REQUIRED');
  const session=await supa('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:refresh}});
  return withSession(privateJSON({user:{id:session.user.id,email:session.user.email},configured:true}),request,session);
 }
 if(action==='session'){
  // Supabase email-confirmation / password-recovery link. Browser strips fragment first.
  if(typeof body.access_token!=='string'||typeof body.refresh_token!=='string'||body.access_token.length>10000||body.refresh_token.length>10000)throw new AppError('Invalid confirmation link.',400,'BAD_SESSION');
  const user=await supa('/auth/v1/user',{token:body.access_token});
  if(!user?.id||!user.email)throw new AppError('The confirmation session could not be verified.',401,'SIGN_IN_REQUIRED');
  return withSession(privateJSON({configured:true,user:{id:user.id,email:user.email}}),request,{access_token:body.access_token,refresh_token:body.refresh_token,expires_in:3600});
 }
 if(action==='password'){
  const {user,token}=await verifiedUser(request);
  if(typeof body.password!=='string'||body.password.length<12||body.password.length>128)throw new AppError('Use a password of 12–128 characters.',400,'BAD_PASSWORD');
  await supa('/auth/v1/user',{method:'PUT',token,body:{password:body.password}});return privateJSON({user,updated:true});
 }
 if(!['signup','login','recover','verifyRecovery'].includes(action))throw new AppError('Unsupported account action.',400,'BAD_ACTION');
 const email=typeof body.email==='string'?body.email.trim():'';if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new AppError('Enter a valid email address.',400,'BAD_EMAIL');
 if(action==='recover'){await supa('/auth/v1/recover',{method:'POST',body:{email}});return privateJSON({message:'If this email has an account, a recovery email will be sent. Check your inbox and spam folder.'});}
 if(action==='verifyRecovery'){
  if(!/^\d{6,8}$/.test(body.code||''))throw new AppError('Enter the recovery code from your email.',400,'BAD_CODE');
  const s=await supa('/auth/v1/verify',{method:'POST',body:{email,token:body.code,type:'recovery'}});return withSession(privateJSON({configured:true,user:{id:s.user.id,email:s.user.email},recovery:true}),request,s);
 }
 if(typeof body.password!=='string'||body.password.length<(action==='signup'?12:1)||body.password.length>128)throw new AppError('Use a password of 12–128 characters for a new account.',400,'BAD_PASSWORD');
 if(action==='signup'&&body.ageConfirmed!==true)throw new AppError('This app is for adults 21 and older.',400,'AGE_CONFIRMATION_REQUIRED');
 const session=await supa(action==='login'?'/auth/v1/token?grant_type=password':'/auth/v1/signup',{method:'POST',body:{email,password:body.password}});
 if(!session?.access_token)return privateJSON({configured:true,user:null,message:'Check your email to confirm your address, then sign in. If you already have an account, use Sign in.'});
 return withSession(privateJSON({configured:true,user:{id:session.user.id,email:session.user.email}}),request,session);
 }catch(error){return handleError(error);}}
export const config={rateLimit:{action:'rate_limit',windowLimit:25,windowSize:60,aggregateBy:['domain','ip']}};

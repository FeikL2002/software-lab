import {AppError,handleError,sameOrigin,authorize} from '../../server/common.mjs';
import {accountConfig,limitedJSON,supa,verifiedUser,privateJSON} from '../../server/accounts.mjs';
import {socialRepository} from '../../server/social-repository.mjs';
import {validateBet,UUID_RE} from '../../public/lib/bets.mjs';
export function createMyBetsHandler({authenticate=verifiedUser,repository=socialRepository,useNetlify=()=>accountConfig()?.provider==='netlify'}={}){return async function(request){try{
 if(!['GET','POST','PATCH','DELETE'].includes(request.method))return privateJSON({error:'Method not allowed.',code:'METHOD_NOT_ALLOWED'},405);
 authorize(request);sameOrigin(request);const {user,token}=await authenticate(request);const url=new URL(request.url);
 if(request.method==='GET'){
  if([...url.searchParams.keys()].some(k=>k!=='offset')||url.searchParams.getAll('offset').length>1||!/^\d{1,6}$/.test(url.searchParams.get('offset')||'0'))throw new AppError('Invalid history page.',400,'BAD_QUERY');
  const offset=Number(url.searchParams.get('offset')||0);
  if(useNetlify())return privateJSON(await repository.listBets(user.id,offset));
  const rows=await supa(`/rest/v1/oddsscout_bets?user_id=eq.${encodeURIComponent(user.id)}&select=id,record,version&order=created_at.desc,id.desc&offset=${offset}&limit=100`,{token});
  if(!Array.isArray(rows))throw new AppError('Invalid history response.',502,'ACCOUNT_BAD_RESPONSE');
  return privateJSON({records:rows.map(r=>({...validateBet(r.record),_version:r.version})),nextOffset:rows.length===100?offset+100:null});
 }
 const body=await limitedJSON(request);if(!body||typeof body!=='object')throw new AppError('Invalid request.',400,'BAD_REQUEST');
 const id=body.id||body.record?.id;if(!UUID_RE.test(id||''))throw new AppError('Invalid record ID.',400,'BAD_ID');
 const query=`/rest/v1/oddsscout_bets?id=eq.${id}&user_id=eq.${encodeURIComponent(user.id)}`;
 if(request.method==='DELETE'){
  if(!Number.isInteger(body.version)||body.version<1)throw new AppError('Refresh this record before deleting it.',400,'BAD_VERSION');
  if(useNetlify()){await repository.deleteBet(user.id,id,body.version);return privateJSON({deleted:true,id});}
  const removed=await supa(query+`&version=eq.${body.version}`,{method:'DELETE',token,headers:{Prefer:'return=representation'}});
  if(!removed?.length)throw new AppError('The record changed or is no longer available. Refresh My Bets.',409,'RECORD_CONFLICT');return privateJSON({deleted:true,id});
 }
 let record;try{record=validateBet(body.record);}catch(e){throw new AppError(e.message,400,'INVALID_RECORD');}
 // Demo records intentionally never enter the real account ledger.
 if(body.id!==undefined&&body.id!==record.id)throw new AppError('The record ID does not match.',400,'BAD_ID');
 if(record.mode!=='real')throw new AppError('Fictional demo records stay in the local demo tracker.',400,'DEMO_NOT_CLOUD');
 if(request.method==='POST'){
  if(useNetlify())return privateJSON({record:await repository.createBet(user.id,record)},201);
  const rows=await supa('/rest/v1/oddsscout_bets',{method:'POST',token,body:{id:record.id,user_id:user.id,record},headers:{Prefer:'return=representation'}});
  return privateJSON({record:{...validateBet(rows[0].record),_version:rows[0].version}},201);
 }
 if(!Number.isInteger(body.version)||body.version<1)throw new AppError('Refresh before changing this record.',400,'BAD_VERSION');
 if(useNetlify())return privateJSON({record:await repository.updateBet(user.id,record,body.version)});
 const oldRows=await supa(query+'&select=record,version',{token});const old=oldRows?.[0];
 if(!old||old.version!==body.version)throw new AppError('This record changed on another device. Refresh My Bets before editing again.',409,'RECORD_CONFLICT');
 const previous=validateBet(old.record);
 if(['mode','savedAt','sourceKey','quotedDecimal'].some(k=>previous[k]!==record[k])||JSON.stringify(previous.legs)!==JSON.stringify(record.legs))throw new AppError('The original saved snapshot cannot be changed. Record accepted prices separately.',400,'SNAPSHOT_IMMUTABLE');
 const rows=await supa(query+`&version=eq.${body.version}`,{method:'PATCH',token,body:{record},headers:{Prefer:'return=representation'}});
 if(!rows?.length)throw new AppError('Another device changed this record. Refresh before retrying.',409,'RECORD_CONFLICT');
 return privateJSON({record:{...validateBet(rows[0].record),_version:rows[0].version}});
 }catch(error){return handleError(error);}};}
export default createMyBetsHandler();
export const config={rateLimit:{action:'rate_limit',windowLimit:120,windowSize:60,aggregateBy:['domain','ip']}};

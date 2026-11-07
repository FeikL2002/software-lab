import {AppError,authorize,handleError,sameOrigin} from '../../server/common.mjs';
import {limitedJSON,verifiedUser,privateJSON} from '../../server/accounts.mjs';
import {socialRepository,decodeChatCursor,validateChatBody} from '../../server/social-repository.mjs';
import {UUID_RE} from '../../public/lib/bets.mjs';
export function createChatHandler({authenticate=verifiedUser,repository=socialRepository}={}){return async function(request){try{
 if(!['GET','POST','DELETE'].includes(request.method))return privateJSON({error:'Method not allowed.',code:'METHOD_NOT_ALLOWED'},405);
 authorize(request);sameOrigin(request);const {user}=await authenticate(request),url=new URL(request.url);
 if(request.method==='GET'){
  if([...url.searchParams.keys()].some(k=>k!=='before')||url.searchParams.getAll('before').length>1)throw new AppError('Unsupported chat query.',400,'BAD_QUERY');
  const page=await repository.messages(user.id,decodeChatCursor(url.searchParams.get('before')));
  return privateJSON({...page,source:'Member messages',fetchedAt:new Date().toISOString()});
 }
 if(url.search)throw new AppError('Unsupported chat query.',400,'BAD_QUERY');
 const body=await limitedJSON(request,6000);
 if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError('Invalid chat request.',400,'BAD_REQUEST');
 if(request.method==='DELETE'){
  if(!UUID_RE.test(body.id||''))throw new AppError('Choose a valid message.',400,'BAD_ID');
  await repository.deleteMessage(user.id,body.id);return privateJSON({deleted:true,id:body.id});
 }
 if(body.action==='report'){
  if(!UUID_RE.test(body.id||''))throw new AppError('Choose a valid message.',400,'BAD_ID');
  const reason=typeof body.reason==='string'?body.reason.trim():'Community concern';
  if(!reason||reason.length>300||/[\u0000-\u001f]/.test(reason))throw new AppError('Use a short plain-text reason of at most 300 characters.',400,'BAD_REPORT');
  await repository.reportMessage(user.id,body.id,reason);return privateJSON({reported:true,message:'Your report was saved for review.'},201);
 }
 if(body.action!==undefined)throw new AppError('Unsupported chat action.',400,'BAD_ACTION');
 const message=await repository.createMessage(user.id,validateChatBody(body.body));return privateJSON({message},201);
 }catch(error){return handleError(error);}};}
export default createChatHandler();
export const config={rateLimit:{action:'rate_limit',windowLimit:120,windowSize:60,aggregateBy:['domain','ip']}};

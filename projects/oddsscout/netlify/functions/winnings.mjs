import {AppError,authorize,handleError,sameOrigin} from '../../server/common.mjs';
import {limitedJSON,verifiedUser,privateJSON} from '../../server/accounts.mjs';
import {socialRepository,validateDisplayName} from '../../server/social-repository.mjs';
export function createWinningsHandler({authenticate=verifiedUser,repository=socialRepository}={}){return async function(request){try{
 if(!['GET','POST'].includes(request.method))return privateJSON({error:'Method not allowed.',code:'METHOD_NOT_ALLOWED'},405);
 authorize(request);sameOrigin(request);if(new URL(request.url).search)throw new AppError('Unsupported winnings query.',400,'BAD_QUERY');
 const {user}=await authenticate(request);
 if(request.method==='GET')return privateJSON({...await repository.winnings(user.id),selfReported:true,currency:'USD',fetchedAt:new Date().toISOString(),note:'Members manually record results. These totals are unverified and do not establish that OddsScout caused a profit. Pending and saved ideas are excluded from settled returns and net profit.'});
 const body=await limitedJSON(request,1500);if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError('Invalid profile request.',400,'BAD_REQUEST');
 const displayName=validateDisplayName(body.displayName);if(typeof body.winningsPublic!=='boolean')throw new AppError('Choose whether to share your self-reported totals.',400,'BAD_PRIVACY_SETTING');
 const profile=await repository.updateProfile(user.id,{displayName,winningsPublic:body.winningsPublic});return privateJSON({profile});
 }catch(error){return handleError(error);}};}
export default createWinningsHandler();
export const config={rateLimit:{action:'rate_limit',windowLimit:80,windowSize:60,aggregateBy:['domain','ip']}};

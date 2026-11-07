import {authorize,json,handleError,readEventScope,cacheTTL} from '../../server/common.mjs';
import {loadEventDetails} from '../../server/provider.mjs';
export default async function(request) {
 if(request.method!=='GET')return json({error:'Method not allowed.',code:'METHOD_NOT_ALLOWED'},405);
 try {
  authorize(request);
  const {league,eventId,markets}=readEventScope(new URL(request.url));
  const result=await loadEventDetails(league,eventId,markets);
  return json(result,200,cacheTTL(result.fetchedAt,result.refreshSeconds||3600));
 }catch(error){return handleError(error);}
}
export const config={rateLimit:{action:'rate_limit',windowLimit:40,windowSize:60,aggregateBy:['domain','ip']}};

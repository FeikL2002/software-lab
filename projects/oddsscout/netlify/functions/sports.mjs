import {authorize,json,handleError,cacheTTL} from '../../server/common.mjs';
import {loadSports} from '../../server/provider.mjs';
export default async function(request) {
 if(request.method!=='GET')return json({error:'Method not allowed.'},405);
 try {authorize(request);const result=await loadSports();return json(result,200,cacheTTL(result.fetchedAt,3600));}catch(e){return handleError(e);}
}
export const config={rateLimit:{action:'rate_limit',windowLimit:30,windowSize:60,aggregateBy:['domain','ip']}};

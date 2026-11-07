import {authorize,sameOrigin,json,handleError,readJsonBody} from '../../server/common.mjs';
import {validateScoutRequest,answerScout} from '../../server/scout.mjs';
export default async function(request) {
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 try {
  authorize(request);sameOrigin(request);const body=await readJsonBody(request);
  return json(await answerScout(validateScoutRequest(body)));
 }catch(e){return handleError(e);}
}
export const config={rateLimit:{action:'rate_limit',windowLimit:6,windowSize:60,aggregateBy:['domain','ip']}};

import {authorize,json,handleError,cacheTTL} from '../../server/common.mjs';
import {readPerformanceScope,loadPlayerPerformance} from '../../server/performance-provider.mjs';
export default async function(request){
 if(request.method!=='GET')return json({error:'Method not allowed.'},405);
 try{
  authorize(request);const scope=readPerformanceScope(new URL(request.url));
  const result=await loadPlayerPerformance(scope),response=json(result,200,cacheTTL(result.fetchedAt,900));
  if(response.headers.has('Netlify-Vary'))response.headers.set('Netlify-Vary','query=league|playerId|player|statType|window|line|provider');
  return response;
 }catch(error){return handleError(error);}
}
export const config={rateLimit:{action:'rate_limit',windowLimit:8,windowSize:60,aggregateBy:['domain','ip']}};

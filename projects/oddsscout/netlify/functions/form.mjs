import {authorize,json,handleError,AppError,cacheTTL} from '../../server/common.mjs';
import {loadRecentForm} from '../../server/form-provider.mjs';
export default async function(request){
 if(request.method!=='GET')return json({error:'Method not allowed.'},405);
 try{
  authorize(request);const url=new URL(request.url);
  for(const key of url.searchParams.keys())if(!['league','team','opponent'].includes(key)||url.searchParams.getAll(key).length!==1)throw new AppError('Unsupported recent-results query.',400,'BAD_QUERY');
  const league=url.searchParams.get('league'),team=url.searchParams.get('team'),opponent=url.searchParams.get('opponent');
  if(!league||!team||!opponent||team===opponent||[team,opponent].some(s=>s.length>100||/[\u0000-\u001f|<>]/.test(s)))throw new AppError('Select two distinct teams on the board.',400,'BAD_QUERY');
  const form=await loadRecentForm(league,[team,opponent]);const response=json(form,200,cacheTTL(form.fetchedAt,900));
  if(response.headers.has('Netlify-Vary'))response.headers.set('Netlify-Vary','query=league|team|opponent');
  return response;
 }catch(error){return handleError(error);}
}
export const config={rateLimit:{action:'rate_limit',windowLimit:12,windowSize:60,aggregateBy:['domain','ip']}};

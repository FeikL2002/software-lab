import {authorize,json,handleError,cacheTTL} from '../../server/common.mjs';
import {loadCalendar,readCalendarScope,CALENDAR_REFRESH_SECONDS} from '../../server/calendar.mjs';

export default async function(request) {
  if(request.method!=='GET')return json({error:'Method not allowed.'},405);
  try {
    authorize(request);
    const {league,page}=readCalendarScope(new URL(request.url)),calendar=await loadCalendar(league,page);
    const response=json(calendar,200,calendar.batch?.failed.length?0:cacheTTL(calendar.fetchedAt,CALENDAR_REFRESH_SECONDS));
    if(response.headers.has('Netlify-CDN-Cache-Control'))response.headers.set('Netlify-Vary','query=league|page');
    return response;
  }catch(error){return handleError(error);}
}
export const config={rateLimit:{action:'rate_limit',windowLimit:60,windowSize:60,aggregateBy:['domain','ip']}};

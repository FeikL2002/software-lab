import {authorize,json,handleError,readScope,cacheTTL} from '../../server/common.mjs';
import {loadBoard,loadAllBoardPage} from '../../server/provider.mjs';
export default async function(request) {
 if(request.method!=='GET')return json({error:'Method not allowed.'},405);
 try {authorize(request);const {league,market,page}=readScope(new URL(request.url));const board=await (league==='all'?loadAllBoardPage(market,page):loadBoard(league,market));return json(board,200,board.batch?.halted?0:cacheTTL(board.fetchedAt,board.refreshSeconds||60));}catch(e){return handleError(e);}
}
export const config={rateLimit:{action:'rate_limit',windowLimit:60,windowSize:60,aggregateBy:['domain','ip']}};

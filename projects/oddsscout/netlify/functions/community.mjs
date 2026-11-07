import {socialRepository} from '../../server/social-repository.mjs';
import {createHash} from 'node:crypto';
import {AppError,authorize,handleError,sameOrigin} from '../../server/common.mjs';
import {accountConfig,limitedJSON,supa,verifiedUser,privateJSON} from '../../server/accounts.mjs';
import {loadBoard,loadEventDetails} from '../../server/provider.mjs';
import {compareGroups,groupLabel} from '../../public/lib/odds.mjs';
export function createCommunityHandler({authenticate=verifiedUser,repository=socialRepository,useNetlify=()=>accountConfig()?.provider==='netlify',board=loadBoard,eventDetails=loadEventDetails}={}){return async function(request){try{
 if(!['GET','POST','DELETE'].includes(request.method))return privateJSON({error:'Method not allowed.',code:'METHOD_NOT_ALLOWED'},405);
 authorize(request);sameOrigin(request);
 if(!useNetlify()&&!accountConfig())throw new AppError('Community activity is unavailable until private accounts and the community migration are configured. Private browser saves still work.',503,'COMMUNITY_NOT_CONFIGURED');
 if(request.method==='GET'){
  if(new URL(request.url).search)throw new AppError('Unsupported community query.',400,'BAD_QUERY');
  const trending=useNetlify()?await repository.trending():await supa('/rest/v1/rpc/oddsscout_trending',{method:'POST',body:{}});
  if(!Array.isArray(trending))throw new AppError('Community data is temporarily unavailable.',502,'COMMUNITY_BAD_RESPONSE');
  return privateJSON({trending,source:'Recorded community likes',modelInput:false,fetchedAt:new Date().toISOString()});
 }
 const {user,token}=await authenticate(request);const body=await limitedJSON(request,5000);
 if(!body||!/^\w[\w-]{0,149}$/.test(body.eventId||'')||!/^[a-z][a-z0-9_]{0,90}$/.test(body.league||'')||!/^[a-z][a-z0-9_]{0,90}$/.test(body.market||'')||typeof body.groupId!=='string'||body.groupId.length>1500)throw new AppError('Choose a valid current selection.',400,'BAD_SELECTION');
 const hash=createHash('sha256').update(JSON.stringify([body.eventId,body.groupId])).digest('hex');
 if(request.method==='DELETE'){if(useNetlify()){await repository.unlike(user.id,hash);return privateJSON({liked:false});}await supa(`/rest/v1/oddsscout_likes?selection_hash=eq.${hash}&user_id=eq.${encodeURIComponent(user.id)}`,{method:'DELETE',token});return privateJSON({liked:false});}
 // Keep popularity independent of private bet records and all model calculations.
 const result=['h2h','spreads','totals','outrights'].includes(body.market)?await board(body.league,body.market):await eventDetails(body.league,body.eventId,[body.market]);
 const event=result.event||result.events.find(e=>e.id===body.eventId),group=event&&compareGroups(event,body.market).find(g=>g.id===body.groupId);
 if(!group?.best)throw new AppError('This exact selection no longer has a fresh quote. Refresh first.',409,'SELECTION_UNAVAILABLE');
 if(useNetlify()){await repository.like(user.id,{hash,eventId:body.eventId,title:groupLabel(group)+' · '+(event.kind==='future'?(event.title||event.sport_title):event.away_team+' at '+event.home_team)});return privateJSON({liked:true,popularityOnly:true});}
 await supa('/rest/v1/oddsscout_likes?on_conflict=selection_hash,user_id',{method:'POST',token,body:{selection_hash:hash,user_id:user.id,event_id:body.eventId,title:groupLabel(group)+' · '+(event.kind==='future'?(event.title||event.sport_title):event.away_team+' at '+event.home_team)},headers:{Prefer:'resolution=ignore-duplicates,return=minimal'}});
 return privateJSON({liked:true,popularityOnly:true});
 }catch(e){return handleError(e);}};}
export default createCommunityHandler();
export const config={rateLimit:{action:'rate_limit',windowLimit:30,windowSize:60,aggregateBy:['domain','ip']}};

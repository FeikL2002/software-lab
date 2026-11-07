/** Small live acceptance probe. Never prints keys or provider URLs. */
import {compareGroups,eventStatus} from '../public/lib/odds.mjs';
const origin=process.argv[2];
if(!origin)throw new Error('Usage: npm run verify:live -- https://example.invalid');
const base=new URL(origin);
if(base.username||base.password||base.search||base.hash||base.pathname!=='/')throw new Error('Supply the preview origin only.');
if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw new Error('Use HTTPS for a hosted preview.');
const headers=process.env.ACCESS_CODE?{'X-Room-Code':process.env.ACCESS_CODE}:{};
async function read(path){
 const response=await fetch(new URL(path,base),{headers,signal:AbortSignal.timeout(35000)});
 if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Preview API did not return JSON: '+path.split('?')[0]);
 const body=await response.json();
 if(!response.ok)throw new Error(`${path.split('?')[0]}: HTTP ${response.status}, ${/^[A-Z_]+$/.test(body.code||'')?body.code:'unavailable'}`);
 return body;
}
const config=await read('/api/config');
if(!config.oddsConfigured)throw new Error('ODDS_API_KEY is not available to preview Functions. No live connection is claimed.');
const catalog=await read('/api/sports');
if(catalog.mode!=='live'||!Array.isArray(catalog.sports))throw new Error('Invalid live catalog response.');
const preferred=['americanfootball_nfl','basketball_nba','icehockey_nhl','baseball_mlb'];
const leagues=[...preferred.filter(key=>catalog.sports.some(s=>s.key===key)),...catalog.sports.map(s=>s.key).filter(key=>!preferred.includes(key))].slice(0,4);
const checks=[],books=new Set();let sample=null,freshCount=0,liveGames=0;
for(const league of leagues){
 const board=await read('/api/board?'+new URLSearchParams({league,market:'h2h'}));
 if(board.mode!=='live'||board.source!=='The Odds API'||!Array.isArray(board.events))throw new Error('Preview returned a substitute feed.');
 if(new Set(board.events.map(e=>e.id)).size!==board.events.length)throw new Error('Duplicate games were returned.');
 const quotes=board.events.flatMap(event=>compareGroups(event,'h2h').flatMap(group=>group.freshQuotes));
 for(const q of quotes)books.add(q.book);
 freshCount+=quotes.length;liveGames+=board.events.filter(e=>eventStatus(e)==='live').length;
 checks.push({league,events:board.events.length,freshQuotes:quotes.length,returnedBooks:board.returnedBookKeys||[],warnings:board.warnings||[],fetchedAt:board.fetchedAt});
 sample ||= board.events.find(e=>compareGroups(e,'h2h').some(g=>g.best));
 if(sample&&books.size>=2)break;
}
if(!sample||!freshCount)throw new Error('Provider routes responded, but no fresh real quote was available in the bounded probe. Do not claim live odds acceptance passed.');
const detail=await read('/api/event?'+new URLSearchParams({league:sample.sport_key,eventId:sample.id,markets:'h2h,spreads,totals'}));
if(detail.mode!=='live'||detail.source!=='The Odds API'||detail.event?.id!==sample.id)throw new Error('Invalid event details.');
const report={verifiedAt:new Date().toISOString(),preview:base.origin,provider:'The Odds API',checks,freshQuoteCount:freshCount,actualFreshBooks:[...books].sort(),confirmedInPlayGames:liveGames,multipleBooksVerified:books.size>=2,eventDetailsVerified:true,availableMarkets:detail.availableMarkets||[],limits:['This is a bounded sample, not verification of every league or bookmaker.','A confirmed in-play count of zero means no fresh live status was observed in this sample. Real upcoming prices can still be verified.']};
console.log(JSON.stringify(report,null,2));

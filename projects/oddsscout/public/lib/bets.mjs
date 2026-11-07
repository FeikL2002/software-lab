/** A private, self-reported cash-bet ledger. Saves are never wagers or earnings. */
import {compareGroups,eventStatus,groupLabel,americanToDecimal} from './odds.mjs';
import {getSportsbook} from './sportsbooks.mjs';
const key = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value);
export const BET_STATUSES=['saved','open','won','lost','push','void','cashout'];
export const SETTLED_STATUSES=['won','lost','push','void','cashout'];
export const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text=(v,max=300)=>typeof v==='string'&&v.length<=max?v:null;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const amount=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100000000&&Math.abs(v*100-Math.round(v*100))<0.00001;
export const cents=v=>Math.round(v*100);
export const roundCash=v=>Math.round((v+Number.EPSILON)*100)/100;
export function parseCash(value,{positive=false,max=100000}={}){
 const s=String(value).trim();if(!/^\d{1,9}(\.\d{1,2})?$/.test(s))throw new Error('Enter a cash amount with no more than two decimal places.');
 const n=Number(s);if(!Number.isFinite(n)||n>max||(positive?n<=0:n<0))throw new Error(`Enter ${positive?'a positive':'a non-negative'} cash amount, at most $${max.toLocaleString()}.`);return roundCash(n);
}
export function parseAcceptedOdds(value,format='american'){
 const s=String(value).trim();if(!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(s))throw new Error('Enter the odds actually accepted by the sportsbook.');
 const n=Number(s),d=format==='american'?americanToDecimal(n):n;
 if(format==='american'&&!Number.isInteger(n))throw new Error('American odds must be a whole number, such as +150 or -110.');
 if(!Number.isFinite(d)||d<=1||d>10000)throw new Error('Use valid American odds (at least +100 or -100), or decimal odds greater than 1 and at most 10,000.');return d;
}
export function pickKey(legs){return JSON.stringify(legs.map(l=>[l.eventId,l.groupId]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));}
export function snapshotLeg(event,group,quote,now=Date.now()){
 const phase=eventStatus(event,now);
 if(!['live','upcoming'].includes(phase)||!quote?.fresh)throw new Error('Only fresh quotes with confirmed upcoming or live status can be saved. Refresh first.');
 return {eventId:event.id,league:event.sport_key,leagueTitle:event.sport_title||event.sport_key,matchup:event.kind==='future'?(event.title||event.sport_title):`${event.away_team} at ${event.home_team}`,selection:group.name,label:groupLabel(group),market:group.market,point:group.point ?? null,groupId:group.id,scope:group.scope || group.market,commenceTime:event.commence_time,phase,score:phase==='live'?(event.scores||[]).map(s=>`${s.name}: ${s.score}`).join(' · '):'',scoreUpdatedAt:phase==='live'?event.scoreUpdatedAt:null,book:quote.book,bookTitle:quote.title,decimal:quote.price,quoteAt:quote.updatedAt};
}
export function singleSnapshot(event,groupId,market,bookKeys=null,book=null,now=Date.now()){
 const g=compareGroups(event,market,{bookKeys,now}).find(g=>g.id===groupId),q=book?g?.freshQuotes.find(q=>q.book===book):g?.best;
 if(!g||!q)throw new Error('This price is no longer fresh or available, or the game status cannot be confirmed. Refresh the board.');return snapshotLeg(event,g,q,now);
}
export function betUUID(){
 if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
 if(!globalThis.crypto?.getRandomValues)throw new Error('This browser cannot generate a secure record ID. Use a current browser over HTTPS.');
 const a=new Uint8Array(16);globalThis.crypto.getRandomValues(a);a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;
 const h=[...a].map(b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function makeSavedBet(legs,{demo=false,now=Date.now(),id=betUUID()}={}){
 if(!Array.isArray(legs)||!legs.length||legs.length>4)throw new Error('Save one selection or a two-to-four-leg research ticket.');
 if(legs.length>1&&(new Set(legs.map(l=>l.eventId)).size!==legs.length||legs.some(l=>l.phase==='live')||new Set(legs.map(l=>l.book)).size!==1))throw new Error('Research parlays require different upcoming games and quotes from one common sportsbook.');
 const t=new Date(now).toISOString();const record={id,schema:1,mode:demo?'demo':'real',status:'saved',savedAt:t,updatedAt:t,sourceKey:pickKey(legs),legs:structuredClone(legs),quotedDecimal:legs.reduce((a,l)=>a*l.decimal,1),book:legs[0].book,bookTitle:legs[0].bookTitle,stake:null,acceptedDecimal:null,placedAt:null,placedPhase:null,settledAt:null,returnAmount:null,notes:''};return validateBet(record);
}
export function validateBet(input){
 if(!input||typeof input!=='object'||!UUID_RE.test(input.id||'')||input.schema!==1||!['demo','real'].includes(input.mode)||!BET_STATUSES.includes(input.status))throw new Error('Invalid bet record.');
 if(!iso(input.savedAt)||!iso(input.updatedAt)||!Array.isArray(input.legs)||input.legs.length<1||input.legs.length>4)throw new Error('Invalid saved snapshot.');
 const legs=input.legs.map(l=>{
  if(!l||text(l.eventId,150)===null||!l.eventId||text(l.league,100)===null||text(l.leagueTitle,100)===null||text(l.matchup)===null||text(l.selection,200)===null||text(l.label,350)===null||text(l.groupId,1500)===null||text(l.scope,150)===null||!key(l.market)||!key(l.book)||text(l.bookTitle,100)===null||!Number.isFinite(l.decimal)||l.decimal<=1||l.decimal>10000||!iso(l.commenceTime)||!iso(l.quoteAt)||!['live','upcoming'].includes(l.phase)||text(l.score,500)===null||(l.scoreUpdatedAt!==null&&!iso(l.scoreUpdatedAt))||(l.point!==null&&!Number.isFinite(l.point)))throw new Error('Invalid selection in saved snapshot.');
  return Object.fromEntries(['eventId','league','leagueTitle','matchup','selection','label','market','point','groupId','scope','commenceTime','phase','score','scoreUpdatedAt','book','bookTitle','decimal','quoteAt'].map(k=>[k,l[k]]));
 });
 if(input.sourceKey!==pickKey(legs)||!key(input.book)||text(input.bookTitle,100)===null||text(input.notes,600)===null||!Number.isFinite(input.quotedDecimal)||input.quotedDecimal<=1||input.quotedDecimal>1e16)throw new Error('Invalid tracker metadata.');
 const result={id:input.id,schema:1,mode:input.mode,status:input.status,savedAt:input.savedAt,updatedAt:input.updatedAt,sourceKey:input.sourceKey,legs,quotedDecimal:input.quotedDecimal,book:input.book,bookTitle:input.bookTitle,stake:input.stake,acceptedDecimal:input.acceptedDecimal,placedAt:input.placedAt,placedPhase:input.placedPhase,settledAt:input.settledAt,returnAmount:input.returnAmount,notes:input.notes};
 if(result.status==='saved'){
  if(['stake','acceptedDecimal','placedAt','placedPhase','settledAt','returnAmount'].some(k=>result[k]!==null))throw new Error('A saved idea cannot have wager amounts or winnings.');
 }else{
  if(!amount(result.stake)||result.stake<=0||result.stake>100000||!Number.isFinite(result.acceptedDecimal)||result.acceptedDecimal<=1||result.acceptedDecimal>10000||!iso(result.placedAt)||!['live','upcoming'].includes(result.placedPhase))throw new Error('Record the accepted stake, odds, time, and phase first.');
  if(result.status==='open'){if(result.returnAmount!==null||result.settledAt!==null)throw new Error('An open bet cannot have a settled return.');}
  else{
   if(!amount(result.returnAmount)||!iso(result.settledAt))throw new Error('Enter the total cash actually returned, including any returned stake.');
   if(Date.parse(result.settledAt)<Date.parse(result.placedAt))throw new Error('Settlement cannot be before placement.');
   if(result.status==='lost'&&result.returnAmount!==0)throw new Error('A loss has zero returned cash.');
   if(['push','void'].includes(result.status)&&cents(result.returnAmount)!==cents(result.stake))throw new Error('A full push or void returns the original cash stake. Use cashout / adjusted for partial settlements.');
   if(result.status==='won'&&result.returnAmount<result.stake)throw new Error('For a return below the stake, choose cashout / adjusted instead of won.');
  }
 }
 if(JSON.stringify(result).length>18000)throw new Error('This record is too large.');return result;
}
export function recordPlacement(record,{stake,decimal,book,placedAt,phase,notes='',confirmed=false},now=Date.now()){
 const b=validateBet(record);if(b.status!=='saved'&&b.status!=='open')throw new Error('Reopen this record before correcting placement.');
 if(!confirmed)throw new Error('Confirm that you already placed this bet outside OddsScout (or are simulating it in demo).');
 if(!iso(placedAt)||Date.parse(placedAt)>now+60000)throw new Error('Placement time cannot be in the future.');
 return validateBet({...b,status:'open',stake,acceptedDecimal:decimal,book,bookTitle:getSportsbook(book,book===b.book?b.bookTitle:book).name,placedAt,placedPhase:phase,notes,returnAmount:null,settledAt:null,updatedAt:new Date(now).toISOString()});
}
export function recordSettlement(record,status,totalReturn,{confirmed=false,now=Date.now()}={}){
 const b=validateBet(record);if(b.status==='saved')throw new Error('Record placement before recording a result.');
 if(!confirmed)throw new Error('Confirm the result and returned amount from your sportsbook.');
 if(status==='open')return validateBet({...b,status,returnAmount:null,settledAt:null,updatedAt:new Date(now).toISOString()});
 if(!SETTLED_STATUSES.includes(status))throw new Error('Choose a supported settlement.');
 const returned=status==='lost'?0:['push','void'].includes(status)?b.stake:totalReturn;
 return validateBet({...b,status,returnAmount:returned,settledAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()});
}
export function betNet(b){return SETTLED_STATUSES.includes(b.status)?(cents(b.returnAmount)-cents(b.stake))/100:null;}
export function ledgerSummary(records,mode='real'){
 const rows=records.filter(b=>b.mode===mode),settled=rows.filter(b=>SETTLED_STATUSES.includes(b.status));
 const sum=(items,key)=>items.reduce((s,b)=>s+cents(b[key]),0)/100;
 const stake=sum(settled,'stake'),returned=sum(settled,'returnAmount');
 return {saved:rows.filter(b=>b.status==='saved').length,open:rows.filter(b=>b.status==='open').length,settled:settled.length,won:settled.filter(b=>b.status==='won').length,lost:settled.filter(b=>b.status==='lost').length,settledStake:stake,totalReturned:returned,net:roundCash(returned-stake),openStake:sum(rows.filter(b=>b.status==='open'),'stake'),winningProfit:sum(settled.filter(b=>b.status==='won'),'returnAmount')-sum(settled.filter(b=>b.status==='won'),'stake'),roi:stake>0?(returned-stake)/stake*100:null};
}
export function ledgerCSV(records){
 const cell=v=>{if(typeof v==='number'&&Number.isFinite(v))return String(v);let s=String(v??'');if(/^[\s]*[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const rows=[['id','mode','status','saved_at','placed_at','phase_when_placed','selections','sportsbook','original_quote_decimal','accepted_decimal','cash_stake','total_returned_including_stake','net_profit','settled_at','notes','verification'],...records.map(b=>[b.id,b.mode,b.status,b.savedAt,b.placedAt,b.placedPhase,b.legs.map(l=>l.label).join(' | '),b.bookTitle,b.quotedDecimal,b.acceptedDecimal,b.stake,b.returnAmount,betNet(b),b.settledAt,b.notes,'self_reported_not_verified'])];return rows.map(r=>r.map(cell).join(',')).join('\r\n');
}

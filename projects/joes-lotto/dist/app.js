
'use strict';
// Joe's Lotto App. Existing v1 records and backup schema are preserved.
// Ticket data stays on this device; scanner processing is local.
const KEY='american-sites-lottery-desk-v1';
const $=id=>document.getElementById(id);
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(t=>p.find(x=>x.type===t).value).join('-');};
const uid=()=>crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint32Array(4))).map(x=>x.toString(16)).join('-');
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const defaults=()=>({version:1,settings:{monthlyLimit:null,paused:false},tickets:[],stores:[],scratch:[],favorites:[],deliveryNotes:[],scanGameMatches:[],ticketScans:[]});
const cents=v=>{if(!/^\d+(\.\d{1,2})?$/.test(String(v)))throw Error('Enter a non-negative dollar amount, with at most two decimals.');const n=Math.round(Number(v)*100);if(!Number.isSafeInteger(n)||n>100000000000)throw Error('That amount is too large.');return n;};
function dateOK(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+'T12:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===v;}
function short(v,max=500){if(typeof v!=='string'||v.length>max)throw Error('Invalid or oversized text in backup.');return v;}
function amountOK(v){if(!Number.isSafeInteger(v)||v<0||v>100000000000)throw Error('Invalid amount in backup.');return v;}
function validQuantity(v){if(!Number.isSafeInteger(v)||v<1||v>100000)throw Error('Enter a whole ticket count between 1 and 100000.');return v;}
function validFingerprint(v){if(typeof v!=='string'||!(/^[a-f0-9]{64}$/.test(v)))throw Error('Invalid scanned-ticket reference.');return v;}
function officialURL(v){if(!v)return '';const u=new URL(v);if(u.protocol!=='https:'||!['ohiolottery.com','www.ohiolottery.com'].includes(u.hostname)||u.username||u.password)throw Error('Use an https://ohiolottery.com or https://www.ohiolottery.com source link.');return u.href;}
const statusNames={pending:'Not checked',loss:'No prize · recorded',unclaimed:'Win · recorded',collected:'Cash collected'};
const games={
 'Pick 3':{digits:3,url:'https://www.ohiolottery.com/games/draw-games/pick-3'},
 'Pick 4':{digits:4,url:'https://www.ohiolottery.com/games/draw-games/pick-4'},
 'Pick 5':{digits:5,url:'https://www.ohiolottery.com/games/draw-games/pick-5'},
 'Powerball':{max:69,bonus:26,bonusName:'Powerball',url:'https://www.powerball.com/faqs'},
 'Mega Millions':{max:70,bonus:24,bonusName:'Mega Ball',url:'https://www.megamillions.com/FAQs.aspx'}
};
function parseNumbers(game,text){const g=games[game];if(!g)throw Error('Choose a supported number game.');if(g.digits){const s=text.trim().replace(/[\s,-]/g,'');if(!new RegExp('^\\d{'+g.digits+'}$').test(s))throw Error(`Enter exactly ${g.digits} digits (0–9).`);return {game,nums:s.split('').map(Number),bonus:null};}const parts=text.trim().split(/[\s,+-]+/).filter(Boolean);if(parts.length!==6||parts.some(x=>!/^\d{1,2}$/.test(x)))throw Error('Enter five main numbers, then one bonus number last.');const n=parts.map(Number),b=n.pop();if(n.some(x=>x<1||x>g.max)||new Set(n).size!==5||b<1||b>g.bonus)throw Error(`Use five different main numbers from 1–${g.max}, then a ${g.bonusName} from 1–${g.bonus}.`);return{game,nums:n.sort((a,b)=>a-b),bonus:b};}
function numberText(f){return games[f.game].digits?f.nums.join(''):f.nums.join(' ')+' + '+f.bonus;}
function validate(raw){if(!raw||raw.version!==1||!raw.settings)throw Error('This is not a supported Lottery Desk backup.');const d=defaults();d.settings.monthlyLimit=raw.settings.monthlyLimit===null?null:amountOK(raw.settings.monthlyLimit);if(typeof raw.settings.paused!=='boolean')throw Error('Invalid pause setting.');d.settings.paused=raw.settings.paused;for(const k of ['tickets','stores','scratch','favorites']){if(!Array.isArray(raw[k])||raw[k].length>20000)throw Error('Invalid record list.');const seen=new Set();d[k]=raw[k].map(x=>{if(!x||typeof x!=='object')throw Error('Invalid record.');const id=short(x.id,100);if(!id||seen.has(id))throw Error('Duplicate or missing record ID.');seen.add(id);if(k==='tickets'){if(!dateOK(x.date)||!Object.hasOwn(statusNames,x.status)||x.deadline&&!dateOK(x.deadline))throw Error('Invalid ticket date or status.');const amount=amountOK(x.amount),cost=amountOK(x.cost);if(['pending','loss'].includes(x.status)&&amount!==0)throw Error('Unchecked/losing ticket cannot contain a return.');if(['unclaimed','collected'].includes(x.status)&&amount===0)throw Error('Winning ticket needs a positive amount.');if(x.pricePending!==undefined&&typeof x.pricePending!=='boolean')throw Error('Invalid missing-price flag.');if(x.pricePending&&cost!==0)throw Error('A ticket needing its price cannot contain spending.');return{id,...(x.pricePending?{pricePending:true}:{}),date:x.date,game:short(x.game,80),detail:short(x.detail,160),store:short(x.store,120),cost,status:x.status,amount,deadline:x.deadline||'',notes:short(x.notes,500),...(x.quantity!==undefined?{quantity:validQuantity(x.quantity)}:{}),...(x.catalogGameNumber?{catalogGameNumber:short(String(x.catalogGameNumber),20)}:{}),...(x.scanFingerprint?{scanFingerprint:validFingerprint(x.scanFingerprint),barcodeFormat:short(x.barcodeFormat||'Barcode',40)}:{})};}if(k==='stores'){if(x.checked&&!dateOK(x.checked))throw Error('Invalid store date.');return{id,name:short(x.name,120),town:short(x.town,160),notes:short(x.notes,500),checked:x.checked||''};}if(k==='scratch'){if(!dateOK(x.checked)||x.odds!==null&&(!Number.isFinite(x.odds)||x.odds<1||x.odds>1e9)||x.remaining!==null&&(!Number.isSafeInteger(x.remaining)||x.remaining<0||x.remaining>1e9))throw Error('Invalid game comparison.');const price=amountOK(x.price);if(price<=0)throw Error('Ticket price must be positive.');return{id,name:short(x.name,140),price,odds:x.odds,remaining:x.remaining,checked:x.checked,url:officialURL(short(x.url,500))};}if(!games[x.game]||!Array.isArray(x.nums)||x.nums.some(n=>!Number.isInteger(n)||n<0||n>70))throw Error('Invalid saved numbers.');const f=parseNumbers(x.game,games[x.game].digits?x.nums.join(''):x.nums.join(' ')+' '+x.bonus);return{id,...f};});}if(raw.deliveryNotes!==undefined){if(!Array.isArray(raw.deliveryNotes)||raw.deliveryNotes.length>10000)throw Error('Invalid restock notes.');const seen=new Set();d.deliveryNotes=raw.deliveryNotes.map(n=>{if(!n||!dateTimeOK(n.when)||!['observed','confirmed'].includes(n.kind)||!dateOK(n.recordedAt))throw Error('Invalid restock note.');const id=short(n.id,100);if(!id||seen.has(id))throw Error('Duplicate restock note.');seen.add(id);return{id,store:short(n.store,120),kind:n.kind,when:n.when,source:short(n.source,240),recordedAt:n.recordedAt};});}if(raw.scanGameMatches!==undefined){
  if(!Array.isArray(raw.scanGameMatches)||raw.scanGameMatches.length>1000)throw Error('Invalid remembered-game list.');
  const remembered=new Set();d.scanGameMatches=raw.scanGameMatches.map(m=>{
    if(!m||!/^\d{1,4}$/.test(String(m.gameNumber))||Number(m.gameNumber)<1||!dateOK(m.confirmedAt))throw Error('Invalid remembered game.');
    const fingerprint=validFingerprint(m.fingerprint);if(remembered.has(fingerprint))throw Error('Duplicate remembered game.');remembered.add(fingerprint);
    return {fingerprint,gameNumber:String(Number(m.gameNumber)),confirmedAt:m.confirmedAt};
  });
}
if(raw.settings.resultsNotifications!==undefined&&typeof raw.settings.resultsNotifications!=='boolean')throw Error('Invalid result notification setting.');d.settings.resultsNotifications=!!raw.settings.resultsNotifications;
if(raw.ticketScans!==undefined){if(!window.JoeTicketDesk)throw Error('Ticket detail reader is unavailable.');d.ticketScans=window.JoeTicketDesk.validateDetails(raw.ticketScans,d.tickets.map(t=>t.id));}
return d;}
let state=defaults(),loadFailed=false,generated=null,toastTimer,ticketScan=null,lastScannedId=null,lastScanContext=null,picking=false,generationEpoch=0;
try{const s=localStorage.getItem(KEY);if(s)state=validate(JSON.parse(s));}catch(err){loadFailed=true;$('storageWarning').innerHTML='<div class="notice">Browser storage could not be read. No existing data was overwritten. Restore a known-good backup, or export your existing browser data before starting over. New edits will ask before replacing it.</div>';}
function toast(t){$('toast').textContent=t;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
function persist(){try{if(loadFailed&&!confirm('Replace the unreadable local data with the current records? Cancel keeps the unreadable original untouched.')){toast('Current changes are in memory only. Export a backup before closing.');return false;}localStorage.setItem(KEY,JSON.stringify(state));loadFailed=false;$('storageWarning').innerHTML='';return true;}catch(err){$('storageWarning').innerHTML='<div class="notice">Browser storage is unavailable or full. Changes are in memory only. Download a full backup before closing this page.</div>';return false;}}
function changed(message){const saved=persist();render();toast(saved?message:message+' Saved in memory only; export a backup.');}
function setView(view){
  if(!document.getElementById(view))return;
  const previous=document.querySelector('.view:not([hidden])');
  if(previous?.id==='scan'&&view!=='scan')window.JoeScanner?.stop();
  document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==view);
  const grouped=['scratch','stores','backup','statsview','nearby'].includes(view)?'more':view;
  document.querySelectorAll('.nav button').forEach(b=>{const active=b.dataset.view===grouped;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  if($('ticketDialog')?.open)$('ticketDialog').close();
  window.scrollTo({top:0,behavior:'instant'});
  document.title=(view==='overview'?'Joe’s Lotto App':({tickets:'My tickets',scan:'Scan ticket',numbers:'My numbers',more:'More',scratch:'Scratch-offs',stores:'My stores',backup:'Settings',statsview:'My year & savings',nearby:'Around me'}[view]||'Joe’s Lotto App')+' · Joe’s Lotto');
}
const sortedTickets=()=>[...state.tickets].sort((a,b)=>b.date.localeCompare(a.date));
function sum(tickets){return tickets.reduce((a,t)=>{if(t.pricePending)a.unpriced+=t.quantity||1;else a.spent+=t.cost;if(t.status==='collected')a.collected+=t.amount;if(t.status==='unclaimed')a.unclaimed+=t.amount;if(t.status==='pending')a.pending+=t.quantity||1;return a;},{spent:0,collected:0,unclaimed:0,pending:0,unpriced:0});}
function renderPriceWarning(){const missing=state.tickets.filter(t=>t.pricePending),count=missing.reduce((n,t)=>n+(t.quantity||1),0);$('priceWarning').hidden=!count;$('priceWarning').innerHTML=count?'<div class="notice info"><strong>'+count+' scanned ticket'+(count===1?' needs':'s need')+' a price.</strong> Spending totals exclude '+(count===1?'it':'them')+' until you add the amount paid. <button class="subtle" data-action="edit-ticket" data-id="'+e(missing[0].id)+'">Add missing details →</button></div>':'';}
function periodTickets(){const now=today(),p=$('period').value;if(p==='all')return state.tickets;let start=p==='year'?now.slice(0,4)+'-01-01':now.slice(0,7)+'-01';if(p==='week'){const d=new Date(now+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);start=d.toISOString().slice(0,10);}return state.tickets.filter(t=>t.date>=start&&t.date<=now);}
function monthSpent(){return sum(state.tickets.filter(t=>t.date.startsWith(today().slice(0,7))&&t.date<=today())).spent;}
function limitReached(){return state.settings.monthlyLimit!==null&&monthSpent()>=state.settings.monthlyLimit;}
function pill(t){return '<span class="pill '+(t.status==='unclaimed'||t.status==='pending'?'warn':t.status==='loss'?'loss':'')+'">'+statusNames[t.status]+'</span>';}
function empty(title,text){return '<div class="empty"><strong>'+title+'</strong>'+text+'</div>';}
function renderOverview(){const t=periodTickets(),a=sum(t);$('spent').textContent=money(a.spent);$('collected').textContent=money(a.collected);$('net').textContent=money(a.collected-a.spent);$('unclaimed').textContent=money(a.unclaimed);const count=t.reduce((n,t)=>n+(t.quantity||1),0);$('ticketCount').textContent=count+' ticket'+(count===1?'':'s')+' recorded';$('pendingCount').textContent=a.pending+' ticket'+(a.pending===1?'':'s')+' to check';$('monthLabel').textContent=new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'America/New_York'}).format(new Date());const used=monthSpent(),lim=state.settings.monthlyLimit;$('budgetSummary').innerHTML=lim===null?'<div class="notice info">No spending limit set yet. Choose your own amount below; $0 is a valid limit.</div>':'<div class="section-head"><strong>'+money(used)+' spent</strong><span class="muted">of '+money(lim)+'</span></div><div class="balancebar" role="img" aria-label="'+e(money(used)+' spent out of '+money(lim))+'"><span style="width:'+Math.min(100,lim?used/lim*100:100)+'%"></span></div><p class="small">'+(used>=lim?'<strong class="negative">'+(used>lim?money(used-lim)+' over the limit.':'Limit reached.')+' Pause new purchases.</strong>':money(lim-used)+' remains within your chosen limit. This is a ceiling, not a spending goal.')+'</p>';
const attention=sortedTickets().filter(t=>['pending','unclaimed'].includes(t.status)).sort((a,b)=>(a.deadline||'9999').localeCompare(b.deadline||'9999'));$('attention').innerHTML=attention.length?'<div class="list">'+attention.slice(0,4).map(t=>'<div class="item"><div class="itemtop"><div><div class="itemtitle">'+e(t.game)+'</div><div class="small muted break">'+e(t.detail||t.store||t.date)+'</div></div>'+pill(t)+'</div>'+(t.deadline?'<div class="small body-note">'+(t.deadline<today()?'<strong class="negative">Entered deadline has passed: </strong>':'Entered claim-by date: ')+e(t.deadline)+'</div>':'')+'<button class="subtle" data-action="edit-ticket" data-id="'+e(t.id)+'">Update ticket →</button></div>').join('')+'</div>'+(attention.length>4?'<p class="small body-note">'+(attention.length-4)+' more in ticket history.</p>':''):empty('You’re all caught up.','Tickets to check and prizes to collect will appear here.');$('recent').innerHTML=renderTicketTable(sortedTickets().slice(0,5));}
function renderTicketTable(ts){
  if(!ts.length)return '<div class="empty"><div class="empty-icon" aria-hidden="true">✦</div><strong>Your first ticket starts here.</strong><p>Add a ticket you already have, or scan its barcode.</p><button data-action="new-ticket">Add a ticket</button></div>';
  return '<div class="ticket-grid">'+ts.map(t=>{
    const isPick=t.game.startsWith('Pick '),color=t.game==='Scratch-off'?'scratch':isPick?'pick':'jackpot';
    const date=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(t.date+'T12:00:00Z'));
    return '<article class="ticket-card '+color+'"><div class="ticket-card-top"><div class="ticket-icon" aria-hidden="true">'+(isPick?'#':t.game==='Scratch-off'?'✦':'◉')+'</div><div class="ticket-card-main"><div class="ticket-game">'+e(t.game)+'</div><div class="ticket-meta">'+e(date)+(t.store?' · '+e(t.store):'')+(t.scanFingerprint?' · Scanned':'')+((t.quantity||1)>1?' · '+t.quantity+' tickets':'')+'</div></div>'+pill(t)+'</div><div class="ticket-numbers">'+e(t.detail||'Ticket details not added')+'</div>'+(window.JoeTicketDesk?.summaryHTML(t)||'')+'<div class="ticket-card-bottom"><div class="ticket-return"><span class="small '+(t.pricePending?'negative':'muted')+'">'+(t.pricePending?'Price needed':'Paid '+money(t.cost))+'</span>'+(['unclaimed','collected'].includes(t.status)?'<strong>'+money(t.amount)+(t.status==='collected'?' collected':' to collect')+'</strong>':'')+'</div><div class="ticket-actions"><button class="subtle" data-action="edit-ticket" data-id="'+e(t.id)+'">'+(t.pricePending?'Add game & price':t.status==='pending'?'Update':'Edit')+'</button><button class="subtle" data-action="duplicate-ticket" data-id="'+e(t.id)+'" aria-label="Duplicate '+e(t.game)+' ticket">Again</button><button class="subtle" data-action="delete-ticket" data-id="'+e(t.id)+'" aria-label="Delete '+e(t.game)+' ticket">×</button></div></div></article>';
  }).join('')+'</div>';
}
function renderHistory(){const q=$('ticketSearch').value.toLowerCase(),filter=$('filterStatus').value;const ts=sortedTickets().filter(t=>(filter==='all'||(filter.startsWith('scan:')?window.JoeTicketDesk?.matches(t,filter.slice(5)):t.status===filter))&&[t.game,t.detail,t.store,t.notes].join(' ').toLowerCase().includes(q));$('history').innerHTML=renderTicketTable(ts);}
function resetTicket(){ ticketScan=null;selectedCatalogGame=null;ticketCatalogNumber=null;$('ticketAutoInfo').hidden=true;$('catalogPicker').open=false;$('catalogSearch').value='';$('ticketForm').reset();$('ticketForm').querySelectorAll('details').forEach(d=>d.open=false);$('ticketId').value='';$('purchaseDate').value=today();$('purchaseDate').max=today();$('ticketFormTitle').textContent='Add your ticket';$('ticketSave').textContent='Save ticket';$('cancelEdit').hidden=true;amountState();}
function amountState(){const s=$('status').value,active=['collected','unclaimed'].includes(s);$('amount').disabled=!active;$('amount').required=active;$('amount').min=active?'0.01':'0';if(!active)$('amount').value='0';$('amountLabel').textContent=s==='collected'?'Cash actually received ($)':s==='unclaimed'?'Prize shown, not collected ($)':'Return ($)';$('amountHelp').textContent=s==='collected'?'Enter the amount actually paid to you, after any withholding.':s==='unclaimed'?'This does not count as cash until you update the status.':s==='loss'?'No return recorded for this ticket.':'Unchecked tickets are not counted as wins.';}
function editTicket(id){const t=state.tickets.find(t=>t.id===id);if(!t)return;selectedCatalogGame=null;ticketCatalogNumber=t.catalogGameNumber||null;$('ticketAutoInfo').hidden=true;$('ticketQuantity').value=t.quantity||1;ticketScan=t.scanFingerprint?{fingerprint:t.scanFingerprint,format:t.barcodeFormat||'Barcode'}:null;setView('tickets');$('ticketId').value=t.id;$('purchaseDate').value=t.date;$('game').value=t.game;if(!$('game').value)$('game').value='Other';$('detail').value=t.detail;$('store').value=t.store;$('cost').value=t.pricePending?'':(t.cost/100).toFixed(2);$('status').value=t.status;amountState();$('amount').value=(t.amount/100).toFixed(2);$('deadline').value=t.deadline;$('ticketNotes').value=t.notes;$('ticketFormTitle').textContent='Update your ticket';$('ticketSave').textContent='Save changes';$('cancelEdit').hidden=false;const details=$('status').closest('details');if(details)details.open=true;openTicket();}
function resetScratch(){ $('scratchForm').reset();$('scratchId').value='';$('scratchDate').value=today();$('scratchDate').max=today();$('scratchFormTitle').textContent='Add a game to compare';$('scratchCancel').hidden=true;}
function renderScratch(){
const current=$('priceFilter').value;const prices=[...new Set(state.scratch.map(s=>s.price))].sort((a,b)=>a-b);
$('priceFilter').innerHTML='<option value="all">All prices</option>'+prices.map(p=>'<option value="'+p+'">'+money(p)+' tickets</option>').join('');
$('priceFilter').value=current;if(!$('priceFilter').value)$('priceFilter').value='all';
let a=state.scratch.filter(s=>$('priceFilter').value==='all'||s.price===Number($('priceFilter').value));
const sort=$('scratchSort').value;a.sort(sort==='odds'?(a,b)=>(a.odds??Infinity)-(b.odds??Infinity)||a.price-b.price:sort==='checked'?(a,b)=>b.checked.localeCompare(a.checked):(a,b)=>a.price-b.price||a.name.localeCompare(b.name));
$('scratchHistory').innerHTML=a.length?'<div class="ticket-grid">'+a.map(s=>'<article class="ticket-card scratch"><div class="ticket-card-top"><div class="ticket-icon" aria-hidden="true">✦</div><div class="ticket-card-main"><div class="ticket-game">'+e(s.name)+'</div><div class="ticket-meta">Your note · '+e(s.checked)+'</div></div><span class="pill">'+money(s.price)+'</span></div><div class="scratch-facts"><div><span class="small muted">Published any-prize odds</span><strong>'+(s.odds===null?'Not added':'1 in '+e(s.odds))+'</strong></div><div><span class="small muted">Top prizes unclaimed</span><strong>'+(s.remaining===null?'Not added':s.remaining)+'</strong></div></div><div class="ticket-card-bottom"><span class="small muted">Dated reference</span><div class="ticket-actions">'+(s.url?'<a href="'+e(s.url)+'" target="_blank" rel="noopener noreferrer">Source ↗</a>':'')+'<button class="subtle" data-action="edit-scratch" data-id="'+e(s.id)+'">Edit</button><button class="subtle" data-action="delete-scratch" data-id="'+e(s.id)+'">Remove</button></div></div></article>').join('')+'</div>':empty('Keep your scratch-offs together.','Add a game from the official list to keep its price and published details handy.');
}
function resetStore(){$('storeForm').reset();$('storeId').value='';$('storeChecked').max=today();$('storeCancel').hidden=true;$('storeFormTitle').textContent='Save a store';}
function renderStores(){$('storeList').innerHTML=state.stores.map(s=>'<option value="'+e(s.name)+'"></option>').join('');$('storeCards').innerHTML=state.stores.length?[...state.stores].sort((a,b)=>a.name.localeCompare(b.name)).map(s=>{const ts=state.tickets.filter(t=>t.store.trim().toLowerCase()===s.name.trim().toLowerCase()),a=sum(ts);return '<div class="panel"><div class="section-head"><div><h2>'+e(s.name)+'</h2><p class="small muted no-margin">'+e(s.town||'No address saved')+'</p></div><div class="actions"><button class="secondary" data-action="edit-store" data-id="'+e(s.id)+'">Edit</button><button class="subtle" data-action="delete-store" data-id="'+e(s.id)+'">Delete</button></div></div><p class="break">'+e(s.notes||'No availability notes saved.')+'</p><p class="small muted">Last personally checked: '+e(s.checked||'Not recorded')+'. Availability is not verified by this app.</p><div class="notice info"><strong>Your all-time records here:</strong> '+ts.length+' tickets · '+money(a.spent)+' spent · '+money(a.collected)+' collected · '+money(a.collected-a.spent)+' cash back minus spending.<br><span class="small">Describes the past only, not your next ticket’s odds.</span></div></div>';}).join(''):empty('No favorite stores yet','Save a store after checking the official retailer locator or visiting it.');}
function randomInt(n){const range=4294967296,limit=range-range%n,b=new Uint32Array(1);do{crypto.getRandomValues(b);}while(b[0]>=limit);return b[0]%n;}
function generateSet(game){const g=games[game];if(g.digits)return{game,nums:Array.from({length:g.digits},()=>randomInt(10)),bonus:null};const pool=Array.from({length:g.max},(_,i)=>i+1),nums=[];for(let i=0;i<5;i++){const j=randomInt(pool.length);nums.push(pool.splice(j,1)[0]);}return{game,nums:nums.sort((a,b)=>a-b),bonus:1+randomInt(g.bonus)};}
function renderNumberRules(){const g=games[$('numberGame').value];$('numberRules').textContent=g.digits?`${g.digits} digits from 0–9. Repeated digits and leading zeroes are allowed.`:`Five different numbers from 1–${g.max}, plus a ${g.bonusName} from 1–${g.bonus}. The bonus is drawn from a separate pool.`;$('numberSource').href=g.url;$('usualNumbers').placeholder=g.digits?'e.g. '+'0'.repeat(g.digits-1)+'7':'e.g. 3 14 25 36 47 + 8';}
function renderNumberPause(){const blocked=state.settings.paused||limitReached();$('generate').disabled=blocked||picking;$('numberPause').innerHTML=blocked?'<div class="notice">Number generation is paused '+(state.settings.paused?'by your setting.':'because your monthly spending limit has been reached.')+' Your ticket history and saved numbers remain available.</div>':'';}
function pickMethod(){return document.querySelector('input[name="pickMethod"]:checked')?.value||'random';}
function clearGenerated(){generationEpoch++;generated=null;$('numberResult').innerHTML='<div class="placeholder">Ready for Lewis to make a set?</div>';$('saveGenerated').disabled=true;}
function renderPickMethodInfo(){
  if(pickMethod()==='random'){
    $('pickMethodInfo').innerHTML='<p><strong>Fresh random numbers.</strong> Lewis uses your device’s secure random generator to make a valid set for this game. No purchase is made.</p>';
    return;
  }
  const meta=window.JoeRecentPicks?.info($('numberGame').value);
  if(!meta?.available){$('pickMethodInfo').innerHTML='<p>'+e(meta?.reason||'Verified Ohio draw results are unavailable right now.')+'</p>';return;}
  $('pickMethodInfo').innerHTML='<p><strong>Inspired by '+meta.count+' official draws.</strong> Saved results from '+e(meta.windowStart)+' through '+e(meta.windowEnd)+'. '+(games[$('numberGame').value].digits?'Includes midday and evening draws.':'Includes the national game results reported by Ohio Lottery.')+'</p><p>Numbers seen more often in this window receive more weight. Every legal number stays possible. This does not predict a winning set.</p><details><summary>Results & method</summary><p>'+e(meta.methodDescription)+'</p><p>Snapshot checked '+e(meta.asOf)+'. This saved window does not refresh automatically.</p><a href="'+e(meta.source.url)+'" target="_blank" rel="noopener noreferrer">Official Ohio results archive ↗</a></details>';
}
async function generateForLewis(method=pickMethod()){
  if(!['random','recent'].includes(method))throw Error('Choose a supported picking method.');
  if(state.settings.paused||limitReached()){
    renderNumberPause();toast('Number generation is paused. Your saved picks are still available.');return false;
  }
  if(picking)return false;
  document.querySelector('input[name="pickMethod"][value="'+method+'"]').checked=true;
  clearGenerated();renderPickMethodInfo();
  const game=$('numberGame').value,epoch=generationEpoch;
  picking=true;renderNumberPause();$('generate').setAttribute('aria-busy','true');
  try{
    if(method==='recent'){
      if(!window.JoeRecentPicks)throw Error('Recent Ohio results are unavailable. Try fresh random numbers.');
      await window.JoeRecentPicks.ready();
    }
    if(epoch!==generationEpoch||game!==$('numberGame').value||method!==pickMethod()||state.settings.paused||limitReached())return false;
    const result=method==='recent'?window.JoeRecentPicks.generate(game):generateSet(game);
    // Keep the existing backup schema: save the valid numbers, not source metadata.
    generated={game:result.game,nums:result.nums,bonus:result.bonus};
    $('numberResult').innerHTML='<div class="ballrow" aria-label="'+e(numberText(generated))+'">'+generated.nums.map(n=>'<span class="ball">'+n+'</span>').join('')+(generated.bonus===null?'':'<span class="ball bonus" title="'+e(games[game].bonusName)+'">'+generated.bonus+'</span>')+'</div><p class="small muted">'+(method==='recent'?'Lewis · inspired by '+result.sourceRows+' Ohio-reported draws':'Lewis · fresh random set')+(generated.bonus===null?'':' · Gold ball = '+e(games[game].bonusName))+'</p>';
    $('saveGenerated').disabled=false;return true;
  }catch(err){
    if(epoch===generationEpoch){$('numberResult').innerHTML='<p class="small">'+e(method==='recent'?err.message:'Secure random generation is unavailable in this browser.')+'</p>';toast(method==='recent'?err.message:'Secure random generation is unavailable in this browser.');}
    return false;
  }finally{picking=false;$('generate').removeAttribute('aria-busy');renderNumberPause();renderPickMethodInfo();}
}
function saveFavorite(f){if(state.favorites.some(x=>x.game===f.game&&numberText(x)===numberText(f))){toast('Those numbers are already saved.');return;}state.favorites.push({id:uid(),...f});changed('Numbers saved. No ticket was purchased.');}
function renderFavorites(){$('favorites').innerHTML=state.favorites.length?state.favorites.map(f=>'<div class="item favorite-card"><div class="itemtop"><div><div class="small muted">'+e(f.game)+'</div><div class="ballrow">'+f.nums.map(n=>'<span class="ball">'+n+'</span>').join('')+(f.bonus===null?'':'<span class="ball bonus">'+f.bonus+'</span>')+'</div></div><span class="pill">Saved picks</span></div><div class="actions"><button class="secondary" data-action="copy-favorite" data-id="'+e(f.id)+'">Copy numbers</button><button class="subtle" data-action="use-favorite" data-id="'+e(f.id)+'">Add a ticket</button><button class="subtle" data-action="delete-favorite" data-id="'+e(f.id)+'">Remove</button></div></div>').join(''):empty('Your favorites, right here.','Save a set to keep your usual numbers close.');}
function render(){window.JoeTicketDesk?.prepareRender();if(lastScannedId&&!state.tickets.some(t=>t.id===lastScannedId)){lastScannedId=null;$('scanSaved').hidden=true;}renderPriceWarning();renderOverview();renderHistory();renderScratch();renderStores();renderFavorites();renderNumberPause();renderHome();renderYearly();renderRestocks();renderScanMemory();window.JoeTicketDesk?.render();}
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function csvCell(x){let s=String(x??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function exportCSV(){const rows=[['Purchase date','Game','Ticket name or selected numbers (text)','Store','Ticket count','Cost dollars','Status','Cash received dollars','Unclaimed prize dollars','Entered claim-by date','Notes','Price status'],...sortedTickets().map(t=>[t.date,t.game,t.detail,t.store,t.quantity||1,t.pricePending?'':(t.cost/100).toFixed(2),statusNames[t.status],t.status==='collected'?(t.amount/100).toFixed(2):'',t.status==='unclaimed'?(t.amount/100).toFixed(2):'',t.deadline,t.notes,t.pricePending?'Price needed':'Recorded'])];download('lottery-tickets-'+today()+'.csv','\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('CSV exported. Import number columns as text to keep leading zeroes.');}
async function copyText(s){try{await navigator.clipboard.writeText(s);toast('Numbers copied.');}catch(err){prompt('Copy these numbers:',s);}}
document.addEventListener('click',async ev=>{const b=ev.target.closest('button');if(!b)return;if(b.dataset.view){setView(b.dataset.view);return;}const a=b.dataset.action,id=b.dataset.id;if(a==='new-ticket'){resetTicket();openTicket();}if(a==='close-ticket')$('ticketDialog').close();if(a==='duplicate-ticket'){const t=state.tickets.find(x=>x.id===id);if(t){resetTicket();$('game').value=t.game;$('detail').value=t.detail;$('store').value=t.store;$('cost').value=t.pricePending?'':t.cost/100;$('ticketQuantity').value=t.quantity||1;openTicket();}}if(a==='use-favorite'){const f=state.favorites.find(x=>x.id===id);if(f){resetTicket();$('game').value=f.game;$('detail').value=numberText(f);openTicket();}}if(a==='edit-ticket')editTicket(id);if(a==='delete-ticket'&&confirm('Delete this ticket from the log?')){window.JoeTicketDesk?.forgetMemory(id);const deletedPhoto=state.ticketScans?.find(row=>row.ticketId===id)?.imageId;state.ticketScans=(state.ticketScans||[]).filter(row=>row.ticketId!==id);state.tickets=state.tickets.filter(x=>x.id!==id);if($('ticketId').value===id)resetTicket();const saved=persist();render();if(saved&&deletedPhoto)await window.JoeTicketImages?.remove(deletedPhoto);toast(saved?'Ticket deleted.':'Ticket removed in memory only; export a backup.');}if(a==='export-csv')exportCSV();if(a==='edit-scratch'){const s=state.scratch.find(x=>x.id===id);$('scratchId').value=id;$('scratchName').value=s.name;$('scratchPrice').value=s.price/100;$('scratchOdds').value=s.odds??'';$('scratchRemaining').value=s.remaining??'';$('scratchDate').value=s.checked;$('scratchUrl').value=s.url;$('scratchFormTitle').textContent='Update game details';$('scratchCancel').hidden=false;const details=$('scratchForm').closest('details');if(details)details.open=true;$('scratchForm').scrollIntoView({block:'center'});}if(a==='delete-scratch'&&confirm('Remove this game comparison?')){state.scratch=state.scratch.filter(x=>x.id!==id);if($('scratchId').value===id)resetScratch();changed('Game removed.');}if(a==='edit-store'){const s=state.stores.find(x=>x.id===id);$('storeId').value=id;$('storeName').value=s.name;$('storeTown').value=s.town;$('storeChecked').value=s.checked;$('storeNotes').value=s.notes;$('storeFormTitle').textContent='Update store';$('storeCancel').hidden=false;const details=$('storeForm').closest('details');if(details)details.open=true;$('storeForm').scrollIntoView({block:'center'});}if(a==='delete-store'&&confirm('Remove this saved store? Ticket history will be kept.')){state.stores=state.stores.filter(x=>x.id!==id);if($('storeId').value===id)resetStore();changed('Store removed.');}if(a==='delete-favorite'){state.favorites=state.favorites.filter(x=>x.id!==id);changed('Saved numbers removed.');}if(a==='copy-favorite'){const f=state.favorites.find(x=>x.id===id);await copyText(f.game+': '+numberText(f));}});
$('ticketForm').addEventListener('submit',ev=>{ev.preventDefault();try{if(!dateOK($('purchaseDate').value)||$('purchaseDate').value>today())throw Error('Enter a valid purchase date, not a future date.');const st=$('status').value,amt=['unclaimed','collected'].includes(st)?cents($('amount').value):0;if(['unclaimed','collected'].includes(st)&&amt===0)throw Error('Enter a positive prize/received amount, or choose another status.');const id=$('ticketId').value||uid(),t={id,date:$('purchaseDate').value,game:$('game').value,detail:$('detail').value.trim(),store:$('store').value.trim(),cost:cents($('cost').value),status:st,amount:amt,deadline:$('deadline').value,notes:$('ticketNotes').value.trim(),quantity:validQuantity(Number($('ticketQuantity').value)),...(ticketCatalogNumber?{catalogGameNumber:String(ticketCatalogNumber)}:{}),...(ticketScan?{scanFingerprint:ticketScan.fingerprint,barcodeFormat:ticketScan.format}:{})};const priorScan=state.ticketScans?.find(row=>row.ticketId===id);if(priorScan&&priorScan.draw){const old=state.tickets.find(x=>x.id===id);if(old?.game!==t.game||old?.detail!==t.detail){priorScan.draw=window.JoeDrawTicket.validate({...priorScan.draw,reviewed:false});priorScan.evaluation=null;}}const i=state.tickets.findIndex(x=>x.id===id);if(i>=0)state.tickets[i]=t;else state.tickets.push(t);if(id===lastScannedId){lastScannedId=null;$('scanSaved').hidden=true;}resetTicket();$('ticketDialog').close();setView('tickets');changed('Ticket saved.');}catch(err){toast(err.message);}});
$('budgetForm').addEventListener('submit',ev=>{ev.preventDefault();try{state.settings.monthlyLimit=$('monthlyLimit').value===''?null:cents($('monthlyLimit').value);changed('Monthly limit saved.');}catch(err){toast(err.message);}});
$('paused').addEventListener('change',()=>{state.settings.paused=$('paused').checked;changed(state.settings.paused?'Number generation paused.':'Pause setting removed. Spending limit still applies.');});
$('scratchForm').addEventListener('submit',ev=>{ev.preventDefault();try{const id=$('scratchId').value||uid(),price=cents($('scratchPrice').value),odds=$('scratchOdds').value===''?null:Number($('scratchOdds').value),remaining=$('scratchRemaining').value===''?null:Number($('scratchRemaining').value);if(!price||!dateOK($('scratchDate').value)||$('scratchDate').value>today())throw Error('Enter a positive price and a valid checked date, not in the future.');if(odds!==null&&(!Number.isFinite(odds)||odds<1)||remaining!==null&&(!Number.isSafeInteger(remaining)||remaining<0))throw Error('Enter valid odds and a whole-number remaining count.');const s={id,name:$('scratchName').value.trim(),price,odds,remaining,checked:$('scratchDate').value,url:officialURL($('scratchUrl').value.trim())};if(!s.name)throw Error('Enter a game name.');const i=state.scratch.findIndex(x=>x.id===id);if(i>=0)state.scratch[i]=s;else state.scratch.push(s);resetScratch();changed('Dated game details saved. Not live data.');}catch(err){toast(err.message);}});
$('storeForm').addEventListener('submit',ev=>{ev.preventDefault();try{const id=$('storeId').value||uid(),name=$('storeName').value.trim();if(!name)throw Error('Enter a store name.');if(state.stores.some(s=>s.id!==id&&s.name.toLowerCase()===name.toLowerCase()))throw Error('That store is already saved. Edit it or give this location a unique name.');if($('storeChecked').value&&(!dateOK($('storeChecked').value)||$('storeChecked').value>today()))throw Error('Use a valid checked date, not in the future.');const s={id,name,town:$('storeTown').value.trim(),checked:$('storeChecked').value,notes:$('storeNotes').value.trim()},i=state.stores.findIndex(x=>x.id===id);if(i>=0){const old=state.stores[i].name;state.tickets.forEach(t=>{if(t.store.trim().toLowerCase()===old.toLowerCase())t.store=name;});state.stores[i]=s;}else state.stores.push(s);resetStore();changed('Store note saved. Availability is not verified.');}catch(err){toast(err.message);}});
$('numberGame').addEventListener('change',()=>{clearGenerated();$('usualNumbers').value='';renderNumberRules();renderPickMethodInfo();});
document.querySelectorAll('input[name="pickMethod"]').forEach(input=>input.addEventListener('change',()=>{clearGenerated();renderPickMethodInfo();}));
$('generate').addEventListener('click',()=>generateForLewis());
$('saveGenerated').addEventListener('click',()=>{if(generated)saveFavorite(generated);});
$('favoriteForm').addEventListener('submit',ev=>{ev.preventDefault();try{saveFavorite(parseNumbers($('numberGame').value,$('usualNumbers').value));$('usualNumbers').value='';}catch(err){toast(err.message);}});
$('exportJson').addEventListener('click',async()=>{const button=$('exportJson');button.disabled=true;try{const snapshot=JSON.parse(JSON.stringify(state));let photos=[];if($('includeTicketPhotos')?.checked){try{const bundle=await window.JoeTicketDesk.exportData(true,snapshot.ticketScans||[]);photos=bundle.images;snapshot.ticketScans=bundle.scans;}catch(err){if(!confirm('Photos could not be included: '+err.message+' Download a clearly labelled records-only backup instead?'))return;}}snapshot.privateTicketImages=photos;snapshot.photoBackup=photos.length?'included':'records-only';download('joes-lotto-'+(photos.length?'private-photo-':'records-')+'backup-'+today()+'.json',JSON.stringify(snapshot,null,2),'application/json');toast(photos.length?'Full backup exported with readable private photos. Keep it private.':'Records exported. Ticket photos are not included.');}catch(err){toast('Backup could not be exported: '+err.message);}finally{button.disabled=false;}});
$('importJson').addEventListener('change',async ev=>{
  const file=ev.target.files[0];if(!file)return;
  let stagedImages=[];
  try{
    if(file.size>32*1024*1024)throw Error('Backup is too large (32 MB maximum).');
    const parsed=JSON.parse(await file.text()),incoming=validate(parsed);
    if(!confirm(`Replace all current records with this backup? It contains ${incoming.tickets.length} tickets, ${incoming.stores.length} stores, ${incoming.scratch.length} game notes, and ${incoming.favorites.length} saved number sets. Export first if you need this device’s current data.`))return;
    const previous=state,oldImages=[...new Set((state.ticketScans||[]).map(row=>row.imageId).filter(Boolean))];
    if(incoming.ticketScans?.length)incoming.ticketScans=await window.JoeTicketDesk.restoreImages(incoming.ticketScans,parsed.privateTicketImages||[]);
    stagedImages=[...new Set((incoming.ticketScans||[]).map(row=>row.imageId).filter(Boolean))];
    state=incoming;
    if(!persist()){
      state=previous;
      await Promise.allSettled(stagedImages.map(id=>window.JoeTicketImages.remove(id)));stagedImages=[];
      render();throw Error('Browser storage could not save the restored records. Existing records and photos were kept.');
    }
    // Delete replaced photos only after the same v1 record write succeeds.
    await Promise.allSettled(oldImages.filter(id=>!stagedImages.includes(id)).map(id=>window.JoeTicketImages.remove(id)));
    stagedImages=[];window.JoeTicketDesk?.forgetAllMemory();lastScannedId=null;$('scanSaved').hidden=true;resetTicket();resetStore();resetScratch();
    $('monthlyLimit').value=state.settings.monthlyLimit===null?'':state.settings.monthlyLimit/100;$('paused').checked=state.settings.paused;
    render();toast('Backup restored. Draw comparisons will be checked again.');
  }catch(err){if(stagedImages.length)await Promise.allSettled(stagedImages.map(id=>window.JoeTicketImages.remove(id)));toast('Backup was not imported: '+err.message);}
  finally{ev.target.value='';}
});
$('period').addEventListener('change',render);$('filterStatus').addEventListener('change',renderHistory);$('ticketSearch').addEventListener('input',renderHistory);$('priceFilter').addEventListener('change',renderScratch);$('scratchSort').addEventListener('change',renderScratch);$('status').addEventListener('change',amountState);$('cancelEdit').addEventListener('click',()=>{$('ticketDialog').close();resetTicket();});$('scratchCancel').addEventListener('click',resetScratch);$('storeCancel').addEventListener('click',resetStore);
// Refresh date-based summaries when the tab becomes active after midnight.
document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});

function openTicket(){
  window.JoeScanner?.stop();
  const d=$('ticketDialog');
  if(!d.open)d.showModal();
  requestAnimationFrame(()=>$('game').focus());
}
function renderHome(){
  const totals=sum(state.tickets),used=monthSpent(),limit=state.settings.monthlyLimit;
  $('homePending').textContent=totals.pending;
  $('homeUnclaimed').textContent=money(totals.unclaimed);
  $('homeSpent').textContent=money(used);
  $('homeBudget').textContent=limit===null?'Set a monthly limit':used>=limit?'Your monthly limit is reached':money(limit-used)+' left in your limit';
  $('todayLabel').textContent=new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:'America/New_York'}).format(new Date());
}
function scannedMatch(raw){
  if(!raw||typeof raw.name!=='string'||!raw.name||raw.name.length>140)return null;
  if(raw.confidence==='printed-draw-total'){
    if(!['Pick 3','Pick 4','Pick 5','Rolling Cash 5','Classic Lotto','Powerball','Mega Millions','KENO'].includes(raw.game)||!Number.isSafeInteger(raw.totalPriceCents)||raw.totalPriceCents<=0||raw.totalPriceCents>1000000)return null;
    return raw;
  }
  if(!['verified-game-id','printed-game-id','printed-title-and-price','printed-game-serial'].includes(raw.confidence)||raw.confidence==='verified-game-id'&&raw.barcodeIdentity!=='game'||!/^\d{1,4}$/.test(String(raw.gameNumber))||!Number.isSafeInteger(raw.unitPriceCents)||raw.unitPriceCents<=0||raw.unitPriceCents>10000||!dateOK(raw.asOf))return null;
  try{officialURL(raw.source);if(!raw.source)return null;}catch{return null;}
  return raw;
}
// Only a yes/no lookup is exposed to the local scanner; no records leave the app.
window.JoeScanMemory=Object.freeze({has:fingerprint=>typeof fingerprint==='string'&&state.scanGameMatches.some(m=>m.fingerprint===fingerprint&&catalogGames.some(g=>String(g.gameNumber)===m.gameNumber))});
function renderScanMemory(){
  if($('scanMemoryCount'))$('scanMemoryCount').textContent=state.scanGameMatches.length?state.scanGameMatches.length+' confirmed product barcode'+(state.scanGameMatches.length===1?'':'s')+' remembered on this device.':'No personal barcode choices saved.';
  if($('clearScanMemory'))$('clearScanMemory').disabled=!state.scanGameMatches.length;
}
function renderScanGameOptions(){
  const box=$('scanGameOptions');if(!box)return;
  const q=($('scanGameSearch')?.value||'').trim().toLowerCase().replace(/^#/,'');
  const matches=catalogGames.filter(g=>!q||g.name.toLowerCase().includes(q)||String(g.gameNumber).includes(q)).slice().sort((a,b)=>Number(b.gameNumber)-Number(a.gameNumber));
  box.innerHTML=matches.slice(0,q?24:6).map(g=>'<button class="secondary" type="button" data-action="scan-select-game" data-game-number="'+e(g.gameNumber)+'"><span><strong>'+e(g.name)+'</strong><small>Game #'+e(g.gameNumber)+(g.catalogStatus==='historical-publication'?' · Older game reference':'')+'</small></span><b>'+money(g.unitPriceCents)+'</b></button>').join('')||'<p class="small muted">No matching game. Use Edit details to enter the printed name and amount paid.</p>';
  if($('scanGameStatus'))$('scanGameStatus').textContent=catalogGames.length?'Official game prices checked '+catalogAsOf+'. '+(q?matches.length+' match'+(matches.length===1?'':'es')+'.':'Type a name or game number to find yours.'):'The game list is unavailable. Use Edit details to enter the printed game and price.';
}
function appendScanGamePicker(box,ticket,context){
  const picker=document.createElement('details');picker.className='scan-game-picker';picker.open=!!ticket.pricePending;
  const summary=document.createElement('summary');summary.textContent=ticket.pricePending?'Choose the printed game & fill its price':'Choose a different printed game';picker.append(summary);
  const help=document.createElement('p');help.textContent='For an Ohio scratch-off, tap the exact game printed on this ticket. Its published price will update this saved entry. Use Edit details for draw tickets, quantities, or a different amount paid.';picker.append(help);
  const label=document.createElement('label');label.htmlFor='scanGameSearch';label.textContent='Game name or #number';picker.append(label);
  const search=document.createElement('input');search.type='search';search.id='scanGameSearch';search.placeholder='e.g. Holiday Cash or #1106';search.autocomplete='off';search.maxLength=120;search.addEventListener('input',renderScanGameOptions);picker.append(search);
  if(context.productFingerprint){
    const remember=document.createElement('label');remember.className='scan-game-remember';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id='scanRememberGame';checkbox.checked=true;remember.append(checkbox,document.createTextNode('Remember this game for this barcode on this device'));picker.append(remember);
  }
  const status=document.createElement('p');status.id='scanGameStatus';status.className='scan-game-status';picker.append(status);
  const results=document.createElement('div');results.id='scanGameOptions';results.className='scan-game-options';picker.append(results);box.append(picker);renderScanGameOptions();
}
function scanReceipt(ticket,saved,earlier,context=lastScanContext||{}){
  const box=$('scanSaved');box.replaceChildren();box.hidden=false;
  const title=document.createElement('strong');title.textContent=saved?'Ticket added to My tickets.':'Ticket added in memory only.';box.append(title);
  const copy=document.createElement('p');copy.className='small body-note';copy.textContent=ticket.pricePending?'Game and price still needed. This ticket stays out of spending totals until its price is added. Choose the printed game below to fill a scratch-off’s price.':ticket.detail+' · '+(ticket.quantity||1)+' ticket'+((ticket.quantity||1)===1?'':'s')+' · '+money(ticket.cost)+' total · '+ticket.date+'. Edit it if the amount paid, quantity or date differs.';box.append(copy);
  if(!ticket.pricePending){
    const source=document.createElement('p');source.className='scan-match-source';source.textContent=context.recognition==='remembered'?'Recognized from your earlier choice on this device. ':context.recognition==='chosen'?'You selected the printed game. ':context.recognition==='printed-draw'?'Read the printed game and total ticket cost on your device. ':context.recognition==='printed'?'Read the printed game details and matched the official game price on your device. ':'Matched a published game barcode. ';
    const game=catalogGames.find(g=>String(g.gameNumber)===String(ticket.catalogGameNumber));
    if(game){const link=document.createElement('a');link.href=game.source;link.target='_blank';link.rel='noopener noreferrer';link.textContent=(game.catalogStatus==='historical-publication'?'Older game reference · ':'')+'Official unit price '+money(game.unitPriceCents)+' · checked '+game.asOf+' ↗';source.append(link);}box.append(source);
  }
  if(!saved){const note=document.createElement('p');note.className='small negative';note.textContent='Browser storage did not save this change. Export a backup before closing.';box.append(note);}
  if(ticket.pricePending||context.recognition==='remembered')appendScanGamePicker(box,ticket,context);
  const controls=document.createElement('div');controls.className='actions';
  for(const [label,action,id] of [['Edit details','edit-ticket',ticket.id],['Undo this scan','undo-scan',ticket.id],['Scan another','scan-another','']]){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=label;button.dataset.action=action;if(id)button.dataset.id=id;controls.append(button);}box.append(controls);
  if(earlier){const note=document.createElement('p');note.className='small body-note';note.textContent='A matching code appears on an earlier record. Some codes are shared by different tickets. This scan was added as another ticket.';box.append(note);const review=document.createElement('button');review.type='button';review.className='subtle';review.dataset.action='edit-ticket';review.dataset.id=earlier.id;review.textContent='Review the earlier record →';box.append(review);}
}
let scanSaveQueue=Promise.resolve();
async function saveScannedTicket(detail){
  detail.drawData=detail.drawData?window.JoeDrawTicket?.validate(detail.drawData):null;
  const duplicate=window.JoeTicketDesk?.findDuplicate(detail);if(duplicate){setView('tickets');$('ticketSearch').value='';$('filterStatus').value='all';render();toast('This ticket or exact photo is already saved. No duplicate was added.');return;}
  let match=scannedMatch(detail.gameMatch),recognition=match?(match.confidence==='printed-draw-total'?'printed-draw':match.confidence.startsWith('printed-')?'printed':'official'):'unknown';
  const productFingerprint=typeof detail.productFingerprint==='string'&&/^[a-f0-9]{64}$/.test(detail.productFingerprint)&&!detail.ambiguous?detail.productFingerprint:null;
  if(!match&&productFingerprint){
    const remembered=state.scanGameMatches.find(m=>m.fingerprint===productFingerprint);
    if(remembered){try{const game=await window.JoeTicketIntelligence?.lookup(remembered.gameNumber);if(game){match=game;recognition='remembered';}}catch{}}
  }
  const format=typeof detail.format==='string'?detail.format.slice(0,40):'Barcode';
  const fingerprint=typeof detail.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(detail.fingerprint)?detail.fingerprint:null;
  const isProductCode=/UPC|EAN/i.test(format)||match?.barcodeIdentity==='game'||!!productFingerprint;
  const earlier=!isProductCode&&fingerprint&&state.tickets.find(t=>t.scanFingerprint===fingerprint);if(earlier&&confirm('This same code is already saved. Open that record instead of adding a duplicate? Cancel only if this is another physical ticket with a shared code.')){editTicket(earlier.id);toast('Existing ticket opened; no duplicate added.');return;}
  const ticket={id:uid(),date:today(),game:match?(match.game||'Scratch-off'):(detail.drawData?.game||'Other'),detail:match?match.name+(match.gameNumber?' · #'+match.gameNumber:''):detail.drawData?.game?'Scanned '+detail.drawData.game+' · review plays':'Scanned ticket · '+format,store:'',cost:match?(match.totalPriceCents??match.unitPriceCents):0,status:'pending',amount:0,deadline:'',notes:'',quantity:1,...(match?.gameNumber?{catalogGameNumber:String(match.gameNumber)}:match?{}:{pricePending:true}),...(fingerprint&&!isProductCode?{scanFingerprint:fingerprint,barcodeFormat:format}:{})};
  state.tickets.push(ticket);lastScannedId=ticket.id;lastScanContext={ticketId:ticket.id,productFingerprint,recognition};
  resetTicket();setView('tickets');$('ticketSearch').value='';$('filterStatus').value='all';
  const saved=persist();render();scanReceipt(ticket,saved,earlier,lastScanContext);
  toast(saved?(match?'Ticket added automatically.':'Ticket added. Choose its printed game to fill the price.'):'Ticket is in memory only. Download a backup before closing.');
  requestAnimationFrame(()=>$('scanSaved').focus({preventScroll:true}));
  if(window.JoeTicketDesk){await window.JoeTicketDesk.capture(ticket,detail);if(lastScannedId===ticket.id&&state.tickets.some(t=>t.id===ticket.id)){const extra=document.createElement('div');extra.innerHTML=window.JoeTicketDesk.summaryHTML(ticket);$('scanSaved').append(extra);}}
}
window.addEventListener('joe:scanned-ticket',ev=>{const detail=ev.detail||{};scanSaveQueue=scanSaveQueue.then(()=>saveScannedTicket(detail)).catch(()=>toast('The scan could not finish saving. Your existing records are unchanged; try again.'));});
document.addEventListener('click',ev=>{
  const b=ev.target.closest('button');if(!b)return;
  if(b.dataset.action==='scan-select-game'){
    const ticket=state.tickets.find(t=>t.id===lastScannedId),game=catalogGames.find(g=>String(g.gameNumber)===b.dataset.gameNumber);
    if(!ticket||!game||lastScanContext?.ticketId!==ticket.id)return;
    const quantity=ticket.quantity||1,total=game.unitPriceCents*quantity;if(!Number.isSafeInteger(total)||total>100000000000)return;
    const remember=!!$('scanRememberGame')?.checked;
    ticket.game='Scratch-off';ticket.detail=game.name+' · #'+game.gameNumber;ticket.catalogGameNumber=String(game.gameNumber);ticket.cost=total;delete ticket.pricePending;
    if(lastScanContext.productFingerprint){
      state.scanGameMatches=state.scanGameMatches.filter(m=>m.fingerprint!==lastScanContext.productFingerprint);
      if(remember){state.scanGameMatches.push({fingerprint:lastScanContext.productFingerprint,gameNumber:String(game.gameNumber),confirmedAt:today()});if(state.scanGameMatches.length>1000)state.scanGameMatches.shift();}
    }
    lastScanContext.recognition='chosen';const saved=persist();render();scanReceipt(ticket,saved,null,lastScanContext);toast(saved?'Game and price filled.'+(remember?' Your choice is remembered on this device.':''):'Price filled in memory only. Export a backup.');
  }
  if(b.dataset.action==='clear-scan-memory'&&state.scanGameMatches.length&&confirm('Forget your remembered product-barcode choices? Your saved tickets and spending stay in place.')){state.scanGameMatches=[];changed('Remembered games cleared.');}
});
document.addEventListener('click',ev=>{
  const b=ev.target.closest('button');if(!b)return;
  if(b.dataset.action==='scan-another')setView('scan');
  if(b.dataset.action==='undo-scan'&&b.dataset.id===lastScannedId){
    window.JoeTicketDesk?.forgetMemory(lastScannedId);const undonePhoto=state.ticketScans?.find(row=>row.ticketId===lastScannedId)?.imageId;state.ticketScans=(state.ticketScans||[]).filter(row=>row.ticketId!==lastScannedId);state.tickets=state.tickets.filter(t=>t.id!==lastScannedId);lastScannedId=null;$('scanSaved').hidden=true;
    const saved=loadFailed?false:persist();render();if(saved&&undonePhoto)window.JoeTicketImages?.remove(undonePhoto).catch(()=>{});toast(saved?'Scanned ticket removed.':'Scan undone in memory. Export a backup if storage is unavailable.');
  }
});
$('ticketDialog').addEventListener('click',ev=>{if(ev.target===$('ticketDialog')){const box=$('ticketDialog').getBoundingClientRect();if(ev.clientX<box.left||ev.clientX>box.right||ev.clientY<box.top||ev.clientY>box.bottom)$('ticketDialog').close();}});

function renderYearly(){
  const current=today().slice(0,4),select=$('spendingYear'),previous=select.value;
  const years=[...new Set([current,...state.tickets.map(t=>t.date.slice(0,4))])].sort().reverse();
  select.innerHTML=years.map(y=>'<option value="'+y+'">'+y+'</option>').join('');
  select.value=years.includes(previous)?previous:current;
  const year=select.value,ts=state.tickets.filter(t=>t.date.startsWith(year+'-')),a=sum(ts),total=sum(state.tickets);
  $('yearSpent').textContent=money(a.spent);$('yearCollected').textContent=money(a.collected);$('yearNet').textContent=money(a.collected-a.spent);$('allYearsSpent').textContent=money(total.spent);
  const count=ts.reduce((n,t)=>n+(t.quantity||1),0);
  $('yearTicketCount').textContent=count+' ticket'+(count===1?'':'s')+' in '+ts.length+' recorded purchase'+(ts.length===1?'':'s')+'.'+(a.unpriced?' '+a.unpriced+' ticket'+(a.unpriced===1?' needs':'s need')+' a price; excluded from spending.':'');
  $('homeYearSpent').textContent=money(sum(state.tickets.filter(t=>t.date.startsWith(current+'-'))).spent);
  $('yearChartLabel').textContent='Recorded spending · '+year;
  const months=Array.from({length:12},(_,i)=>({label:new Intl.DateTimeFormat('en-US',{month:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2026,i,1))),value:sum(ts.filter(t=>Number(t.date.slice(5,7))===i+1)).spent})),max=Math.max(1,...months.map(m=>m.value));
  $('yearChart').innerHTML=months.map(m=>'<div class="month-column"><div class="month-track"><span class="month-amount">'+(m.value?e(money(m.value)):'')+'</span><i style="height:'+Math.max(m.value?3:0,m.value/max*100)+'%" aria-hidden="true"></i></div><span>'+m.label+'</span><span class="sr-only">'+e(money(m.value))+'</span></div>').join('');
  function breakdown(key,id,emptyText){const groups=new Map();for(const t of ts){if(t.pricePending)continue;const k=t[key]||emptyText;groups.set(k,(groups.get(k)||0)+t.cost);}$(id).innerHTML=groups.size?[...groups].sort((a,b)=>b[1]-a[1]).map(([name,amount])=>'<div class="spend-row"><span>'+e(name)+'</span><strong>'+money(amount)+'</strong></div>').join(''):'<p class="small muted">No purchases recorded for '+year+'.</p>';}
  breakdown('game','yearByGame','Other');breakdown('store','yearByStore','Store not added');
}
function renderSavings(){
  const value=$('savingsDaily').value,years=Number($('savingsYears').value);
  try{if(value==='')throw Error();const daily=cents(value),total=daily*365*years;if(!Number.isSafeInteger(total))throw Error();$('savingsTotal').textContent=money(total);$('savingsExplanation').textContent=money(daily)+' a day × 365 days × '+years+' year'+(years===1?'':'s')+'.';}
  catch{$('savingsTotal').textContent='—';$('savingsExplanation').textContent=value===''?'Enter a daily amount to explore it.':'Enter a valid daily amount with up to two decimals.';}
}
function ohioNowMinute(){const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());return today()+'T'+p.find(x=>x.type==='hour').value+':'+p.find(x=>x.type==='minute').value;}
function dateTimeOK(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(v)&&dateOK(v.slice(0,10));}
function restockTimeText(v){if(!dateTimeOK(v))return '';const date=new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(v.slice(0,10)+'T12:00:00Z'));const hour=Number(v.slice(11,13));return date+' · '+(hour%12||12)+v.slice(13,16)+' '+(hour<12?'AM':'PM')+' Ohio time';}
function renderRestocks(){
  const notes=state.deliveryNotes||[];
  $('restockNotes').innerHTML=notes.length?[...notes].sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)).map(n=>'<article class="item"><div class="itemtop"><div><strong>'+e(n.store)+'</strong><div class="small muted">'+(n.kind==='confirmed'?'Store-confirmed expected time':'You observed a restock')+'</div></div><button class="subtle" data-action="delete-restock" data-id="'+e(n.id)+'" aria-label="Delete restock note">Remove</button></div><p class="body-note small">'+e(restockTimeText(n.when))+'</p><p class="small no-margin">'+e(n.source)+'</p><p class="fine muted body-note">Saved '+e(n.recordedAt)+'. '+(n.kind==='confirmed'?'Plans can change; confirm with the store.':'Your observation, not a published schedule.')+'</p></article>').join(''):'<div class="empty"><strong>No store times saved.</strong>Add a time only when a store confirms it or you personally observe a restock.</div>';
  const recentStart=new Date(today()+'T12:00:00Z');recentStart.setUTCDate(recentStart.getUTCDate()-90);const threshold=recentStart.toISOString().slice(0,10);
  const groups=new Map();for(const n of notes.filter(n=>n.kind==='observed'&&n.when.slice(0,10)>=threshold&&n.when<=ohioNowMinute())){const k=n.store.trim().toLowerCase();if(!groups.has(k))groups.set(k,[]);groups.get(k).push(n);}
  const patterns=[];for(const list of groups.values()){
    const unique=[...new Map(list.map(n=>[n.when.slice(0,10),n])).values()];if(unique.length<3)continue;
    const weekdays=new Map();for(const n of unique){const d=new Date(n.when.slice(0,10)+'T12:00:00Z').getUTCDay();if(!weekdays.has(d))weekdays.set(d,[]);weekdays.get(d).push(n);}
    const [day,observations]=[...weekdays].sort((a,b)=>b[1].length-a[1].length)[0];if(observations.length<3||observations.length/unique.length<.6)continue;
    const days=['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'],hours=observations.map(n=>Number(n.when.slice(11,13))).sort((a,b)=>a-b),min=hours[0],max=hours.at(-1),hour=h=>(h%12||12)+(h<12?' AM':' PM');
    const range=max-min<=4?' around '+(min===max?hour(min):hour(min)+'–'+hour(max)):'';
    patterns.push('<div class="notice info"><strong>'+e(list[0].store)+': your observed pattern</strong><br>'+days[day]+range+' · '+observations.length+' of '+unique.length+' distinct restock days you recorded in the last 90 days.<br><span class="small">Historical estimate from your notes only. It does not confirm the next delivery.</span></div>');
  }
  $('restockPatterns').innerHTML=patterns.join('');
}
let selectedCatalogGame=null,catalogGames=[],catalogAsOf='',ticketCatalogNumber=null;
function applyCatalogGame(match,fromScan=false){
  if(!match||!Number.isSafeInteger(match.unitPriceCents)||match.unitPriceCents<=0)return;
  selectedCatalogGame=match;ticketCatalogNumber=String(match.gameNumber);$('game').value='Scratch-off';$('detail').value=match.name+' · #'+match.gameNumber;
  const quantity=Math.max(1,Number($('ticketQuantity').value)||1);$('cost').value=(match.unitPriceCents*quantity/100).toFixed(2);
  $('ticketAutoInfo').hidden=false;$('ticketAutoInfo').textContent=(fromScan?'Matched an official game UPC. ':'Official game selected. ')+match.name+' · '+money(match.unitPriceCents)+' per ticket. Confirm the total you paid before saving.';
  const sourceLink=document.createElement('a');sourceLink.href=match.source;sourceLink.target='_blank';sourceLink.rel='noopener noreferrer';sourceLink.textContent=' Official game · checked '+match.asOf+' ↗';$('ticketAutoInfo').append(sourceLink);
  $('catalogPicker').open=false;
}
function renderCatalog(){
  const q=$('catalogSearch').value.trim().toLowerCase(),matches=catalogGames.filter(g=>!q||g.name.toLowerCase().includes(q)||String(g.gameNumber).includes(q));
  $('catalogResults').innerHTML=matches.slice(0,30).map(g=>'<button type="button" class="catalog-result secondary" data-action="select-catalog-game" data-game-number="'+e(g.gameNumber)+'"><span><strong>'+e(g.name)+'</strong><small>#'+e(g.gameNumber)+(g.catalogStatus==='historical-publication'?' · Older game reference':'')+'</small></span><b>'+money(g.unitPriceCents)+'</b></button>').join('')||'<p class="small muted">No matching game. You can still enter the price manually.</p>';
  $('catalogStatus').textContent=catalogGames.length?catalogGames.length+' official game references · checked '+catalogAsOf+' · '+(q?matches.length+' matches':'Search to narrow the list')+'. Prices are per ticket.':'Game reference unavailable. You can enter the game and price yourself.';
}
$('spendingYear').addEventListener('change',renderYearly);$('savingsDaily').addEventListener('input',renderSavings);$('savingsYears').addEventListener('change',renderSavings);
$('catalogSearch').addEventListener('input',renderCatalog);
$('ticketQuantity').addEventListener('input',()=>{const n=Number($('ticketQuantity').value);if(selectedCatalogGame&&Number.isSafeInteger(n)&&n>=1&&n<=100000)$('cost').value=(selectedCatalogGame.unitPriceCents*n/100).toFixed(2);});
$('game').addEventListener('change',()=>{selectedCatalogGame=null;ticketCatalogNumber=null;$('ticketAutoInfo').hidden=true;});
$('restockForm').addEventListener('submit',ev=>{ev.preventDefault();try{const when=$('restockTime').value,kind=$('restockKind').value,store=$('restockStore').value.trim(),source=$('restockSource').value.trim();if(!store||!source)throw Error('Enter a store and how you confirmed the time.');if(!dateTimeOK(when))throw Error('Enter a valid date and time.');if(kind==='observed'&&when>ohioNowMinute())throw Error('Record a past or current observation. Use an expected time for a planned delivery.');state.deliveryNotes.push({id:uid(),store,kind,when,source,recordedAt:today()});$('restockForm').reset();changed('Store note saved.');}catch(err){toast(err.message);}});
document.addEventListener('click',ev=>{const b=ev.target.closest('button');if(!b)return;if(b.dataset.action==='select-catalog-game'){const g=catalogGames.find(g=>String(g.gameNumber)===b.dataset.gameNumber);if(g)applyCatalogGame(g);}if(b.dataset.action==='delete-restock'&&confirm('Remove this restock note?')){state.deliveryNotes=state.deliveryNotes.filter(n=>n.id!==b.dataset.id);changed('Restock note removed.');}});
window.JoeTicketIntelligence?.ready().then(data=>{catalogGames=data.games||[];catalogAsOf=data.asOf||'';renderCatalog();renderScanGameOptions();}).catch(()=>{renderCatalog();renderScanGameOptions();});
renderSavings();

window.JoeTicketsBridge=Object.freeze({
 tickets:()=>JSON.parse(JSON.stringify(state.tickets)),scans:()=>JSON.parse(JSON.stringify(state.ticketScans||[])),get:id=>{const t=state.tickets.find(t=>t.id===id);return t?JSON.parse(JSON.stringify(t)):null;},
 saveScan:row=>{const clean=window.JoeTicketDesk.validateDetails([row],state.tickets.map(t=>t.id))[0];state.ticketScans=(state.ticketScans||[]).filter(r=>r.ticketId!==row.ticketId);state.ticketScans.push(clean);const ok=persist();render();return ok;},
 review:(id,row,total)=>{const ticket=state.tickets.find(t=>t.id===id);if(!ticket)return false;const clean=window.JoeTicketDesk.validateDetails([row],[id])[0];state.ticketScans=(state.ticketScans||[]).filter(r=>r.ticketId!==id);state.ticketScans.push(clean);ticket.game=clean.draw.game;if(total!==null){ticket.cost=amountOK(total);delete ticket.pricePending;}const ok=persist();render();return ok;},
 notifications:()=>!!state.settings.resultsNotifications,setNotifications:value=>{state.settings.resultsNotifications=!!value;const ok=persist();render();return ok;},refresh:render,navigate:setView,toast
});
document.addEventListener('click',ev=>{if(ev.target.closest('[data-action="quick-scan"]')){setView('scan');window.JoeScanner?.startCamera();}});
resetTicket();resetScratch();resetStore();$('monthlyLimit').value=state.settings.monthlyLimit===null?'':state.settings.monthlyLimit/100;$('paused').checked=state.settings.paused;renderNumberRules();render();

// Lewis reads computed totals locally; raw ticket records never leave this bridge.
window.JoeLewisBridge=Object.freeze({
  summary(period=today().slice(0,4)){
    const now=today(),year=/^\d{4}$/.test(String(period))?String(period):now.slice(0,4);
    const tickets=state.tickets.filter(t=>t.date<=now&&(period==='all'||(period==='month'?t.date.startsWith(now.slice(0,7)):t.date.startsWith(year+'-'))));
    const totals=sum(tickets);
    return {year,spentCents:totals.spent,collectedCents:totals.collected,unclaimedCents:totals.unclaimed,netCents:totals.collected-totals.spent,unpricedTicketCount:totals.unpriced,ticketCount:tickets.reduce((n,t)=>n+(t.quantity||1),0),purchaseCount:tickets.length,monthlyLimitCents:state.settings.monthlyLimit,monthSpentCents:monthSpent()};
  },
  navigate:view=>setView(view),
  generate:method=>generateForLewis(method)
});
renderPickMethodInfo();
window.JoeRecentPicks?.ready().then(renderPickMethodInfo).catch(renderPickMethodInfo);

// Cache the app shell for Android home-screen use. External map imagery stays online.
if('serviceWorker' in navigator && location.protocol!=='file:'){
  window.addEventListener('load',()=>navigator.serviceWorker.register(new URL('sw.js',document.baseURI)).catch(()=>{}),{once:true});
}

if(new URL(location.href).searchParams.get('tickets')==='1')setView('tickets');

// Keep this browser's tabs on the same saved v1 collection.
window.addEventListener('storage',event=>{if(event.key!==KEY||!event.newValue)return;try{state=validate(JSON.parse(event.newValue));render();toast('Records updated from another tab.');}catch(_){toast('Another tab saved unreadable data. Existing records in this tab were kept.');}});

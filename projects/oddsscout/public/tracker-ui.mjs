import {BOOKS,eventStatus,formatOdds,money} from './lib/odds.mjs';
import {initializeIdentity,identityAction,identitySnapshot,onIdentityChange,hasAuthCallback,processIdentityEmailLink} from './lib/identity-client.mjs';
import {makeSavedBet,singleSnapshot,validateBet,recordPlacement,recordSettlement,parseCash,parseAcceptedOdds,ledgerSummary,ledgerCSV,betNet,pickKey,SETTLED_STATUSES} from './lib/bets.mjs';
/** UI has two explicitly separate stores: local demo/guest and private signed-in cloud. */
export function mountTracker({state,toast,esc,openModal,persist,saved,redraw}){
 const el=id=>document.getElementById(id);
 let account=null,accountChecked=false,accountConfigured=false,accountStorageUnavailable=false,cloud=[],busy=false,mode='real',lastBoardMode=null,filter='saved',editing=null,authMode='login',sessionRefresh=null,initFlight=null,loadSeq=0,profile=null,cloudLoaded=false,cloudError='',identitySettings=null,inviteToken=null,authInitializing=false,publishedIdentity=undefined;
 const localKey=m=>m==='demo'?'os-bets-demo-v4':'os-bets-guest-v4';
 const readLocal=m=>{const x=saved(localKey(m),[]);if(!Array.isArray(x))return [];return x.flatMap(r=>{try{const b=validateBet(r);return b.mode===m?[b]:[];}catch{return [];}});};
 let demoRows=readLocal('demo'),guestRows=readLocal('real');
 const standalone=()=>globalThis.__ODDSSCOUT_PREVIEW__===true||location.protocol==='file:';
 const rows=()=>mode==='demo'?demoRows:account?cloud:guestRows;
 const currentMode=()=>state.staticMode?'demo':'real';
 const errorText=e=>e?.message||'The operation failed. No change was confirmed.';
 function message(text,error=false){el('tracker-message').textContent=text;el('tracker-message').classList.toggle('tracker-error',error);}
 async function request(path,options={},retry=true){
  if(standalone())throw new Error('Account sync is available only after deploying the full project and configuring account services. This HTML preview saves on this browser only.');
  let res;try{res=await fetch(path,{...options,credentials:'same-origin',headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},signal:AbortSignal.timeout(20000)});}catch{throw new Error('Account connection unavailable. Cloud changes have NOT been saved. Reconnect and retry.');}
  if(res.status===401){const guard=await res.clone().json().catch(()=>({}));if(guard.code==='ROOM_LOCKED'){location.reload();throw new Error('Enter the access code again.');}}
  if(res.status===401&&retry&&path!=='/api/account'){
   if(!sessionRefresh)sessionRefresh=identityAction('refresh').finally(()=>sessionRefresh=null);
   await sessionRefresh;return request(path,options,false);
  }
  if(!res.headers.get('content-type')?.includes('application/json'))throw new Error('Account API is missing or returned HTML. Deploy the full project including /api/account and /api/my-bets.');
  const data=await res.json();if(!res.ok){const err=new Error(data.error||`Request failed (${res.status}).`);err.code=data.code;throw err;}return data;
 }
 async function loadCloud(){
  if(!account)return;const identity=account.id,seq=++loadSeq;let offset=0,all=[];cloudError='';
  try{
   while(offset!==null){
    if(all.length>=10000)throw new Error('History exceeds 10,000 loaded records. No partial totals are being shown; export or archive records first.');
    const data=await request('/api/my-bets?offset='+offset);if(!Array.isArray(data.records)||!(data.nextOffset===null||Number.isInteger(data.nextOffset)&&data.nextOffset>offset))throw new Error('Invalid cloud history response.');
    all.push(...data.records.map(r=>({...validateBet(r),_version:r._version})));offset=data.nextOffset;
   }
   if(account?.id!==identity||seq!==loadSeq)return;
   cloud=[...new Map(all.map(r=>[r.id,r])).values()];cloudLoaded=true;render();redraw();
  }catch(error){if(account?.id===identity){cloudError=errorText(error);render();}throw error;}
 }
 function publishAccount(){const identity=account?.id||null;if(publishedIdentity===identity)return;publishedIdentity=identity;window.dispatchEvent(new CustomEvent('os-account-change',{detail:{user:account?{...account}:null,profile:profile?{...profile}:null}}));}
 async function ensureAccount(force=false){
  if(standalone()||accountChecked&&!force)return;
  if(initFlight)return initFlight;
  initFlight=(async()=>{
   const data=await request('/api/account',{},false);
   accountConfigured=Boolean(data.configured);accountStorageUnavailable=data.provider==='netlify'&&(data.storageConfigured===false||Boolean(data.storageError));profile=data.profile||null;
   if(data.provider==='netlify'&&data.configured){
    const identity=await initializeIdentity();identitySettings=identity.settings;
    // The server remains the authority for private data. Never trust only client metadata.
    const verified=await request('/api/account',{},false);
    const next=verified.user||null;
    if(account?.id!==next?.id){cloud=[];cloudLoaded=false;cloudError='';loadSeq++;}
    account=next;accountStorageUnavailable=verified.provider==='netlify'&&(verified.storageConfigured===false||Boolean(verified.storageError));profile=verified.profile||null;
   }else{account=null;cloud=[];cloudLoaded=false;cloudError='';}
   accountChecked=true;publishAccount();if(account)await loadCloud();render();
  })().finally(()=>initFlight=null);
  return initFlight;
 }
 async function store(record){
  const b=validateBet(record);
  if(b.mode==='demo'){
   const next=[b,...demoRows.filter(r=>r.id!==b.id)];if(!persist(localKey('demo'),next))throw new Error('Browser storage is unavailable or full. Nothing was saved. Export or free storage before trying again.');demoRows=next;
  }else{
   await ensureAccount();
   if(account){if(!cloudLoaded)await loadCloud();const old=cloud.find(r=>r.id===b.id);const data=await request('/api/my-bets',{method:old?'PATCH':'POST',body:JSON.stringify({record:b,...(old?{version:old._version}:{})})});cloud=[data.record,...cloud.filter(r=>r.id!==b.id)];}
   else {const next=[b,...guestRows.filter(r=>r.id!==b.id)];if(!persist(localKey('real'),next))throw new Error('Browser storage is unavailable or full. Nothing was saved.');guestRows=next;}
  }
  render();redraw();return b;
 }
 async function remove(id){const record=rows().find(r=>r.id===id);if(!record)return;
  if(!window.confirm(record.status==='saved'?'Remove this saved idea?':'Delete this self-reported bet and remove it from your totals? This cannot be undone.'))return;
  if(mode==='real'&&account){await request('/api/my-bets',{method:'DELETE',body:JSON.stringify({id,version:record._version})});cloud=cloud.filter(r=>r.id!==id);}
  else{const next=rows().filter(r=>r.id!==id);if(!persist(localKey(mode),next))throw new Error('The deletion could not be saved.');if(mode==='demo')demoRows=next;else guestRows=next;}
  render();redraw();message('Record removed.');
 }
 function findPick(key,m=currentMode()){const set=m==='demo'?demoRows:account?cloud:guestRows;return set.find(b=>b.sourceKey===key);}
 function pickButton(event,group,book=null){
  const key=pickKey([{eventId:event.id,groupId:group.id}]),existing=findPick(key),phase=eventStatus(event);
  const available=Boolean(group.best)&&['live','upcoming'].includes(phase)&&!(state.feedFailed&&!state.staticMode);
  return `<button class="button like-bet ${existing?'is-liked':''}" data-like-event="${esc(event.id)}" data-like-group="${esc(group.id)}" data-like-market="${esc(group.market)}" ${book?`data-like-book="${esc(book)}"`:''} aria-pressed="${Boolean(existing)}" aria-label="${existing?'Open saved bet':'Save selection'}: ${esc(group.label||group.name)}" ${(Number(saved('os-break-until',0))>Date.now()||!available)&&!existing?'disabled':''}><span aria-hidden="true">☆</span> ${existing?(existing.status==='saved'?'Saved':'In My Bets'):(phase==='live'?'Save live bet':'Save bet')}</button>`;
 }
 async function like(eventId,groupId,market,book,suppliedEvent=null){
  mode=currentMode();if(mode==='real')await ensureAccount();
  const existing=findPick(pickKey([{eventId,groupId}]),mode);if(existing){filter=existing.status==='saved'?'saved':existing.status==='open'?'open':'settled';await open();return;}
  if(Number(saved('os-break-until',0))>Date.now())throw new Error('Research saving is paused during your break. Your existing history stays available.');
  if(navigator.onLine===false&&!state.staticMode)throw new Error('Reconnect before saving a new price.');
  if(state.feedFailed&&!state.staticMode&&!suppliedEvent)throw new Error('Refresh the odds feed successfully before saving a new price.');
  const event=suppliedEvent?.id===eventId?suppliedEvent:state.board?.events.find(e=>e.id===eventId);if(!event)throw new Error('This game is no longer on the board. Refresh first.');
  const leg=singleSnapshot(event,groupId,market,state.bookKeys,book||null);
  const bet=makeSavedBet([leg],{demo:state.staticMode});await store(bet);filter='saved';toast(mode==='demo'?'👍 Saved to the DEMO tracker. No bet was placed.':'👍 Saved to My Bets. Record the accepted stake after placing it in the sportsbook.');
 }
 async function saveParlay(ticket,comparison){
  if(busy)return;busy=true;try{
   if(!comparison.ok||!comparison.best)throw new Error('Refresh the research ticket first.');mode=currentMode();if(mode==='real')await ensureAccount();
   const legs=ticket.map(l=>{
    const event=state.board?.events.find(e=>e.id===l.event.id)||l.event;
    return singleSnapshot(event,l.groupId,l.market||l.group?.market||'h2h',state.bookKeys,comparison.best.book);
   });
   const existing=findPick(pickKey(legs),mode);if(!existing)await store(makeSavedBet(legs,{demo:state.staticMode}));filter='saved';await open();toast('Research ticket saved. Its parlay price is an estimate—not an accepted wager.');
  }catch(e){toast(errorText(e));}finally{busy=false;}
 }
 function summaryHTML(){
  const s=ledgerSummary(rows(),mode),prefix=mode==='demo'?'Demo ':'',values=[['Net profit',money(s.net),s.net<0?'negative':''],['Total returned',money(s.totalReturned),''],['Settled stakes',money(s.settledStake),''],['Open stakes',money(s.openStake),''],['Won / lost',`${s.won} / ${s.lost}`,''],['ROI',s.roi===null?'—':`${s.roi.toFixed(1)}%`,s.net<0?'negative':'']];
  return values.map(([label,value,cls])=>`<div class="tracker-stat ${cls}"><span>${prefix}${label}</span><strong>${value}</strong></div>`).join('');
 }
 function rowHTML(b){
  const net=betNet(b),settled=net!==null,live=b.placedPhase==='live'||(b.status==='saved'&&b.legs.some(l=>l.phase==='live'));
  const label=b.status==='cashout'?'Cashout / adjusted':b.status==='open'?'Placed · pending':b.status==='saved'?'Saved idea':b.status[0].toUpperCase()+b.status.slice(1);
  return `<article class="tracker-row" data-bet-id="${esc(b.id)}"><div class="tracker-row-top"><div class="tracker-tags"><span class="tracker-tag ${b.status}">${label}</span>${live?'<span class="tracker-tag live">In-play snapshot</span>':''}${b.mode==='demo'?'<span class="tracker-tag demo">FICTIONAL DEMO</span>':'<span class="tracker-tag">Self-reported</span>'}</div><button class="text-button tracker-delete" data-delete-bet="${esc(b.id)}" aria-label="${b.status==='saved'?'Remove saved idea':'Delete bet record'}">${b.status==='saved'?'Remove save':'Delete'}</button></div>
   <h3>${b.legs.map(l=>esc(l.label)).join(' + ')}</h3><p class="tracker-matchup">${b.legs.map(l=>esc(l.matchup)).join(' · ')}</p>
   <div class="tracker-money"><span><b>${esc(b.bookTitle)}</b> · ${b.status==='saved'?`saved quote ${formatOdds(b.quotedDecimal,state.format)}${b.legs.length>1?' (estimated parlay)':''}`:`accepted ${formatOdds(b.acceptedDecimal,state.format)} · stake ${money(b.stake)}`}</span>${settled?`<strong class="${net<0?'negative':'positive'}">${net>=0?'+':''}${money(net)} net</strong>`:b.status==='open'?'<strong>Result pending</strong>':'<strong>Not a placed bet</strong>'}</div>
   <details class="tracker-snapshot"><summary>Original price, score & timestamps</summary>${b.legs.map(l=>`<p><b>${esc(l.label)}</b><br>${esc(l.bookTitle)} · ${formatOdds(l.decimal,state.format)} · quote ${esc(new Date(l.quoteAt).toLocaleString())}<br>${l.phase==='live'?`Score when saved: ${esc(l.score||'Unavailable')}<br>Score timestamp: ${esc(l.scoreUpdatedAt?new Date(l.scoreUpdatedAt).toLocaleString():'unavailable')}`:'Saved before the scheduled start.'}</p>`).join('')}<p>Saved ${esc(new Date(b.savedAt).toLocaleString())}${b.placedAt?` · placed ${esc(new Date(b.placedAt).toLocaleString())}`:''}${b.settledAt?` · settled ${esc(new Date(b.settledAt).toLocaleString())}`:''}</p>${settled?`<p>Total returned including stake: ${money(b.returnAmount)}. Net = returned − stake.</p>`:''}${b.notes?`<p>Note: ${esc(b.notes)}</p>`:''}<p>Saved odds are historical. No sportsbook account or result verification is performed.</p></details>
   <div class="tracker-row-actions">${b.status==='saved'?`<button class="button primary" data-place-bet="${esc(b.id)}">${mode==='demo'?'Simulate placed bet':'Record placed bet'}</button>`:`<button class="button primary" data-settle-bet="${esc(b.id)}">${settled?'Correct result':'Record result'}</button>${b.status==='open'?`<button class="button" data-place-bet="${esc(b.id)}">Edit placement</button>`:''}`}${BOOKS[b.book]?.url?`<a class="button" href="${esc(BOOKS[b.book].url)}" target="_blank" rel="noopener noreferrer">Open ${esc(b.bookTitle)} ↗</a>`:''}</div></article>`;
 }
 function render(){
  if(!el('tracker-dialog'))return;el('tracker-mode').value=mode;
  const list=rows(),s=ledgerSummary(list,mode),visible=list.filter(b=>filter==='all'||filter==='settled'?filter==='all'||SETTLED_STATUSES.includes(b.status):b.status===filter);
  el('tracker-stats').innerHTML=account&&!cloudLoaded?'<p class="tracker-error">Account totals are unavailable until the full history loads. Press Sync to retry.</p>':summaryHTML();
  el('tracker-storage').textContent=mode==='demo'?'Fictional demo · saved in this browser only':account?`Private account · ${account.email} · press Sync to load changes from other devices`:'Guest mode · this browser only · anyone using this browser profile can see these records';
  el('tracker-disclaimer').textContent=mode==='demo'?'Fictional money and sample events only. Demo records never enter real-account totals.':'Based only on cash bets you record here. These are self-reported results, not verified earnings or proof OddsScout caused a profit. Saved ideas and pending returns do not count as winnings.';
  el('tracker-math').textContent=account&&!cloudLoaded?'No partial account totals are shown.':`${s.saved} saved ideas · ${s.open} pending · ${s.settled} settled. Net = returned cash minus settled stakes. ROI = net ÷ settled stakes (including fully refunded pushes/voids). Open stakes are separate; taxes, fees, free bets and bonuses are excluded.`;
  el('tracker-rows').innerHTML=account&&!cloudLoaded?`<div class="tracker-empty"><h3>Cloud history could not load.</h3><p>${esc(cloudError||'Checking your account history…')}</p><button class="button" id="tracker-retry-cloud">Retry cloud history</button></div>`:visible.map(rowHTML).join('')||`<div class="tracker-empty"><span aria-hidden="true">👍</span><h3>${filter==='saved'?'Save the bets you want to revisit.':'No records in this view.'}</h3><p>Thumbs-up an exact selection on the board. Then record its accepted stake and, later, the sportsbook result.</p><button class="button" data-close="tracker-dialog">Back to games</button></div>`;
  if(account&&cloudError)message((cloudLoaded?'Showing the last loaded account history. ':'')+cloudError,true);
  document.querySelectorAll('[data-bet-filter]').forEach(b=>{b.classList.toggle('active',b.dataset.betFilter===filter);b.setAttribute('aria-pressed',String(b.dataset.betFilter===filter));});
  el('tracker-account').textContent=account?'Account':'Sign in / create account';el('tracker-sync').classList.toggle('hidden',!account||mode==='demo');el('tracker-import').classList.toggle('hidden',!account||!guestRows.length||mode==='demo');el('tracker-export').disabled=!list.length;
  window.dispatchEvent(new CustomEvent('os-ledger-change'));
  document.querySelectorAll('[data-my-bets-count]').forEach(e=>e.textContent=String(list.length));
 }
 async function open(){mode=currentMode();render();openModal('tracker');message('');try{if(mode==='real')await ensureAccount();render();}catch(e){message(errorText(e),true);}}
 function localDate(iso){const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
 function openPlacement(id){
  const b=rows().find(r=>r.id===id);if(!b)return;editing=id;el('place-title').textContent=mode==='demo'?'Simulate a placed bet':'Record a bet you already placed';
  el('place-selection').textContent=b.legs.map(l=>l.label).join(' + ');el('place-note').textContent=b.legs.length>1?'The saved parlay price is only a product of single-leg prices. Enter the actual combined odds accepted on your sportsbook receipt.':'The saved price may have changed. Check your receipt and enter the actual accepted odds, stake and phase.';
  el('place-book').innerHTML=Object.entries({...BOOKS,...Object.fromEntries(rows().map(r=>[r.book,{name:r.bookTitle}]))}).map(([k,v])=>`<option value="${esc(k)}">${esc(v.name)}</option>`).join('');el('place-book').value=b.book;
  el('place-stake').value=b.stake??'';el('place-format').value=state.format;el('place-odds').value=formatOdds(b.acceptedDecimal||b.quotedDecimal,state.format);
  el('place-time').value=localDate(b.placedAt||new Date().toISOString());el('place-phase').value=b.placedPhase|| (b.legs.some(l=>l.phase==='live')?'live':'upcoming');el('place-notes').value=b.notes||'';
  el('place-confirm').checked=false;el('place-confirm-label').textContent=mode==='demo'?'This is a fictional simulation. No money is being wagered.':'I already placed this exact selection in the sportsbook and checked its accepted odds, stake and market rules.';el('place-error').textContent='';openModal('place');
 }
 function openSettlement(id){const b=rows().find(r=>r.id===id);if(!b)return;editing=id;el('settle-selection').textContent=b.legs.map(l=>l.label).join(' + ');el('settle-status').value=b.status==='open'?'won':b.status;el('settle-return').value=b.returnAmount??Math.round(b.stake*b.acceptedDecimal*100)/100;el('settle-confirm').checked=false;el('settle-error').textContent='';settleFields();openModal('settle');}
 function settleFields(){const b=rows().find(r=>r.id===editing);if(!b)return;const s=el('settle-status').value;el('settle-return').disabled=['lost','push','void','open'].includes(s);if(s==='lost')el('settle-return').value=0;if(['push','void'].includes(s))el('settle-return').value=b.stake;
  el('settle-help').textContent=s==='open'?'Reopening removes this record from settled profit until you record its result again.':'Enter the TOTAL cash returned, including any returned stake—not just the profit. Cashout / adjusted supports partial payouts; bonus/free-bet accounting is not supported.';}
 function authRender(){
  const settings=identitySettings||identitySnapshot().settings;
  const storageWarning=el('account-storage-warning');storageWarning.classList.toggle('hidden',!accountStorageUnavailable);storageWarning.textContent=accountStorageUnavailable?'Sign-in is available, but cloud bet tracking, community likes, chat and shared winnings are unavailable until preview storage is configured. Guest bet records stay on this browser.':'';
  el('account-current').textContent=account?accountStorageUnavailable?`Signed in as ${account.email}. Account storage is currently unavailable.`:`Signed in as ${account.email}. Your saved bets and results are private. Sharing winnings is off unless you choose it.`:accountStorageUnavailable?'Sign in or create your OddsScout account. Cloud history and community features are waiting for preview storage setup.':standalone()?'This offline file saves on this browser only. Accounts require the full hosted app.':accountChecked&&!accountConfigured?'Accounts are not configured on this preview yet. Your guest saves stay on this browser.':'Use an OddsScout account to sync your history across devices.';
  el('auth-form').classList.toggle('hidden',Boolean(account)&&authMode!=='password');el('account-logout').classList.toggle('hidden',!account);el('account-password').classList.toggle('hidden',!account);el('auth-options').classList.toggle('hidden',Boolean(account));
  const isPassword=['login','signup','password','invite'].includes(authMode),emailNeeded=['login','signup','recover'].includes(authMode);
  el('auth-email-wrap').classList.toggle('hidden',!emailNeeded);el('auth-email').required=emailNeeded;
  el('auth-password-wrap').classList.toggle('hidden',!isPassword);el('auth-password').required=isPassword;el('auth-password').minLength=authMode==='login'?1:12;el('auth-password').autocomplete=authMode==='login'?'current-password':'new-password';
  el('auth-name-wrap').classList.toggle('hidden',authMode!=='signup');el('auth-name').required=authMode==='signup';
  el('auth-code-wrap').classList.add('hidden');el('auth-code').required=false;el('auth-age-wrap').classList.toggle('hidden',authMode!=='signup');el('auth-age').required=authMode==='signup';
  const labels={login:'Sign in',signup:'Create private account',recover:'Send recovery email',password:'Save new password',invite:'Accept invitation & set password'};
  el('auth-submit').textContent=authInitializing?'Checking account…':labels[authMode];el('account-title').textContent=authMode==='password'?'Set your password':account?'Your private account':labels[authMode];el('auth-submit').disabled=authInitializing||standalone()||(accountChecked&&!accountConfigured)||(authMode==='signup'&&settings?.disableSignup===true);
  document.querySelectorAll('[data-auth-mode="signup"]').forEach(b=>b.disabled=settings?.disableSignup===true);
  const oauth=el('auth-providers');if(oauth){oauth.innerHTML=Object.entries(settings?.providers||{}).filter(([name,enabled])=>enabled&&name!=='email').map(([name])=>`<button type="button" class="button full-width" data-auth-provider="${esc(name)}">Continue with ${esc(name[0].toUpperCase()+name.slice(1))} ↗</button>`).join('');oauth.classList.toggle('hidden',Boolean(account)||!oauth.children.length);}
 }
 async function openAccount(){openModal('account');el('auth-error').textContent='';authInitializing=true;authRender();try{await ensureAccount(true);}catch(e){el('auth-error').textContent=errorText(e);}finally{authInitializing=false;authRender();}}
 async function importGuest(){if(!account||!guestRows.length)return;if(!window.confirm(`Copy ${guestRows.length} guest records from this browser into ${account.email}? Only do this for YOUR records. Duplicates are skipped; demo records are excluded.`))return;
  let copied=0;for(const record of guestRows){if(cloud.some(r=>r.id===record.id))continue;await store(record);copied++;}message(`${copied} guest records copied. Original browser copies remain until you remove them while signed out.`);}
 async function run(action){if(busy)return;busy=true;document.body.classList.add('tracker-busy');try{await action();}catch(e){message(errorText(e),true);toast(errorText(e));}finally{busy=false;document.body.classList.remove('tracker-busy');}}
 document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.likeEvent){run(()=>like(b.dataset.likeEvent,b.dataset.likeGroup,b.dataset.likeMarket,b.dataset.likeBook));return;}
  if(b.dataset.open==='tracker'){open();return;}
  if(b.dataset.betFilter){filter=b.dataset.betFilter;render();return;}
  if(b.dataset.placeBet){openPlacement(b.dataset.placeBet);return;}if(b.dataset.settleBet){openSettlement(b.dataset.settleBet);return;}
  if(b.dataset.deleteBet){run(()=>remove(b.dataset.deleteBet));return;}
  if(b.id==='tracker-account'||b.dataset.open==='account'){openAccount();return;}
  if(b.dataset.authProvider){run(()=>identityAction('oauth',{provider:b.dataset.authProvider}));return;}
  if(b.id==='tracker-sync'||b.id==='tracker-retry-cloud'){run(async()=>{await loadCloud();message('Cloud history refreshed.');});return;}
  if(b.id==='tracker-import'){run(importGuest);return;}
  if(b.id==='tracker-export'){
   const a=document.createElement('a'),url=URL.createObjectURL(new Blob([ledgerCSV(rows())],{type:'text/csv;charset=utf-8'}));a.href=url;a.download=`OddsScout-${mode}-self-reported-bets.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
  }
  if(b.dataset.authMode){authMode=b.dataset.authMode;el('auth-error').textContent='';el('auth-password').value='';authRender();return;}
  if(b.id==='account-password'){authMode='password';authRender();return;}
  if(b.id==='account-logout'){run(async()=>{await identityAction('logout');account=null;profile=null;cloud=[];cloudLoaded=false;cloudError='';loadSeq++;accountChecked=true;publishAccount();authMode='login';authRender();render();redraw();el('auth-error').textContent='Signed out. Cloud records are no longer shown on this device.';});return;}
 });
 el('tracker-mode').addEventListener('change',async e=>{mode=e.target.value;filter='saved';message('');try{if(mode==='real')await ensureAccount();}catch(err){message(errorText(err),true);}render();});
 el('place-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;el('place-submit').disabled=true;try{const b=rows().find(r=>r.id===editing);const next=recordPlacement(b,{stake:parseCash(el('place-stake').value,{positive:true}),decimal:parseAcceptedOdds(el('place-odds').value,el('place-format').value),book:el('place-book').value,placedAt:new Date(el('place-time').value).toISOString(),phase:el('place-phase').value,notes:el('place-notes').value,confirmed:el('place-confirm').checked});await store(next);filter='open';render();el('place-dialog').close();message(mode==='demo'?'Demo placement recorded. No actual bet was placed.':'Your self-reported placement is recorded. No bet was submitted by OddsScout.');}catch(err){el('place-error').textContent=errorText(err);}finally{busy=false;el('place-submit').disabled=false;}});
 el('place-format').addEventListener('change',()=>{const b=rows().find(r=>r.id===editing);el('place-odds').value=formatOdds(b?.acceptedDecimal||b?.quotedDecimal,el('place-format').value);});
 el('settle-status').addEventListener('change',settleFields);
 el('settle-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;el('settle-submit').disabled=true;try{const b=rows().find(r=>r.id===editing);const next=recordSettlement(b,el('settle-status').value,el('settle-return').disabled?0:parseCash(el('settle-return').value,{max:100000000}),{confirmed:el('settle-confirm').checked});await store(next);filter=next.status==='open'?'open':'settled';render();el('settle-dialog').close();message('Self-reported result saved. Totals have been recalculated.');}catch(err){el('settle-error').textContent=errorText(err);}finally{busy=false;el('settle-submit').disabled=false;}});
 el('account-email-link-form').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;busy=true;el('account-email-link-submit').disabled=true;el('auth-error').textContent='Checking the account link…';
  try{state.selectedId=null;const result=await processIdentityEmailLink(el('account-email-link').value.trim());el('account-email-link').value='';accountChecked=false;await ensureAccount(true);
   if(result?.type==='recovery')authMode='password';else if(result?.type==='invite'){inviteToken=result.token;authMode='invite';}else authMode='login';
   authRender();render();redraw();el('auth-error').textContent=result?.type==='recovery'?'Choose a new password.':result?.type==='invite'?'Choose a password to accept your invitation.':'Email confirmed. Your private account is ready.';
  }catch(err){el('auth-error').textContent=errorText(err);}finally{busy=false;el('account-email-link-submit').disabled=false;}
 });
 el('auth-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;el('auth-submit').disabled=true;el('auth-error').textContent='';const action=authMode;try{
  if(action==='signup'&&!el('auth-age').checked)throw new Error('Confirm that you are 21 or older before creating an account.');
  const fields={email:el('auth-email').value.trim(),password:el('auth-password').value,displayName:el('auth-name').value.trim(),ageConfirmed:el('auth-age').checked,token:inviteToken};
  const data=await identityAction(action,fields);el('auth-password').value='';el('auth-code').value='';
  if(data.user){accountChecked=false;await ensureAccount(true);authMode='login';inviteToken=null;}
  authRender();render();redraw();el('auth-error').textContent=action==='recover'?'If this email has an account, check its inbox for a recovery link. Open that link to set a new password.':action==='signup'&&!data.user?'Check your inbox and confirm your email, then return here to sign in.':action==='password'?'Password updated.':data.user?'Signed in. Your private cloud history is loaded.':'Check your inbox, then sign in.';
 }catch(err){el('auth-error').textContent=errorText(err);}finally{busy=false;authRender();}});
 window.addEventListener('storage',e=>{if([localKey('demo'),localKey('real')].includes(e.key)){demoRows=readLocal('demo');guestRows=readLocal('real');render();redraw();}});
 function update(){const next=currentMode();if(next!==lastBoardMode){mode=next;lastBoardMode=next;filter='saved';}if(!['place-dialog','settle-dialog','account-dialog'].some(id=>el(id)?.open))render();}
 // Netlify Identity owns token exchanges and cookie/session refresh.
 let refreshingFromIdentity=false;
 onIdentityChange(async(event,snapshot)=>{
  if(['ready','error','refresh'].includes(event)||refreshingFromIdentity)return;
  if(event==='logout'){account=null;profile=null;cloud=[];cloudLoaded=false;cloudError='';loadSeq++;accountChecked=true;publishAccount();render();redraw();return;}
  if(account?.id===snapshot.user?.id&&event==='token_refresh')return;
  refreshingFromIdentity=true;try{accountChecked=false;await ensureAccount(true);authRender();render();redraw();}catch(e){message(errorText(e),true);}finally{refreshingFromIdentity=false;}
 });
 async function startIdentity(){
  if(standalone())return;
  const callbackPending=hasAuthCallback();
  if(callbackPending){state.selectedId=null;authInitializing=true;openModal('account');authRender();el('auth-error').textContent='Confirming your account link…';}
  try{
   const config=await request('/api/account',{},false);accountStorageUnavailable=config.provider==='netlify'&&(config.storageConfigured===false||Boolean(config.storageError));
   if(!config.configured||config.provider!=='netlify'){accountConfigured=Boolean(config.configured);accountChecked=true;render();return;}
   const snapshot=await initializeIdentity();identitySettings=snapshot.settings;
   if(snapshot.user||callbackPending)await ensureAccount(true);
   if(snapshot.callback){
    const result=snapshot.callback;state.selectedId=null;
    if(result.type==='invite'){inviteToken=result.token;authMode='invite';}
    else if(result.type==='recovery')authMode='password';
    authRender();openModal('account');el('auth-error').textContent=result.type==='recovery'?'Choose a new password.':result.type==='invite'?'Choose a password to accept your invitation.':'Email confirmed. You are signed in.';
   }
  }catch(e){if(callbackPending){history.replaceState(null,'',location.pathname+location.search);el('auth-error').textContent=errorText(e);}}
  finally{authInitializing=false;authRender();}
 }
 setTimeout(startIdentity,0);
 render();return {update,pickButton,saveParlay,records:()=>structuredClone(rows()),privateRecords:()=>structuredClone(account?cloud:guestRows),account:()=>account?{...account}:null,profile:()=>profile?{...profile}:null,ensureAccount,request,openAccount,sync:loadCloud,saveSelection:async(event,group)=>{await like(event.id,group.id,group.market,null,event);redraw();}};
}

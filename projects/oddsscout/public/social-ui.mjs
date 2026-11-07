import {ledgerSummary} from './lib/bets.mjs';
import {money} from './lib/odds.mjs';

/** Public social features are deliberately separate from the private bet ledger and Scout analysis. */
export function mountSocial({tracker,toast,esc,openModal,persist,saved}){
 const el=id=>document.getElementById(id);
 let winnings=null,winningsBusy=false,winningsError='',chatRows=[],chatBusy=false,chatError='',chatLoaded=false,chatCursor=null,chatTimer=null,posting=false,profileBusy=false,requestEpoch=0;
 const muteKey='os-muted-chat-authors-v1';
 let muted=new Set(Array.isArray(saved(muteKey,[]))?saved(muteKey,[]):[]);
 const dialog=(id,eyebrow,title,body)=>`<dialog id="${id}-dialog" class="modal social-dialog"><div class="modal-heading"><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div><button class="icon-btn" data-close="${id}-dialog" aria-label="Close ${title}">×</button></div>${body}</dialog>`;
 el('social-dialogs').innerHTML=dialog('winnings','YOUR RECORDS · CLEAR ACCOUNTING','All Winnings',`
  <p class="social-intro">Your full recorded history, with returns and profit shown separately. Losses always count.</p>
  <div class="social-tabs" role="group" aria-label="Winnings views"><button class="active" data-winnings-view="personal" aria-pressed="true">My all-time totals</button><button data-winnings-view="community" aria-pressed="false">Community totals</button></div>
  <div id="winnings-personal"><p id="winnings-storage" class="small-print"></p><div id="winnings-personal-stats" class="tracker-stats"></div><p id="winnings-personal-note" class="small-print"></p><button class="button primary" data-open="tracker">Manage my bets & results ↗</button></div>
  <div id="winnings-community" class="hidden"><div id="winnings-community-body"></div><button class="button" id="winnings-refresh">Refresh totals ↻</button></div>
  <p id="winnings-status" class="social-status" role="status"></p>
  <section id="sharing-settings" class="sharing-settings"><h3>Your public profile</h3><p>Private by default. Sharing adds your display name and all-time totals to the community view. Your individual bets, notes and email stay private.</p><form id="sharing-form"><label for="profile-name">Public display name</label><input id="profile-name" autocomplete="nickname" minlength="1" maxlength="32" required placeholder="Choose a name, not an email"><label class="ledger-check"><input id="profile-public" type="checkbox"><span>Share my self-reported totals with other signed-in users. I can turn sharing off at any time.</span></label><button class="button" id="sharing-submit">Save sharing preferences</button></form></section>
  <p class="tracker-disclaimer">Self-reported cash wagers only. Net profit = total cash returned − settled stakes. Returns include any returned stake. Saved ideas and pending payouts are excluded. No sportsbook verification or claim that OddsScout caused a profit. Taxes, fees and bonus bets are excluded.</p>
 `)+dialog('chat','TALK WITH OTHER MEMBERS','Community Chat',`
  <p class="social-intro">A shared room for signed-in OddsScout users. Messages are visible to other members. Keep account details and private information out of chat.</p>
  <div class="chat-toolbar"><span id="chat-connection" class="small-print">Sign in to join the conversation.</span><button class="button" id="chat-refresh">Refresh ↻</button><button class="text-button" data-open="account">Your account ↗</button></div>
  <div id="chat-auth-gate" class="social-empty"><span aria-hidden="true">☷</span><h3>A conversation, not a prediction feed.</h3><p>Sign in to read and post with the community. Chat activity never changes Scout’s analysis or a bet’s price.</p><button class="button primary" data-open="account">Sign in / create account</button></div>
  <div id="chat-member-content" class="hidden"><button class="text-button hidden" id="chat-older">Load earlier messages</button><div id="chat-messages" class="chat-messages" aria-label="Community messages" aria-busy="false"></div><p id="chat-status" class="social-status" role="status"></p><form id="chat-form"><label for="chat-body">Your message</label><textarea id="chat-body" rows="3" maxlength="1000" required placeholder="Join the conversation…"></textarea><div class="chat-compose-bottom"><span id="chat-counter" class="small-print">0 / 1,000</span><button class="button primary" id="chat-send">Send message ↗</button></div></form><p class="small-print">No harassment, spam, private data or guaranteed-win claims. Public opinions are unverified. You can delete your own messages or mute another member on this browser.</p><button class="text-button hidden" id="chat-clear-mutes">Show muted members again</button></div>
 `);
 // These shortcuts remain reachable on small screens, where the sidebar is hidden.
 const shortcuts=document.createElement('section');shortcuts.className='social-shortcuts';shortcuts.setAttribute('aria-label','Your account and community');shortcuts.innerHTML='<button class="button" data-open="winnings"><span aria-hidden="true">↗</span> All Winnings</button><button class="button" data-open="chat"><span aria-hidden="true">☷</span> Community Chat</button><button class="text-button" data-open="account">Sign in / account ↗</button>';
 el('dash-cards').insertAdjacentElement('beforebegin',shortcuts);
 let winningsView='personal';
 function statsHTML(s,{community=false}={}){
  const values=[['Net profit',money(s.net),s.net<0?'negative':s.net>0?'positive':''],['Total returned',money(s.totalReturned),''],['Settled stakes',money(s.settledStake),''],...(community?[]:[['Pending stakes',money(s.openStake||0),'']]),['Won / lost',`${Number(s.won)||0} / ${Number(s.lost)||0}`,''],['ROI',s.roi===null||!Number.isFinite(s.roi)?'—':`${s.roi.toFixed(1)}%`,s.net<0?'negative':'']];
  return values.map(([label,value,cls])=>`<div class="tracker-stat ${cls}"><span>${label}</span><strong>${esc(value)}</strong></div>`).join('');
 }
 function empty(title,text,signIn=false){return `<div class="social-empty"><h3>${title}</h3><p>${esc(text)}</p>${signIn?'<button class="button primary" data-open="account">Sign in / create account</button>':''}</div>`;}
 function renderWinnings(){
  const account=tracker.account(),local=ledgerSummary(tracker.privateRecords(),'real'),s=account?winnings?.own:local;
  el('winnings-storage').textContent=account?'Private account · all recorded dates · press Refresh to load other devices':'Guest history · this browser only. Sign in to sync your own records across devices.';
  el('winnings-personal-stats').innerHTML=s?statsHTML(s):empty('Your totals are loading','No incomplete account totals will be shown.');
  el('winnings-personal-note').textContent=s?`${Number(s.settled)||0} settled records · ${Number(s.open)||0} pending · ${Number(s.saved)||0} saved ideas. A saved idea is not a placed bet.`:'';
  el('winnings-personal').classList.toggle('hidden',winningsView!=='personal');el('winnings-community').classList.toggle('hidden',winningsView!=='community');
  document.querySelectorAll('[data-winnings-view]').forEach(b=>{b.classList.toggle('active',b.dataset.winningsView===winningsView);b.setAttribute('aria-pressed',String(b.dataset.winningsView===winningsView));});
  el('winnings-status').textContent=winningsBusy?'Loading full recorded totals…':winningsError;
  el('winnings-status').classList.toggle('ledger-error',Boolean(winningsError));
  el('sharing-settings').classList.toggle('hidden',!account);el('winnings-refresh').disabled=winningsBusy;
  if(!account)el('winnings-community-body').innerHTML=empty('Community totals are shared by choice','Sign in to see only the members who opted in. Private records do not appear here.',true);
  else if(winnings?.community){
   const c=winnings.community,leaders=Array.isArray(c.leaderboard)?c.leaderboard:[];
   el('winnings-community-body').innerHTML=`<p class="small-print">${Number(c.participants)||0} members currently sharing · USD · self-reported. This is an opt-in sample, not all user results.</p><div class="tracker-stats">${statsHTML(c.summary,{community:true})}</div><h3>Members sharing totals</h3>${leaders.length?`<div class="winnings-leaderboard">${leaders.map((r,i)=>`<article class="winnings-member"><span class="member-rank">${i+1}</span><div><strong>${esc(r.displayName)}</strong><p>${Number(r.settled)||0} settled · ${Number(r.won)||0} wins / ${Number(r.lost)||0} losses<br>Returned ${money(r.totalReturned)} · stake ${money(r.settledStake)}</p></div><strong class="${r.net<0?'negative':r.net>0?'positive':''}">${money(r.net)}<small>net profit</small></strong></article>`).join('')}</div>`:empty('No shared results yet','Members can choose to share their all-time totals. Nobody is included automatically.')}<p class="small-print">Updated ${esc(new Date(winnings.fetchedAt).toLocaleString())}. Ranking by recorded net profit is not a measure of betting skill or future performance.</p>`;
  }else el('winnings-community-body').innerHTML=empty(winningsBusy?'Loading community totals…':'Community totals unavailable',winningsError||'Refresh to load members who opted in.');
 }
 async function loadWinnings(){
  if(winningsBusy)return;winningsBusy=true;winningsError='';renderWinnings();const epoch=requestEpoch;
  try{await tracker.ensureAccount();if(!tracker.account()){winnings=null;return;}const data=await tracker.request('/api/winnings');if(epoch!==requestEpoch)return;if(!data.own||!data.community?.summary)throw new Error('The totals response is incomplete. Please retry.');winnings=data;
   if(document.activeElement!==el('profile-name'))el('profile-name').value=data.profile?.displayName||'';
   el('profile-public').checked=data.profile?.winningsPublic===true;
  }catch(e){winningsError=e.message||'Totals could not load. Reconnect and retry.';}
  finally{winningsBusy=false;renderWinnings();}
 }
 function renderChat(){
  const account=tracker.account();el('chat-auth-gate').classList.toggle('hidden',Boolean(account));el('chat-member-content').classList.toggle('hidden',!account);
  el('chat-connection').textContent=!account?'Sign in to join the conversation.':navigator.onLine===false?'Offline · messages have not been sent':chatError?'Connection needs attention':chatBusy?'Checking messages…':'Shared room · updates every 15 seconds while open';
  el('chat-refresh').disabled=chatBusy;el('chat-messages').setAttribute('aria-busy',String(chatBusy));
  const shown=chatRows.filter(r=>!muted.has(r.authorId||r.authorKey||''));
  el('chat-messages').innerHTML=shown.length?shown.map(r=>`<article class="chat-message ${r.own?'own':''}"><div class="chat-message-heading"><strong>${esc(r.displayName||'Member')}${r.own?' <span>You</span>':''}</strong><time datetime="${esc(r.createdAt)}">${esc(new Date(r.createdAt).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))}</time></div><p>${esc(r.body)}</p><div class="chat-message-actions">${r.own?`<button class="text-button" data-chat-delete="${esc(r.id)}">Delete my message</button>`:(r.authorId||r.authorKey)?`<button class="text-button" data-chat-mute="${esc(r.authorId||r.authorKey)}">Mute member on this browser</button><button class="text-button" data-chat-report="${esc(r.id)}">Report</button>`:''}</div></article>`).join(''):empty(chatBusy&&!chatLoaded?'Loading messages…':chatError&&!chatLoaded?'Messages unavailable':muted.size?'No unmuted messages':'No messages yet',chatBusy&&!chatLoaded?'Checking the shared room.':chatError&&!chatLoaded?'Reconnect and press Refresh. No replacement conversation is shown.':'Start a respectful conversation. Only actual member messages appear here.');
  el('chat-status').textContent=posting?'Sending your message…':chatError;
  el('chat-status').classList.toggle('ledger-error',Boolean(chatError));el('chat-send').disabled=posting||!account||navigator.onLine===false;
  el('chat-older').classList.toggle('hidden',!chatCursor);el('chat-older').disabled=chatBusy;
  el('chat-clear-mutes').classList.toggle('hidden',!muted.size);
 }
 async function loadChat({older=false}={}){
  if(chatBusy||!el('chat-dialog').open||document.visibilityState==='hidden')return;
  chatBusy=true;chatError='';renderChat();const epoch=requestEpoch;
  try{
   await tracker.ensureAccount();if(!tracker.account())return;
   const data=await tracker.request('/api/chat'+(older&&chatCursor?'?before='+encodeURIComponent(chatCursor):''));if(epoch!==requestEpoch)return;
   if(!Array.isArray(data.messages))throw new Error('Messages are unavailable. Please retry.');
   chatRows=older?[...data.messages,...chatRows].filter((r,i,all)=>all.findIndex(x=>x.id===r.id)===i):data.messages;
   chatCursor=data.nextCursor||null;chatLoaded=true;
  }catch(e){chatError=e.message||'Chat could not connect. Your message has not been sent.';}
  finally{chatBusy=false;renderChat();}
 }
 function scheduleChat(){clearTimeout(chatTimer);if(el('chat-dialog').open&&document.visibilityState!=='hidden')chatTimer=setTimeout(async()=>{await loadChat();scheduleChat();},15000);}
 async function openChat(){openModal('chat');renderChat();await loadChat();scheduleChat();}
 document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.open==='winnings'){openModal('winnings');renderWinnings();await loadWinnings();return;}
  if(b.dataset.open==='chat'){openChat();return;}
  if(b.dataset.winningsView){winningsView=b.dataset.winningsView;renderWinnings();if(winningsView==='community'&&!winnings&&!winningsBusy)loadWinnings();return;}
  if(b.id==='winnings-refresh'){await loadWinnings();return;}
  if(b.id==='chat-refresh'){await loadChat();scheduleChat();return;}
  if(b.id==='chat-older'){await loadChat({older:true});return;}
  if(b.dataset.chatDelete){
   if(!window.confirm('Delete your message from the shared room?'))return;
   try{await tracker.request('/api/chat',{method:'DELETE',body:JSON.stringify({id:b.dataset.chatDelete})});chatRows=chatRows.filter(r=>r.id!==b.dataset.chatDelete);renderChat();toast('Your message was deleted.');}catch(err){chatError=err.message;renderChat();}return;
  }
  if(b.dataset.chatReport){
   const reason=window.prompt('Report this message for review. Briefly describe the concern (up to 300 characters).');if(reason===null)return;
   if(!reason.trim()||reason.length>300){toast('Enter a short reason of 1–300 characters.');return;}
   try{const result=await tracker.request('/api/chat',{method:'POST',body:JSON.stringify({action:'report',id:b.dataset.chatReport,reason:reason.trim()})});if(result.reported!==true)throw new Error('The server did not confirm your report.');toast(result.message||'Your report was saved for review.');}catch(err){chatError=err.message;renderChat();}return;
  }
  if(b.dataset.chatMute){muted.add(b.dataset.chatMute);if(!persist(muteKey,[...muted]))toast('This mute lasts until this page closes because browser storage is unavailable.');renderChat();return;}
  if(b.id==='chat-clear-mutes'){muted.clear();persist(muteKey,[]);renderChat();}
 });
 el('chat-form').addEventListener('submit',async e=>{
  e.preventDefault();if(posting)return;
  const body=el('chat-body').value.trim();if(!body||body.length>1000)return;
  if(!tracker.account()){tracker.openAccount();return;}
  posting=true;chatError='';renderChat();const epoch=requestEpoch;
  try{const data=await tracker.request('/api/chat',{method:'POST',body:JSON.stringify({body})});if(epoch!==requestEpoch)return;if(!data.message?.id)throw new Error('The server did not confirm your message. Refresh before trying again.');chatRows=[...chatRows.filter(r=>r.id!==data.message.id),data.message];el('chat-body').value='';el('chat-counter').textContent='0 / 1,000';chatLoaded=true;
  }catch(err){chatError=err.message||'Message could not be sent. Your draft is still here.';}
  finally{posting=false;renderChat();}
 });
 el('chat-body').addEventListener('input',()=>{el('chat-counter').textContent=`${el('chat-body').value.length.toLocaleString()} / 1,000`;});
 el('sharing-form').addEventListener('submit',async e=>{
  e.preventDefault();if(profileBusy)return;profileBusy=true;el('sharing-submit').disabled=true;winningsError='';
  try{const data=await tracker.request('/api/winnings',{method:'POST',body:JSON.stringify({displayName:el('profile-name').value.trim(),winningsPublic:el('profile-public').checked})});if(!data.profile)throw new Error('The server did not confirm your preference. Please retry.');toast(data.profile.winningsPublic?'Your display name and totals are now shared with members.':'Your totals are private.');await loadWinnings();}
  catch(err){winningsError=err.message;renderWinnings();}finally{profileBusy=false;el('sharing-submit').disabled=false;}
 });
 el('chat-dialog').addEventListener('close',()=>clearTimeout(chatTimer));
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')clearTimeout(chatTimer);else if(el('chat-dialog').open){loadChat();scheduleChat();}});
 window.addEventListener('offline',()=>{clearTimeout(chatTimer);renderChat();});
 window.addEventListener('online',()=>{if(el('chat-dialog').open){loadChat();scheduleChat();}});
 window.addEventListener('os-ledger-change',()=>{if(el('winnings-dialog').open&&!tracker.account())renderWinnings();});
 window.addEventListener('os-account-change',e=>{
  requestEpoch++;winnings=null;winningsError='';chatRows=[];chatLoaded=false;chatCursor=null;chatError='';el('chat-body').value='';el('chat-counter').textContent='0 / 1,000';
  shortcuts.querySelector('[data-open="account"]').textContent=e.detail?.user?'Your account ↗':'Sign in / account ↗';renderWinnings();renderChat();
  // A login may complete in a stacked account dialog; request only when the shared view is visible.
  if(e.detail?.user&&el('winnings-dialog').open)setTimeout(loadWinnings,0);
  if(e.detail?.user&&el('chat-dialog').open)setTimeout(loadChat,0);
 });
 renderWinnings();renderChat();
 return {openChat,loadWinnings};
}

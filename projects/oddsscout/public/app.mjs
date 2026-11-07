import {mountTracker} from './tracker-ui.mjs';
import {mountSocial} from './social-ui.mjs';
import {mountResearch} from './research-ui.mjs';
import {FORM_LEAGUES} from './lib/parlays.mjs';
import {BOOKS,MARKET_NAMES,compareGroups,primaryGroups,groupLabel,formatOdds,money,payout,timeAgo,eventStatus,explainComparison,bestAppVerdict} from './lib/odds.mjs';
import {mergeLeaguePage,matchesDate,sportLabel,sportSymbol} from './lib/board.mjs';
import {mountUpgrade} from './upgrade-ui.mjs';
import {mountCalendar} from './calendar-ui.mjs';
import {sportsbookLink,resolveSportsbook} from './lib/sportsbooks.mjs';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function saved(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function persist(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
try{sessionStorage.removeItem('os-room');}catch{/* Storage may be disabled. */}
function roomCode(){return '';}
let entryDeadline=0,entryTimer=null,lockingEntry=false;
function checkEntryExpiry(){if(entryDeadline&&Date.now()>=entryDeadline){stopAuto();location.reload();}}
function setEntryExpiry(value){clearTimeout(entryTimer);entryDeadline=Date.parse(value)||0;if(entryDeadline)entryTimer=setTimeout(checkEntryExpiry,Math.max(0,entryDeadline-Date.now()+100));}
async function lockEntry(){if(lockingEntry)return;lockingEntry=true;try{const r=await fetch('/api/access',{method:'DELETE',credentials:'same-origin',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('The app could not be locked. Please retry.');try{sessionStorage.removeItem('os-room');}catch{/* Storage may be disabled. */}stopAuto();location.reload();}catch(e){lockingEntry=false;toast(e.message);}}
window.addEventListener('focus',checkEntryExpiry);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkEntryExpiry();});
const initialLeague=new URLSearchParams(location.search).get('league')||'all';
const savedBooks=saved('os-books',null), savedFavorites=saved('os-favorites',[]);
const state={board:null,config:null,sports:[],connection:'checking',bootBusy:false,retryAt:0,apiStatus:{},aiVerified:false,staticMode:false,league:/^[a-z][a-z0-9_]{0,90}$/.test(initialLeague)?(initialLeague==='upcoming'?'all':initialLeague):'all',market:'h2h',status:'all',sport:'all',date:'all',controller:null,loadingText:'',search:'',view:'board',format:saved('os-format','american'),bookKeys:null,myBooks:Array.isArray(savedBooks)?savedBooks:[],bookMode:'all',favorites:new Set(Array.isArray(savedFavorites)?savedFavorites:[]),selectedId:/^#(?:confirmation_token|recovery_token|invite_token|email_change_token|access_token|error)=/.test(location.hash)?null:location.hash.slice(1),groupId:null,stake:25,busy:false,askBusy:false,lastFetchAttempt:0,fetchSeq:0,askSeq:0,feedFailed:false};
if(!['american','decimal'].includes(state.format))state.format='american';
let autoTimer=null,toastTimer=null;
const expandedBooks=new Set();
const currentEvent=()=>state.board?.events.find(e=>e.id===state.selectedId);
const groupsFor=e=>{
 const groups=compareGroups(e,state.market,{bookKeys:state.bookKeys});
 // A failed refresh/offline state must never continue advertising a best live price.
 if(state.feedFailed&&!state.staticMode)return groups.map(g=>({...g,quotes:g.quotes.map(q=>({...q,fresh:false})),freshQuotes:[],best:null,worst:null,ties:[],comparable:false}));
 return groups;
};
const currentGroup=()=>{const groups=currentEvent()?groupsFor(currentEvent()):[];return groups.find(g=>g.id===state.groupId)||groups[0];};
function toast(text){$('toast').textContent=text;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),3500);}
function openModal(name){const d=$(`${name}-dialog`);if(d&&!d.open)d.showModal();}
function setError(text){$('error-banner').textContent=text||'';$('error-banner').classList.toggle('hidden',!text);}
function invalidateAnswer(){state.askSeq++;state.askBusy=false;$('ask-submit').disabled=false;$('answer').textContent='Select a line, then ask Scout to explain the price comparison.';$('answer-note').textContent='';}
function updateConfigUI(){
 const demo=state.staticMode&&state.board?.mode==='demo';
 const hasBoard=state.board?.mode==='live';
 // Feed freshness is independent of the user's sportsbook checkboxes.
 const feedGroups=hasBoard?state.board.events.flatMap(e=>compareGroups(e,state.market)):[];
 const hasFresh=feedGroups.some(g=>g.best),hasQuotes=feedGroups.some(g=>g.quotes.length);
 const offline=navigator.onLine===false;
 const stale=hasBoard&&hasQuotes&&!hasFresh;
 const mode=demo?'demo':offline?'offline':state.feedFailed||state.connection==='unavailable'?'unavailable':state.connection==='missing'?'missing':state.connection==='locked'?'locked':stale?'stale':hasBoard?'live':'checking';
 const labels={demo:'Fictional demo',offline:'Offline',unavailable:'Feed unavailable',missing:'Setup required',locked:'Private room',stale:'Stale quotes',live:'Provider data',checking:'Checking connection'};
 $('feed-pill').className=`feed-pill ${mode}`;
 $('feed-pill').innerHTML=`<i></i>${labels[mode]}`;
 $('notice').className=`notice ${mode==='live'?'live-notice':''}`;
 const copy={
 demo:'<strong>FICTIONAL DEMO</strong> Fictional games and prices. Not a live feed.',
 live:'<strong>PROVIDER DATA · NOT INSTANT</strong> Prices may lag. Verify the exact bet in the sportsbook.',
 stale:'<strong>STALE QUOTES</strong> Returned prices are too old to rank. No best price is being claimed for old data.',
 offline:'<strong>YOU ARE OFFLINE</strong> No new odds can load. Any previous real-data snapshot is unverified and not ranked.',
 unavailable:'<strong>CONNECTION UNAVAILABLE</strong> No new provider data has loaded. The app will not substitute fictional odds.',
 missing:'<strong>REAL ODDS NEED SETUP</strong> The backend is reachable, but ODDS_API_KEY has not been configured.',
 locked:'<strong>PRIVATE ROOM</strong> Enter the shared room code to load the feed. Never enter a provider API key here.',
 checking:'<strong>CHECKING THE CONNECTION</strong> A configured key alone does not prove that live data works.'
 };
 $('notice').innerHTML=`<div>${copy[mode]}</div><div class="notice-actions">${demo?'<button class="text-button" data-retry>Exit demo & connect ↗</button>':mode==='live'?'<button class="text-button" data-open="settings">Connection details ↗</button>':'<button class="text-button" data-retry>Retry connection ↻</button>'}</div>`;
 $('assistant-mode').textContent=demo?'Rules-based · fictional data':state.aiVerified?'AI response verified this session':state.config?.aiEnabled?'AI configured · not yet verified':'Rules-based explainer · no AI';
 const returnedBooks=new Map((state.board?.events||[]).flatMap(e=>(e.bookmakers||[]).map(b=>[b.key,b.title])));
 const configBooks=[...new Set([...Object.keys(BOOKS),...returnedBooks.keys()])];
 $('book-options').innerHTML=configBooks.map(k=>{const b=resolveSportsbook(k,returnedBooks.get(k));return `<label class="book-option"><input type="checkbox" value="${esc(k)}" data-book ${state.myBooks.includes(k)?'checked':''}><img src="${esc(b.logo)}" alt="" width="28" height="28" loading="lazy"><span>${esc(b.name)}<small>${returnedBooks.has(k)?'Returned by provider':b.providerKey?'No current quote':'Provider unsupported'}</small></span></label>`;}).join('');
 $('setup-status').textContent=`Data: ${labels[mode]}. Odds key: ${state.config?.oddsConfigured?'configured, not a connectivity guarantee':'not confirmed'}. AI: ${state.config?.aiEnabled?'key configured':'not configured'}. Room code: ${state.config?.roomLocked?'required':'not required or not checked'}.`;
 $('connection-checks').innerHTML=['config','sports','board','ask','form'].map(name=>`<div class="connection-row"><code>/api/${name}</code><span>${esc(state.apiStatus[name]||'Not checked')}</span></div>`).join('');
 $('auto-refresh').disabled=demo||!hasBoard||state.feedFailed||offline;
 $('favorites-count').textContent=state.favorites.size;
}
function renderUnavailable(title,message){
 $('games').innerHTML=`<div class="empty-state connection-empty"><span class="empty-symbol">↗</span><h3>${esc(title)}</h3><p>${esc(message)}</p><div class="empty-actions"><button class="button primary" data-retry>Retry connection</button><button class="button" data-open="settings">View setup</button></div></div>`;
 $('selection-detail').innerHTML='<div class="detail-placeholder">Connect the odds feed to compare source-dated sportsbook prices for a game.</div>';
 $('ask-submit').disabled=true;
}
function populateLeagues(){
 const popular=['americanfootball_nfl','americanfootball_ncaaf','basketball_nba','basketball_ncaab','icehockey_nhl','baseball_mlb','soccer_epl'];
 const sorted=[...state.sports,...(state.futures||[])].sort((a,b)=>{const order=k=>popular.includes(k)?popular.indexOf(k):100;return order(a.key)-order(b.key)||a.title.localeCompare(b.title);});
 $('league').innerHTML='<option value="all">All leagues</option>'+sorted.map(s=>`<option value="${esc(s.key)}">${esc(s.title)}</option>`).join('');
 if(!sorted.some(s=>s.key===state.league)&&state.league!=='all')state.league='all';
 $('league').value=state.league;
 const groups=[...new Set(sorted.map(s=>s.group))];
 $('sport-chips').innerHTML='<button class="sport-chip active" data-sport="all">All sports</button>'+groups.map(group=>`<button class="sport-chip" data-sport="${esc(group)}"><span aria-hidden="true">${sportSymbol(group)}</span>${esc(sportLabel(group))}</button>`).join('');
 const icons={americanfootball_nfl:'◒',basketball_nba:'⊕',baseball_mlb:'◉',icehockey_nhl:'▱',soccer_epl:'◎',americanfootball_ncaaf:'◒'};
 calendar.update();
 $('quick-leagues').innerHTML='<button class="quick-league" data-league="all"><span>▦</span>All leagues</button>'+popular.filter(k=>sorted.some(s=>s.key===k)).map(k=>`<button class="quick-league ${state.league===k?'active':''}" data-league="${k}"><span>${icons[k]}</span>${esc(sorted.find(s=>s.key===k).title)}</button>`).join('');
}
async function api(path,options={}){
 const name=path.split('?')[0].split('/').at(-1);
 const headers={...(options.body?{'Content-Type':'application/json'}:{}),...options.headers};
 let response;
 try{response=await fetch(path,{...options,headers,signal:options.signal||AbortSignal.timeout(30000)});}
 catch(error){if(error.name==='AbortError')throw error;state.apiStatus[name]='Network unavailable';throw new Error('The server could not be reached. Check your connection; no new odds were loaded.',{cause:error});}
 const retryHeader=response.headers.get('Retry-After');
 let retryAfter=Number(retryHeader)||Math.ceil((Date.parse(retryHeader)-Date.now())/1000)||60;
 retryAfter=Math.min(3600,Math.max(1,retryAfter));
 if(response.status===429)state.retryAt=Date.now()+retryAfter*1000;
 const type=response.headers.get('content-type')||'';
 state.apiStatus[name]=`HTTP ${response.status}${type.includes('application/json')?' · JSON':' · not JSON'}`;
 if(!type.includes('application/json')){
  if(response.status===429)throw new Error(`Too many requests. Wait ${retryAfter} seconds before trying again.`);
  throw new Error(`${path.split('?')[0]} returned ${response.status}${response.status===200?' HTML instead of JSON':''}. Deploy the complete Netlify project with its server functions; uploading only dist/ cannot connect live data.`);
 }
 let result;try{result=await response.json();}catch{throw new Error(`${path.split('?')[0]} returned unreadable JSON. No new data was loaded.`);}
 if(response.status===401&&result.code==='ROOM_LOCKED'){state.connection='locked';stopAuto();location.reload();throw new Error('Your entry session has expired. Enter the access code again.');}
 if(!response.ok){const error=new Error(result.error||'The request could not be completed.');error.code=result.code;throw error;}
 return result;
}
function stopAuto(){clearInterval(autoTimer);autoTimer=null;$('auto-refresh').checked=false;}
function clearBoard(){
 state.board=null;state.feedFailed=false;state.selectedId=null;state.groupId=null;invalidateAnswer();
 for(const id of ['stat-live','stat-books','stat-updated'])$(id).textContent='—';
 for(const id of ['live-count','upcoming-count','unknown-count'])$(id).textContent='0';
 $('stat-age').textContent='Not loaded';$('coverage-note').textContent='';
}
async function bootstrap(){
 if(state.bootBusy||state.busy)return;
 state.bootBusy=true;state.staticMode=false;state.connection='checking';state.config=null;state.apiStatus={};state.aiVerified=false;
 stopAuto();clearBoard();setError('');updateConfigUI();
 $('board-loading').classList.remove('hidden');$('games').innerHTML='';
 try{
  state.config=await api('/api/config',{signal:AbortSignal.timeout(12000)});
  if(![2,3].includes(state.config.apiVersion)||typeof state.config.oddsConfigured!=='boolean')throw new Error('The frontend and backend versions do not match. Deploy the entire updated project together.');
  setEntryExpiry(state.config.entryExpiresAt);
  if(!state.config.oddsConfigured){state.connection='missing';renderUnavailable('Connect your odds feed','The backend is online. Add ODDS_API_KEY in Netlify with Functions scope and redeploy. Fictional odds are never loaded automatically.');return;}
  if(state.config.roomLocked&&!state.config.entryAuthenticated&&!roomCode()){state.connection='locked';renderUnavailable('This board is private','Use the room code shared by the site owner.');location.reload();return;}
  await startFeed();
 }catch(e){state.connection='unavailable';state.feedFailed=true;setError(e.message);renderUnavailable('The odds feed is not connected',e.message);}
 finally{state.bootBusy=false;$('board-loading').classList.add('hidden');updateConfigUI();upgrade.update();}
}
async function startFeed(){
 try{
  const result=await api('/api/sports');
  if(!Array.isArray(result.sports))throw new Error('The sports catalog is invalid. No new odds were loaded.');
  state.sports=result.sports;state.futures=result.futures||[];populateLeagues();await refreshBoard(true);
 }catch(e){if(state.connection!=='locked')state.connection='unavailable';state.feedFailed=true;setError(e.message);renderUnavailable('The sports feed is unavailable',e.message);updateConfigUI();}
}
async function refreshBoard(force=false){
 if(state.busy)return;
 if(!state.staticMode&&Date.now()<state.retryAt){toast(`Provider cooldown: try again in ${Math.ceil((state.retryAt-Date.now())/1000)} seconds.`);return;}
 if(!state.staticMode&&navigator.onLine===false){state.feedFailed=true;stopAuto();setError('You are offline. Existing real quotes are not ranked.');renderAll();return;}
 if(!state.staticMode&&!state.config?.oddsConfigured){if(!state.bootBusy)await bootstrap();return;}
 if(!force&&Date.now()-state.lastFetchAttempt<10000){toast('Snapshots are cached for 60 seconds. Try refreshing again shortly.');return;}
 if(!state.staticMode&&state.league==='all'&&!state.config.allLeaguesAvailable){setError('Deploy the updated backend as well as the new design. The current server does not support all-league loading.');return;}
 state.busy=true;state.lastFetchAttempt=Date.now();const seq=++state.fetchSeq;
 const controller=new AbortController();state.controller=controller;
 document.body.classList.add('is-loading');$('refresh').disabled=true;setError('');
 state.loadingText=state.league==='all'?'Loading all active leagues…':'Loading this league…';
 $('board-loading').classList.remove('hidden');$('loading-label').textContent=state.loadingText;
 let assembled=null,received=false;
 const accept=board=>{
  if(!Array.isArray(board.events)||!Number.isFinite(Date.parse(board.fetchedAt))||!Array.isArray(board.configuredBooks)||board.mode!==(state.staticMode?'demo':'live'))throw new Error('The feed returned invalid data. Fictional data cannot replace the real feed.');
  if(state.board?.fetchedAt!==board.fetchedAt)invalidateAnswer();
  state.board=board;state.feedFailed=false;state.connection='ready';received=true;
  if(!currentEvent()){state.selectedId=board.events[0]?.id||null;state.groupId=null;invalidateAnswer();}
  renderAll();
 };
 try{
  if(state.league==='all'){
   let page=0;const seen=new Set();
   while(page!==null){
    if(seen.has(page)||!Number.isInteger(page)||page<0||seen.size>1000)throw new Error('The server returned an invalid league continuation.');
    seen.add(page);
    const part=await api(`/api/board?league=all&market=${state.market}&page=${page}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
    if(seq!==state.fetchSeq)return;
    if(!part.batch)throw new Error('All-league coverage information is missing. Deploy the full updated project.');
    assembled=mergeLeaguePage(assembled,part);accept(assembled);
    const info=assembled.coverageInfo;
    state.loadingText=`Loaded ${info.loaded.length} of ${info.total} leagues · ${assembled.events.length} games`;
    $('loading-label').textContent=state.loadingText;
    if(part.batch.halted){state.retryAt=Date.now()+(part.batch.halted.retryAfter||60)*1000;stopAuto();setError('The provider paused this scan. Loaded games remain visible; coverage is incomplete. Check the coverage details below.');}
    page=part.batch.nextPage;
   }
  }else accept(await api(`/api/board?league=${encodeURIComponent(state.league)}&market=${state.market}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])}));
 }catch(e){
  if(seq!==state.fetchSeq)return;
  stopAuto();invalidateAnswer();
  if(received){
   if(state.board.coverageInfo)state.board.coverageInfo.finished=false;
   setError(e.name==='AbortError'?'Scan stopped. Loaded games remain visible. Refresh to scan all leagues.':`${e.message} Some leagues have not loaded; coverage is incomplete.`);
   renderAll();
  }else{
   state.feedFailed=true;if(state.connection!=='locked')state.connection='unavailable';
   setError(`${e.message}${state.board?' The previous snapshot is for reference only; prices are not ranked.':''}`);
   updateConfigUI();if(state.board){renderGames();renderDetail();}else renderUnavailable('No new odds were loaded',e.message);
  }
 }finally{
  if(seq===state.fetchSeq){state.busy=false;state.controller=null;document.body.classList.remove('is-loading');$('refresh').disabled=false;$('board-loading').classList.add('hidden');$('games').classList.remove('hidden');if(state.board)renderStats();research.update();upgrade.update();}
 }
}
function renderStats(){
 $('favorites-count').textContent=state.favorites.size;
 if(!state.board)return;
 const events=state.board.events;
 for(const [status,id]of [['live','live-count'],['upcoming','upcoming-count'],['unknown','unknown-count']])$(id).textContent=events.filter(e=>eventStatus(e)===status).length;
 $('stat-live').textContent=events.length;$('live-stat-label').textContent=state.staticMode?'SAMPLE GAMES':'GAMES RETURNED';$('all-count').textContent=events.length;
 $('stat-books').textContent=new Set(events.flatMap(e=>e.bookmakers.filter(b=>b.markets.some(m=>m.key===state.market&&m.outcomes?.length)&&(state.bookKeys===null||state.bookKeys.includes(b.key))).map(b=>b.key))).size;
 $('stat-updated').textContent=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(new Date(state.board.fetchedAt));
 $('stat-age').textContent=`${timeAgo(state.board.fetchedAt)}${state.feedFailed?' · refresh failed':''}`;
 $('stat-updated').title=`Server fetched ${new Date(state.board.fetchedAt).toLocaleString()}. Individual quote times are shown in the comparison.`;
 $('favorites-count').textContent=state.favorites.size;
 const info=state.board.coverageInfo;
 const label=state.staticMode?'Fictional preview · no live schedule':info?`${info.loaded.length} / ${info.total} leagues loaded${info.loaded.length===info.total&&info.finished?' · scan complete':' · partial coverage'}`:`${state.board.events.length} games returned for this league`;
 $('coverage-summary').textContent=label;
 $('coverage-summary').classList.toggle('partial',Boolean(info&&(info.loaded.length<info.total||!info.finished)));
 const failures=(info?.failed||[]).map(f=>`${f.title}: ${f.error}`);
 $('coverage-note').textContent=[state.board.coverage,...(state.board.warnings||[]),...failures].join(' ');
 $('coverage-caption').textContent=state.staticMode?'Sample games only. Connect your odds feed for real fixtures.':'Provider listings only. Missing games or prices are not invented. All-league refresh uses more provider credits.';
 const remaining=state.board.usage?.remaining;
 $('usage-note').textContent=state.board.mode==='demo'?'Demo data · no provider credits used':`${$('auto-refresh').checked?'60-second refresh while visible':'Manual refresh · no background polling'}${remaining!=null?` · ${remaining.toLocaleString()} provider credits left at snapshot`:''}`;
}
function visibleEvents(){
 const term=state.search.trim().toLowerCase();
 const groupFor=e=>state.sports.find(s=>s.key===e.sport_key)?.group||'Other sports';
 const order={live:0,upcoming:1,unknown:2,completed:3};
 return (state.board?.events||[])
  .filter(e=>state.status==='all'||eventStatus(e)===state.status)
  .filter(e=>state.sport==='all'||groupFor(e)===state.sport)
  .filter(e=>matchesDate({...e,status:eventStatus(e)},state.date))
  .filter(e=>state.view!=='favorites'||state.favorites.has(e.id))
  .filter(e=>state.bookMode!=='best'||groupsFor(e).some(g=>g.best&&g.comparable))
  .filter(e=>!term||`${e.away_team||''} ${e.home_team||''} ${e.title||''} ${e.sport_title}`.toLowerCase().includes(term))
  .sort((a,b)=>(state.bookMode==='best'?priceGap(b)-priceGap(a):upgrade.priority(b)-upgrade.priority(a))||(order[eventStatus(a)]-order[eventStatus(b)])||Date.parse(a.commence_time)-Date.parse(b.commence_time));
}
function priceGap(event){return Math.max(0,...groupsFor(event).filter(g=>g.best&&g.comparable).map(g=>g.best.price-g.worst.price));}
const initials=name=>name?.split(' ').filter(Boolean).slice(0,3).map(p=>p[0]).join('').toUpperCase()||'—';
function renderBestApp(event,group){
 const verdict=bestAppVerdict(group),best=group.best;
 const label=group.market==='h2h'?`${group.name} to win`:groupLabel(group);
 const result=best?payout(state.stake,best.price):null;
 const gap=best&&group.comparable?state.stake*(best.price-group.worst.price):0;
 const ties=verdict.books.map(q=>q.title).join(' / ');
 const selectAttrs=`data-select-event="${esc(event.id)}" data-group="${esc(group.id)}"`;
 return `<div class="app-pick ${verdict.kind}" data-verdict="${verdict.kind}">
  <button class="pick-main" ${selectAttrs} aria-label="Compare ${esc(label)}">
   <span class="pick-selection">${esc(label)}</span>
   <span class="pick-verdict">${esc(verdict.label)}</span>
   <span class="pick-price"><span class="pick-book">${best?`<span class="book-mark ${esc(best.book)}" aria-hidden="true">${esc(BOOKS[best.book]?.tag||'↗')}</span>`:''}<strong>${esc(best?ties:'Odds unavailable')}</strong></span><b class="price">${esc(best?formatOdds(best.price,state.format):'—')}</b></span>
   <span class="pick-profit">${result?`${money(state.stake)} → <b>${money(result.profit)} profit</b> if it wins`:'No fresh prices to rank. Check back later.'}</span>
  </button>
  <div class="pick-bottom"><span>${best?`${group.freshQuotes.length} fresh app${group.freshQuotes.length===1?'':'s'} · ${esc(timeAgo(best.updatedAt))}`:'Not ranked'}${group.market==='h2h'?` · ${esc(group.scope.startsWith('3')?'3-way':'2-way')}`:''}</span><button class="text-button" ${selectAttrs}>Compare ↗</button></div>
  ${gap>0?`<div class="pick-improvement">${money(gap)} more profit vs. the lowest quote on this exact bet</div>`:''}
  ${state.bookMode!=='best'&&group.quotes.length?`<details class="quote-list" data-quote-list="${esc(event.id+'|'+group.id)}" ${expandedBooks.has(event.id+'|'+group.id)?'open':''}><summary>${group.quotes.length} book${group.quotes.length===1?'':'s'} · inspect prices <span aria-hidden="true">⌄</span></summary><div class="quote-rail" tabindex="0" aria-label="Sportsbook prices for ${esc(label)}">${group.quotes.map(q=>{const book=resolveSportsbook(q.book,q.title);return `<div class="quote-mini ${q.fresh&&q.price===best?.price?'best':''} ${!q.fresh?'stale':''}"><img src="${esc(book.logo)}" alt="" width="27" height="22" loading="lazy"><span>${esc(book.name)}</span><strong>${esc(formatOdds(q.price,state.format))}</strong><small>${esc(timeAgo(q.updatedAt))}${!q.fresh?' · excluded':''}</small></div>`;}).join('')}</div></details>`:''}
  ${tracker.pickButton(event,group)}${upgrade.selectionButtons(event,group)}
  ${best?`<div class="open-apps">${verdict.books.map(q=>sportsbookLink(q.book,q)?.url?`<a href="${esc(sportsbookLink(q.book,q).url)}" target="_blank" rel="noopener noreferrer">Open ${esc(q.title)} <span aria-hidden="true">↗</span></a>`:'').join('')}</div>`:''}
 </div>`;
}
function renderGame(event){
 const status=eventStatus(event),groups=primaryGroups(groupsFor(event)),demo=state.board.mode==='demo';
 const score=status==='live'&&Array.isArray(event.scores);
 const time=Number.isFinite(Date.parse(event.commence_time))?new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(event.commence_time)):'Start time not supplied by provider';
 const teams=(event.kind==='future'?[event.title||event.sport_title]:[event.away_team,event.home_team]).map((name,i)=>`<div class="team-line"><span class="team-logo" aria-hidden="true">${esc(initials(name))}</span><span class="team-name">${esc(name)}<small>${event.kind==='future'?'FUTURES':i===0?'AWAY':'HOME'}</small></span>${score?`<strong class="team-score">${esc(event.scores.find(s=>s.name===name)?.score??'—')}</strong>`:''}</div>`).join('');
 return `<article class="game-card ${state.selectedId===event.id?'selected':''}" data-event="${esc(event.id)}">
  <div class="game-topline"><div class="game-tags"><span class="status-tag ${status}">${status==='live'?'<i></i> LIVE':status==='upcoming'?'UPCOMING':'STATUS UNCONFIRMED'}</span>${demo?'<span class="demo-tag">SAMPLE</span>':''}</div><button class="star-button ${state.favorites.has(event.id)?'saved':''}" data-save="${esc(event.id)}" aria-label="${state.favorites.has(event.id)?'Unsave':'Save'} ${esc(event.away_team)} versus ${esc(event.home_team)}" aria-pressed="${state.favorites.has(event.id)}">${state.favorites.has(event.id)?'★':'☆'}</button></div>
  <div class="matchup">${teams}<p class="game-date">${esc(time)}${score?` · scores ${esc(timeAgo(event.scoreUpdatedAt))}`:''}</p></div>
  <div class="picks-heading"><span>BEST APP BY SELECTION</span><span>${esc(MARKET_NAMES[state.market])}</span></div>
  <div class="best-app-grid ${groups.length===3?'three-way':''}">${groups.length?(state.bookMode==='best'?groups.filter(g=>g.best&&g.comparable):groups).map(g=>renderBestApp(event,g)).join(''):'<div class="no-market"><strong>No odds published for this market.</strong><p>The game stays listed. Try another market or change your app filters.</p></div>'}</div>
  <div class="game-footer"><button class="text-button" data-center="${esc(event.id)}">Game center ↗</button>${FORM_LEAGUES[event.sport_key]?`<button class="text-button" data-form-event="${esc(event.id)}">Recent scores ↗</button>`:'<span>Compare exact lines</span>'}<span>${demo?'Fictional prices':'Verify line & rules in the app'}</span><button class="compare-link" data-select-event="${esc(event.id)}">All apps & lines <span>↗</span></button></div>
 </article>`;
}
function renderGames(){
 $('live-board-note').classList.toggle('hidden',state.status!=='live');
 if(!state.board)return;
 const events=visibleEvents();
 $('filters-show').textContent=`Show ${events.length} games`;
 $('board-title').innerHTML=`${state.view==='favorites'?'Your watchlist':state.status==='live'?'Live bets':'All games'} <span class="results-count">${events.length}</span>`;
 $('board-subtitle').textContent=state.view==='favorites'?'Saved on this device. Your filters still apply.':state.status==='live'?'Compare fresh in-play prices, then save the exact selection.':state.bookMode==='best'?'Fresh cross-book comparisons, ordered by payout difference.':'The highest quoted payout for each exact selection.';
 $('book-scope-note').innerHTML=state.bookMode==='my'?`${state.myBooks.length} selected account${state.myBooks.length===1?'':'s'}. Only their returned quotes are compared. <button class="text-button" data-open="settings">Edit My Books ↗</button>`:state.bookMode==='best'?'Two or more fresh quotes are required. Largest payout differences appear first. This is price shopping, not a prediction.':'Every book returned by the provider is eligible. Open the book list on a selection to inspect its exact prices.';
 if(state.bookMode==='my'&&!state.myBooks.length){$('games').innerHTML='<div class="empty-state"><span class="empty-symbol">☆</span><h3>Make this board yours</h3><p>Select the sportsbook accounts you use. My Books will compare only their real returned prices.</p><button class="button primary" data-open="settings">Choose My Sportsbooks</button><button class="text-button" data-book-mode="all">Compare All Books instead ↗</button></div>';return;}
 if(!events.length&&state.bookMode==='best'){$('games').innerHTML='<div class="empty-state"><span class="empty-symbol">↗</span><h3>No fresh cross-book comparisons</h3><p>Best Odds needs at least two current sportsbook quotes on the same outcome and line. Stale or single-book prices are excluded.</p><button class="button" data-book-mode="all">Show all returned prices</button></div>';return;}
 if(!events.length){$('games').innerHTML='<div class="empty-state"><span class="empty-symbol">◎</span><h3>No games match these filters</h3><p>Clear the filters, select another league, or refresh. A missing listing is not proof that no game exists.</p><button class="button" data-reset>Show all loaded games ↗</button></div>';return;}
 const leagues=new Map();for(const event of events){if(!leagues.has(event.sport_key))leagues.set(event.sport_key,[]);leagues.get(event.sport_key).push(event);}
 $('games').innerHTML=[...leagues].map(([key,games])=>{
  const sport=state.sports.find(s=>s.key===key);
  return `<section class="league-section" aria-label="${esc(sport?.title||games[0].sport_title)} games"><div class="league-heading"><div><span class="league-symbol" aria-hidden="true">${sportSymbol(sport?.group)}</span><h3>${esc(sport?.title||games[0].sport_title)}</h3><span>${games.length} game${games.length===1?'':'s'}</span></div><span class="league-category">${esc(sportLabel(sport?.group))}</span></div><div class="league-games">${games.map(renderGame).join('')}</div></section>`;
 }).join('');
}
function renderDetail(){
 const event=currentEvent();
 if(!event){$('selection-detail').innerHTML='<div class="detail-placeholder">Choose a game on the board to see the sportsbook-by-sportsbook comparison.</div>';$('ask-submit').disabled=true;return;}
 const groups=groupsFor(event);let group=groups.find(g=>g.id===state.groupId)||groups[0];state.groupId=group?.id||null;
 $('ask-submit').disabled=!group||state.askBusy||(state.feedFailed&&!state.staticMode);
 if(!group){$('selection-detail').innerHTML=`<div class="detail-placeholder">No ${esc(MARKET_NAMES[state.market].toLowerCase())} quotes for the selected books. Try another market or book filter.</div>`;return;}
 const result=group.best?payout(state.stake,group.best.price):null;
 const bestSet=new Set(group.ties.map(q=>q.book));
 $('selection-detail').innerHTML=`<div class="detail-content"><div class="detail-eyebrow">${state.board.mode==='demo'?'FICTIONAL SAMPLE · ':''}SELECTED GAME</div><h3 class="detail-title">${event.kind==='future'?esc(event.title||event.sport_title):esc(event.away_team)+'<span> at </span>'+esc(event.home_team)}</h3><label class="detail-select-label" for="selection">Exact selection & line</label><select id="selection" class="detail-select">${groups.map(g=>`<option value="${esc(g.id)}" ${g.id===group.id?'selected':''}>${esc(groupLabel(g))} (${g.freshQuotes.length} fresh books)</option>`).join('')}</select><div class="comparison-head"><span>SPORTSBOOK / QUOTE AGE</span><span>PRICE</span></div>${group.quotes.map(q=>`<div class="book-row ${bestSet.has(q.book)?'best':''} ${!q.fresh?'stale':''}"><span class="book-tag">${esc(BOOKS[q.book]?.tag||q.title.slice(0,2))}</span><div><span class="book-title">${esc(q.title)}${bestSet.has(q.book)?' ↗':''}</span><span class="quote-age" title="${esc(q.updatedAt||'No provider timestamp')}">${esc(timeAgo(q.updatedAt))}${!q.fresh?' · not ranked':''}</span></div><strong class="quote-price">${esc(formatOdds(q.price,state.format))}</strong>${sportsbookLink(q.book,q)?.url?`<a class="book-external" href="${esc(sportsbookLink(q.book,q).url)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(q.title)} website; not a betslip" aria-label="Open ${esc(q.title)} website; confirm price and eligibility there">↗</a>`:''}</div>`).join('')}${tracker.pickButton(event,group)}${upgrade.selectionButtons(event,group)}<div class="stake-row"><label for="stake">Hypothetical stake</label><div class="stake-input">$<input type="number" id="stake" min="0" max="100000" step="0.01" inputmode="decimal" value="${esc(state.stake)}"></div></div><div class="payout-box"><div><span>PROFIT IF IT WINS</span><strong id="profit">${result?money(result.profit):'—'}</strong></div><div><span>RETURN WITH STAKE</span><strong id="total-return">${result?money(result.total):'—'}</strong></div></div><p class="payout-foot" id="payout-foot">${result?`${group.comparable?'Highest payout on this exact selection.':'Only one fresh quote; no cross-book comparison.'} A loss can lose the entire stake.`:'No fresh quote. Old prices are not ranked.'}</p></div>`;
}
// Never rebuild the focused number input during its change/blur event: nested
// innerHTML removal can throw and discard the user's newly entered stake.
function renderPayout(){
 const group=currentGroup(),result=group?.best?payout(state.stake,group.best.price):null;
 if($('profit'))$('profit').textContent=result?money(result.profit):'—';
 if($('total-return'))$('total-return').textContent=result?money(result.total):'—';
}
function updateStake(input,commit=false){
 const n=input.value===''?NaN:Number(input.value);
 if(!Number.isFinite(n)||n<0||n>100000){
  if(commit){input.value=state.stake;toast('Use a hypothetical stake from $0 to $100,000.');}
  return;
 }
 state.stake=Math.round(n*100)/100;
 if(commit){input.value=state.stake;$('board-stake').value=state.stake;renderGames();}
 invalidateAnswer();renderPayout();
}
function renderAll(){updateConfigUI();renderStats();renderGames();renderDetail();syncNav();research.update();tracker.update();upgrade.update();}
function syncNav(){document.querySelectorAll('[data-sport]').forEach(b=>{b.classList.toggle('active',b.dataset.sport===state.sport);b.setAttribute('aria-pressed',String(b.dataset.sport===state.sport));});document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===state.view));document.querySelectorAll('[data-status]').forEach(b=>{b.classList.toggle('active',b.dataset.status===state.status);b.setAttribute('aria-pressed',String(b.dataset.status===state.status));});document.querySelectorAll('[data-market]').forEach(b=>{b.classList.toggle('active',b.dataset.market===state.market);b.setAttribute('aria-pressed',String(b.dataset.market===state.market));});document.querySelectorAll('[data-league]').forEach(b=>b.classList.toggle('active',b.dataset.league===state.league));syncMobileNav();}
function syncMobileNav(){const page=$('scout-dialog')?.open?'scout':$('lab-dialog')?.open||$('research-dialog')?.open?'parlay':$('tracker-dialog')?.open?'saved':state.status==='live'?'live':'home';document.querySelectorAll('[data-mobile-page]').forEach(b=>{const active=b.dataset.mobilePage===page;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
function selectEvent(id,groupId){state.selectedId=id;state.groupId=groupId||null;invalidateAnswer();renderGames();renderDetail();upgrade.setBoardContext();openModal('compare');}
async function changeScope(league,market){
 if(state.busy){state.fetchSeq++;state.controller?.abort();state.busy=false;}
 state.sport='all';state.league=league;state.market=(state.futures||[]).some(f=>f.key===league)?'outrights':market==='outrights'?'h2h':market;state.board=null;state.groupId=null;state.selectedId=null;state.feedFailed=false;invalidateAnswer();$('games').innerHTML='';$('selection-detail').innerHTML='<div class="detail-placeholder">Loading a new comparison…</div>';$('league').value=league;syncNav();await refreshBoard(true);
}
async function ask(question){
 if(state.askBusy)return;const event=currentEvent(),group=currentGroup();if(!event||!group){toast('Select a game and an available line first.');return;}
 if(state.feedFailed&&!state.staticMode){toast('Refresh the feed successfully before asking about old prices.');return;}
 state.askBusy=true;$('ask-submit').disabled=true;const seq=++state.askSeq;$('answer').textContent='Checking the exact selection and fresh prices…';$('answer-note').textContent='';
 try{
  const result=state.staticMode?{mode:'rules',text:explainComparison(event,group,state.stake,question),note:'Fictional sample data. Rules-based explanation, not an AI response.'}:await api('/api/ask',{method:'POST',body:JSON.stringify({eventId:event.id,groupId:group.id,league:event.sport_key,market:state.market,question:question.slice(0,600),stake:state.stake,...(state.bookKeys!==null?{bookKeys:state.bookKeys}:{})})});
  if(seq!==state.askSeq)return;
  if(result.mode==='ai')state.aiVerified=true;updateConfigUI();$('answer').textContent=result.text;$('answer-note').textContent=`${result.mode==='ai'?'AI EXPLANATION':'RULES-BASED EXPLANATION'} · ${result.note}${result.verified?.observedAt?` Snapshot: ${new Date(result.verified.observedAt).toLocaleTimeString()}.`:''}`;
 }catch(e){if(seq===state.askSeq){$('answer').textContent=e.message;$('answer-note').textContent='No new explanation was generated.';}}
 finally{if(seq===state.askSeq){state.askBusy=false;$('ask-submit').disabled=!currentGroup();}}
}
function autoRefreshChanged(){
 clearInterval(autoTimer);autoTimer=null;
 if($('auto-refresh').checked&&(state.staticMode||!state.board||state.feedFailed)){stopAuto();return;}
 if($('auto-refresh').checked){toast('Auto-refresh on: each new snapshot consumes data-provider credits in live mode.');autoTimer=setInterval(()=>{if(state.board?.events?.length&&!document.hidden&&navigator.onLine&&Date.now()>=state.retryAt&&!$('room-dialog').open&&!$('age-dialog').open)refreshBoard();},state.status==='live'?30000:60000);}
 renderStats();
}
async function shareSite(){
 if(['file:','about:','blob:'].includes(location.protocol)){toast('Send the HTML file itself to share this local preview. It is not a public website link.');return;}
 const url=new URL(location.href);url.search='';url.hash='';if(state.staticMode)url.searchParams.set('demo','1');if(state.league!=='all')url.searchParams.set('league',state.league);if(state.selectedId)url.hash=state.selectedId;
 try{if(navigator.share){await navigator.share({title:'OddsScout',text:'Compare sportsbook prices for the same bet.',url:url.href});return;}await navigator.clipboard.writeText(url.href);toast('App link copied. Send it to your friends.');}catch(e){if(e.name!=='AbortError')window.prompt('Copy this app link:',url.href);}
}
const tracker=mountTracker({state,toast,esc,openModal,persist,saved,redraw:()=>{renderGames();renderDetail();upgrade.update();}});
const research=mountResearch({state,api,toast,esc,openModal,persist,saved,onTrackTicket:(ticket,comparison)=>tracker.saveParlay(ticket,comparison),onReviewPlan:legs=>upgrade.reviewPlan(legs)});
const upgrade=mountUpgrade({state,api,toast,esc,openModal,persist,saved,tracker,redraw:renderAll,changeScope,onOpenForm:event=>research.openEventForm(event)});
mountSocial({tracker,toast,esc,openModal,persist,saved});
const calendar=mountCalendar({state,api,toast,esc,openEvent:event=>upgrade.openEvent(event)});
document.addEventListener('click',event=>{
 const target=event.target.closest('button');if(!target)return;
 if('lockPreview' in target.dataset){lockEntry();return;}
 if('calendarOpen' in target.dataset){calendar.show();return;}
  if('retry'in target.dataset){if($('settings-dialog').open)$('settings-dialog').close();if(Date.now()<state.retryAt){toast('The provider requested a cooldown. Please retry later.');return;}bootstrap();return;}
 if(target.dataset.open){updateConfigUI();openModal(target.dataset.open);return;}
 if(target.dataset.close){$(target.dataset.close).close();return;}
 if('stopScan'in target.dataset){state.controller?.abort();return;}
 if(target.dataset.sport){state.sport=target.dataset.sport;renderGames();syncNav();return;}
 if(target.dataset.nav){state.view=target.dataset.nav;if(target.dataset.mobilePage==='home')state.status='all';renderGames();syncNav();$('board').scrollIntoView({behavior:'smooth'});return;}
 if(target.dataset.status){state.status=target.dataset.status;if(target.dataset.mobilePage==='live')state.view='board';renderGames();syncNav();if(target.dataset.mobilePage==='live')$('board').scrollIntoView({behavior:'smooth'});return;}
 if(target.dataset.market){changeScope(state.league,target.dataset.market);return;}
 if(target.dataset.league){changeScope(target.dataset.league,state.market);return;}
 if(target.dataset.save){const id=target.dataset.save;state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id);persist('os-favorites',[...state.favorites]);renderStats();renderGames();return;}
 if(target.dataset.selectEvent){selectEvent(target.dataset.selectEvent,target.dataset.group);return;}
 if(target.dataset.question){ask(target.dataset.question);return;}
 if('reset'in target.dataset){state.search='';$('search').value='';$('board-search').value='';state.status='all';state.sport='all';state.date='all';$('date-range').value='all';state.view='board';if(state.league!=='all'){changeScope('all',state.market);}else{renderGames();syncNav();}return;}
});
document.addEventListener('toggle',event=>{if(event.target.matches?.('[data-quote-list]')){const key=event.target.dataset.quoteList;if(event.target.open)expandedBooks.add(key);else expandedBooks.delete(key);}},true);
new MutationObserver(syncMobileNav).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
document.addEventListener('change',event=>{
 if(event.target.matches('[data-book]')){state.myBooks=[...document.querySelectorAll('[data-book]:checked')].map(e=>e.value);state.bookKeys=state.bookMode==='my'?state.myBooks:null;persist('os-books',state.myBooks);invalidateAnswer();renderStats();renderGames();renderDetail();upgrade.update();}
 if(event.target.id==='selection'){state.groupId=event.target.value;invalidateAnswer();renderDetail();renderGames();}
 if(event.target.id==='stake')updateStake(event.target,true);
});
document.addEventListener('input',event=>{if(event.target.id==='stake')updateStake(event.target);});
$('date-range').addEventListener('change',e=>{state.date=e.target.value;renderGames();});
$('board-stake').value=state.stake;
$('board-stake').addEventListener('change',e=>{updateStake(e.target,true);renderGames();renderDetail();});
$('search').addEventListener('input',e=>{state.search=e.target.value;$('board-search').value=state.search;renderGames();});
$('board-search').addEventListener('input',e=>{state.search=e.target.value;$('search').value=state.search;renderGames();});
$('league').addEventListener('change',e=>changeScope(e.target.value,state.market));
$('odds-format').value=state.format;
$('odds-format').addEventListener('change',e=>{state.format=e.target.value;persist('os-format',state.format);renderGames();renderDetail();});
$('refresh').addEventListener('click',()=>refreshBoard());
$('auto-refresh').addEventListener('change',autoRefreshChanged);
$('share-site').addEventListener('click',shareSite);
$('mobile-assistant').addEventListener('click',()=>openModal('scout'));
$('ask-form').addEventListener('submit',e=>{e.preventDefault();const q=$('question').value.trim();if(q){ask(q);$('question').value='';}});
$('question').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('ask-form').requestSubmit();}});
$('confirm-age').addEventListener('click',()=>{persist('os-adult',true);$('age-dialog').close();startFromLink();});
$('age-dialog').addEventListener('cancel',e=>e.preventDefault());$('room-dialog').addEventListener('cancel',e=>e.preventDefault());
$('room-form').addEventListener('submit',async e=>{e.preventDefault();$('room-error').textContent='';try{const result=await api('/api/access',{method:'POST',body:JSON.stringify({code:$('room-code').value})});$('room-code').value='';if(result.authenticated)location.reload();}catch(error){$('room-error').textContent=error.message;}});
setInterval(()=>{if(document.hidden||!state.board||state.busy)return;updateConfigUI();renderStats();renderGames();upgrade.update();if(!['stake','selection','question'].includes(document.activeElement?.id))renderDetail();},15000);
window.addEventListener('offline',()=>{if(!state.staticMode){state.feedFailed=true;stopAuto();invalidateAnswer();setError('You are offline. Old real quotes are visible only for reference, not ranked.');}renderAll();});
window.addEventListener('online',()=>{toast('Connection restored. Retry the connection for new quotes.');updateConfigUI();});
window.addEventListener('storage',event=>{if(event.key==='os-favorites'){const values=saved('os-favorites',[]);state.favorites=new Set(Array.isArray(values)?values:[]);renderStats();renderGames();}});
function startFromLink(){bootstrap();if(new URLSearchParams(location.search).get('view')==='calendar')calendar.show();}
updateConfigUI();upgrade.update();
if(saved('os-adult',false)===true)startFromLink();else openModal('age');

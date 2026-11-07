import {FORM_LEAGUES,RESEARCH_METHOD,recentTeamForm,rankGame,generateParlays,compareParlay,parlayGroups,paperNet} from './lib/parlays.mjs';
import {BOOKS,formatOdds,money,timeAgo,eventStatus} from './lib/odds.mjs';

/** Isolated enhancement of the existing board; no provider key is accepted by this UI. */
export function mountResearch({state,api,toast,esc,openModal,persist,saved,onTrackTicket,onReviewPlan}){
 const el=id=>document.getElementById(id),cache=new Map();
 let ticket=[],suggestions=[],busy=false,sequence=0,mode=state.staticMode?'demo':'live',paper=saved('os-paper-tickets',[]),activeForm=null,lastCandidates=[],copiedText='';
 if(!Array.isArray(paper))paper=[];paper=paper.filter(t=>t&&typeof t.id==='string'&&Array.isArray(t.legs)&&Number.isFinite(t.stake)&&t.stake>=0&&Number.isFinite(t.decimal)&&t.decimal>1).slice(0,100);
 const key=e=>`${state.staticMode?'demo':'live'}|${e.sport_key}|${[e.home_team,e.away_team].sort().join('|')}`;
 const windowSize=()=>Number(el('research-window').value)||5;
 const blocked=()=>!state.staticMode&&(state.feedFailed||navigator.onLine===false||state.board?.mode!=='live');
 const dateText=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(new Date(value)):'Unknown date';
 const recordText=f=>`${f.wins}–${f.losses}${f.draws?'–'+f.draws:''}`;
 const currentStake=()=>{const raw=el('parlay-stake').value;const n=raw===''?NaN:Number(raw);return Number.isFinite(n)&&n>=0&&n<=100000?Math.round(n*100)/100:null;};
 function setStatus(text,error=false){el('research-status').textContent=text;el('research-status').classList.toggle('research-error',error);}
 async function fetchForm(event,independent=false){
  if(independent?navigator.onLine===false:blocked())throw new Error('Reconnect the odds board before loading research.');
  const existing=cache.get(key(event));if(existing&&Date.now()-Date.parse(existing.fetchedAt)<900000)return existing;
  if(existing)cache.delete(key(event));
  let data;
  data=await api('/api/form?'+new URLSearchParams({league:event.sport_key,team:event.home_team,opponent:event.away_team}));
  if(data?.mode!==(state.staticMode?'demo':'live')||!Array.isArray(data.games)||!Number.isFinite(Date.parse(data.fetchedAt)))throw new Error('The recent-results response is invalid. No synthetic substitute was used.');
  cache.set(key(event),data);return data;
 }
 function formCard(team,bundle,event){
  const f=recentTeamForm(team,bundle.games,{limit:windowSize(),before:Date.parse(event.commence_time)});
  const split=which=>`${recordText(f[which])} (${f[which].games} games)`;
  return `<article class="form-card"><h3>${esc(team)}</h3><div class="form-summary"><strong>${recordText(f)}</strong><span>${f.games} completed games<br>${!bundle.complete?'Returned subset only':f.games<windowSize()?'Limited sample':'Most recent returned results'}</span></div><div class="form-dots" aria-label="Results, newest first">${f.rows.map(g=>`<span class="form-dot ${g.result.toLowerCase()}" title="${esc(g.opponent)} · ${esc(dateText(g.date))}">${g.result}</span>`).join('')}</div><div class="form-metrics"><div><span>Scored / game</span><strong>${f.averageFor===null?'—':f.averageFor.toFixed(1)}</strong></div><div><span>Allowed / game</span><strong>${f.averageAgainst===null?'—':f.averageAgainst.toFixed(1)}</strong></div><div><span>Home in sample</span><strong>${split('home')}</strong></div><div><span>Away in sample</span><strong>${split('away')}</strong></div></div><p class="muted">${f.lastPlayed?`Last completed game: ${esc(dateText(f.lastPlayed))} · ${Math.floor(f.daysSinceLast)} days ago`:'No completed history returned.'}</p><div class="form-table-wrap"><table class="form-table"><caption>Recent results · newest first</caption><thead><tr><th>Date</th><th>Opponent</th><th>Score</th><th>Result</th></tr></thead><tbody>${f.rows.map(g=>`<tr><td>${esc(dateText(g.date))}</td><td>${g.venue==='home'?'vs.':'at'} ${esc(g.opponent)}</td><td>${g.scored}–${g.allowed}</td><td>${g.result}</td></tr>`).join('')||'<tr><td colspan="4">No results available</td></tr>'}</tbody></table></div></article>`;
 }
 async function openForm(id,suppliedEvent=null){
  const event=suppliedEvent?.id===id?suppliedEvent:state.board?.events.find(e=>e.id===id)||ticket.find(l=>l.event.id===id)?.event;if(!event)return;
  activeForm=event;openModal('form');el('form-title').textContent=`${event.away_team} at ${event.home_team}`;el('form-body').innerHTML='<p role="status">Loading source-dated recent results…</p>';
  const expectedMode=state.staticMode;
  try{const bundle=await fetchForm(event,Boolean(suppliedEvent));if(activeForm!==event||expectedMode!==state.staticMode)return;
   el('form-body').innerHTML=`<div class="research-data-label ${bundle.mode==='demo'?'sample':''}">${esc(bundle.source)} · fetched ${esc(timeAgo(bundle.fetchedAt))}${bundle.mode==='demo'?' · FICTIONAL DEMO':''}</div>${!bundle.complete?'<p class="research-alert">Incomplete history: the displayed rows are not guaranteed to be the most recent. Not used for suggestions.</p>':''}<div class="form-grid">${[event.away_team,event.home_team].map(t=>formCard(t,bundle,event)).join('')}</div><p class="research-alert">Injuries, lineups, weather, travel and opponent strength: not verified. These are descriptive scores, not a prediction. ${esc((bundle.limitations||[]).join(' '))}</p>`;
  }catch(e){el('form-body').innerHTML=`<div class="research-empty"><h3>Recent form unavailable</h3><p>${esc(e.message)}</p><p>No last-five record or prediction was invented.</p></div>`;}
 }
 function planCard(plan,i){
  const b=plan.comparison.best,stake=currentStake();
  return `<article class="research-option"><div class="option-heading"><span>DATA-BASED RESEARCH ${i+1}</span><span>${plan.legs.length} legs</span></div>${plan.legs.map(leg=>`<div class="research-leg"><strong>${esc(leg.selection)} to win</strong><span>${esc(leg.event.sport_title)} · ${esc(leg.event.away_team)} at ${esc(leg.event.home_team)}</span><p>${esc(recordText(leg.own))} in ${leg.own.games}; opponent ${esc(recordText(leg.opponent))} in ${leg.opponent.games}. Avg. score margin: ${leg.own.averageMargin>=0?'+':''}${leg.own.averageMargin.toFixed(1)}.</p><details class="research-rationale"><summary>Why this ranked here</summary><div class="candidate-context"><div><span>Market share after margin removal</span><strong>${(100*leg.marketShare).toFixed(1)}%</strong></div><div><span>Research rank · not probability</span><strong>${leg.score.toFixed(1)} / 100</strong></div><div><span>Best current price</span><strong>${formatOdds(leg.group.best.price,state.format)}</strong></div><div><span>Fresh reporting books</span><strong>${leg.group.freshQuotes.length}</strong></div></div><p>The rank combines 65% normalized market share, 25% smoothed recent-result comparison, and 10% smoothed home/away comparison. These are documented heuristic weights, not a trained forecast.</p><p><b>Concerns:</b> small sample, changing prices, and unverified injuries, lineups, weather and opponent strength. Season average, model win probability and model edge are unavailable.</p><p class="small-print">${esc(leg.source)} · history fetched ${esc(timeAgo(leg.fetchedAt))}</p></details><button class="text-button" data-form-event="${esc(leg.event.id)}">See scores & source ↗</button></div>`).join('')}<div class="plan-total"><div><span>${plan.comparison.books.length>1?'Highest estimated payout':'Only common quoted app'}</span><strong>${esc(plan.comparison.ties.map(b=>b.title).join(' / '))}</strong></div><strong>${formatOdds(b.decimal,state.format)}</strong></div><p class="small-print">${stake===null?'Enter a valid hypothetical stake.':`${money(stake)} would return ${money(stake*b.decimal)} only if every leg wins at these estimated terms.`} Not a verified sportsbook ticket.</p><button class="button primary full-width" data-use-plan="${i}">Review this combination</button></article>`;
 }
 function rerank(){
  const currentMode=state.staticMode?'demo':'live';lastCandidates=[];
  if(!blocked())for(const e of state.board?.events||[])if(el('research-league').value==='all'||e.sport_key===el('research-league').value)lastCandidates.push(...rankGame(e,cache.get(key(e)),{limit:windowSize(),bookKeys:state.bookKeys,mode:currentMode}));
  suggestions=generateParlays(lastCandidates,{legs:Number(el('research-legs').value),bookKeys:state.bookKeys});
  el('research-results').innerHTML=suggestions.length?suggestions.map(planCard).join(''):'<div class="research-empty"><span class="empty-symbol">◎</span><h3>No research combinations yet</h3><p>Analyze games to load recent results. Suggestions need at least three recent finals for both teams, fresh odds, different matchups, and a common sportsbook. Missing data is never filled in.</p></div>';
 }
 async function analyze(){
  if(busy)return;
  if(!state.board){setStatus('Connect the odds board first.',true);return;}
  if(state.market!=='h2h'){setStatus('Switch the board to Moneyline before building research combinations.',true);return;}
  if(blocked()){setStatus('Reconnect the feed first. Previous odds are not current research.',true);return;}
  if(Date.now()<state.retryAt){setStatus('The provider requested a cooldown. Retry when it ends.',true);return;}
  const now=Date.now(),selectedLeague=el('research-league').value;
  const eligible=state.board.events.filter(e=>FORM_LEAGUES[e.sport_key]&&(selectedLeague==='all'||e.sport_key===selectedLeague)&&eventStatus(e,now)==='upcoming'&&Date.parse(e.commence_time)<=now+7*86400000&&parlayGroups(e,state.bookKeys).some(g=>g.best)).sort((a,b)=>Date.parse(a.commence_time)-Date.parse(b.commence_time));
  const scope=eligible.slice(0,8),run=++sequence;busy=true;el('research-analyze').disabled=true;el('research-stop').classList.remove('hidden');const failures=[];let loaded=0;
  try{
   for(const event of scope){
    if(run!==sequence)break;
    setStatus(`Analyzing ${loaded+failures.length+1} of ${scope.length} upcoming games… Requests are cached; provider limits still apply.`);
    try{await fetchForm(event);loaded++;}catch(e){failures.push(e.message);if(Date.now()<state.retryAt||/not configured|key or endpoint/i.test(e.message))break;}
    if(run!==sequence)break;rerank();
   }
   if(run===sequence){rerank();setStatus(`${loaded} analyzed of ${scope.length} selected games (${eligible.length} eligible loaded; next 7 days; at most 8 checked per scan). ${new Set(lastCandidates.map(c=>c.event.id)).size} games meet the research rules. ${failures.length?failures[0]:scope.length?'Research ideas—not tested win predictions.':'No eligible upcoming games in this scope.'}`,failures.length>0);}
  }finally{busy=false;el('research-analyze').disabled=false;el('research-stop').classList.add('hidden');}
 }
 function refreshedTicket(){
  return ticket.map(l=>{const e=state.board?.market==='h2h'?state.board.events.find(e=>e.id===l.event.id):null;return {...l,event:e||l.event};});
 }
 function ticketComparison(){return blocked()?{ok:false,reason:'The feed is unavailable. Refresh successfully before reviewing prices.',books:[]}:compareParlay(refreshedTicket(),{bookKeys:state.bookKeys});}
 function renderTicket(){
  ticket=refreshedTicket();const comparison=ticketComparison(),stake=currentStake();
  el('parlay-leg-count').textContent=`${ticket.length}/4 legs`;
  el('parlay-ticket-legs').innerHTML=ticket.length?ticket.map((l,i)=>`<div class="ticket-leg"><div><strong>${esc(l.selection)} to win</strong><span>${esc(l.event.away_team)} at ${esc(l.event.home_team)}</span><small>${esc(l.event.sport_title)} · ${esc(dateText(l.event.commence_time))}</small></div><button class="icon-btn" aria-label="Remove ${esc(l.selection)}" data-remove-leg="${i}">×</button></div>`).join(''):'<p class="muted">Choose a research option or add 2–4 upcoming moneylines from the board.</p>';
  el('parlay-compare').innerHTML=comparison.ok?`<div class="research-data-label ${state.staticMode?'sample':''}">${state.staticMode?'FICTIONAL DEMO · ':''}ESTIMATED · NOT A BOOK-CONFIRMED PARLAY</div>${comparison.books.map(b=>`<div class="parlay-book ${comparison.ties.some(t=>t.book===b.book)?'best':''}"><div><strong>${esc(b.title)}</strong><span>${comparison.books.length===1?'Only common app':comparison.ties.some(t=>t.book===b.book)?'Highest estimated payout':'All legs quoted'} · oldest ${esc(timeAgo(b.oldestAt))}</span><small>Legs: ${b.quotes.map(q=>formatOdds(q.price,state.format)).join(' × ')}</small></div><div><strong>${formatOdds(b.decimal,state.format)}</strong><span>${stake===null?'—':money(stake*b.decimal)} return</span></div></div>`).join('')}<p class="small-print">Each row multiplies that app’s own fresh single-leg odds. A sportsbook may reject the combination or quote different odds. No boost, promo, tax or settlement adjustment is included.</p><button class="button primary full-width" data-review-book="${esc(comparison.best.book)}">Review ${esc(comparison.best.title)} handoff ↗</button>`:`<div class="research-empty compact"><p>${esc(comparison.reason)}</p></div>`;
  el('parlay-track').disabled=!comparison.ok;
  el('parlay-copy').disabled=!comparison.ok;el('parlay-save').disabled=!comparison.ok||stake===null;
 }
 function addLeg(id,groupId){
  const event=state.board?.events.find(e=>e.id===id),group=event?parlayGroups(event,state.bookKeys).find(g=>g.id===groupId):null;
  if(blocked()||!group?.best){toast('Only fresh, upcoming full-game two-way moneylines can be added.');return;}
  if(ticket.length>=4){toast('This builder supports up to four separate games.');return;}
  if(ticket.some(l=>l.event.id===event.id||l.event.sport_key===event.sport_key&&[l.event.home_team,l.event.away_team].some(t=>t===event.home_team||t===event.away_team))){toast('Choose a different matchup. Duplicate games or overlapping teams are not combined.');return;}
  ticket.push({event,groupId:group.id,selection:group.name});renderTicket();openModal('research');
 }
 function ticketText(){
  const c=ticketComparison();if(!c.ok)return null;const stake=currentStake();
  return `${state.staticMode?'FICTIONAL DEMO — ':''}OddsScout research ticket — NOT a placed bet\n${ticket.map((l,i)=>`${i+1}. ${l.selection} to win — ${l.event.away_team} at ${l.event.home_team}`).join('\n')}\n${c.best.title}: estimated ${formatOdds(c.best.decimal,state.format)} (${c.best.decimal.toFixed(3)} decimal), from single-leg quotes.\n${stake===null?'':`Hypothetical stake ${money(stake)}; total return ${money(stake*c.best.decimal)} if all legs win.\n`}Oldest quote: ${c.best.oldestAt}. Verify exact markets, accepted parlay price and eligibility in the sportsbook. No guaranteed outcome.`;
 }
 async function copyTicket(){const text=ticketText();if(!text)return;try{await navigator.clipboard.writeText(text);toast('Research ticket copied—not a placed bet.');}catch{copiedText=text;el('copy-ticket-text').value=copiedText;openModal('copy-ticket');el('copy-ticket-text').select();}}
 function renderPaper(){
  const settled=paper.filter(t=>paperNet(t)!==null),net=settled.reduce((s,t)=>s+paperNet(t),0);
  el('paper-summary').textContent=`${paper.length} saved · ${settled.length} manually marked · hypothetical net ${money(net)}`;
  el('paper-rows').innerHTML=paper.map(t=>`<div class="paper-row"><div><strong>${esc(t.legs.map(l=>l.selection).join(' + '))}</strong><span>${t.demo?'Fictional demo':'Research snapshot'} · ${esc(t.book)} · ${esc(dateText(t.savedAt))}</span><small>${money(t.stake)} at ${formatOdds(t.decimal,state.format)} · net ${paperNet(t)===null?'pending':money(paperNet(t))}</small></div><label><span class="sr-only">Paper result</span><select data-paper-result="${esc(t.id)}">${['pending','won','lost','void'].map(r=>`<option value="${r}" ${t.result===r?'selected':''}>${r[0].toUpperCase()+r.slice(1)}</option>`).join('')}</select></label><button class="icon-btn" data-paper-remove="${esc(t.id)}" aria-label="Delete saved paper ticket">×</button></div>`).join('')||'<p class="muted">Saved locally on this device. No automatic grading or money movement.</p>';
 }
 function saveTicket(){
  const c=ticketComparison(),stake=currentStake();if(!c.ok||stake===null)return;
  const t={id:globalThis.crypto?.randomUUID?.()||String(Date.now()),savedAt:new Date().toISOString(),demo:state.staticMode,legs:ticket.map(l=>({eventId:l.event.id,selection:l.selection,matchup:l.event.away_team+' at '+l.event.home_team})),book:c.best.title,decimal:c.best.decimal,stake,result:'pending',oldestQuoteAt:c.best.oldestAt};
  paper.unshift(t);paper=paper.slice(0,100);const stored=persist('os-paper-tickets',paper);renderPaper();toast(stored?'Saved to the paper tracker. No bet was placed.':'Session-only paper ticket. Browser storage is unavailable; no bet was placed.');
 }
 function exportPaper(){
  const csvcell=x=>{if(typeof x==='number'&&Number.isFinite(x))return String(x);let s=String(x??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const rows=[['saved_at','mode','selections','book','estimated_decimal','hypothetical_stake','manual_result','hypothetical_net'],...paper.map(t=>[t.savedAt,t.demo?'fictional_demo':'research',t.legs.map(l=>l.selection).join(' | '),t.book,t.decimal,t.stake,t.result,paperNet(t)??''])];
  const url=URL.createObjectURL(new Blob([rows.map(r=>r.map(csvcell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='OddsScout-paper-tracker.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
 }
 function reviewBook(book){
  const c=ticketComparison(),row=c.books?.find(b=>b.book===book);if(!c.ok||!row||!BOOKS[book]?.url)return;
  el('handoff-title').textContent=`Review ${row.title}`;
  el('handoff-price').textContent=`${state.staticMode?'FICTIONAL DEMO. ':''}Estimated combined odds: ${formatOdds(row.decimal,state.format)}. This is not a sportsbook-verified ticket.`;
  const link=el('handoff-link');link.dataset.book=book;link.href=BOOKS[book].url;link.textContent=`Open ${row.title} website ↗`;
  document.querySelectorAll('[data-handoff-check]').forEach(c=>c.checked=false);link.setAttribute('aria-disabled','true');openModal('handoff');
 }
 document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.formEvent){openForm(b.dataset.formEvent);return;}
  if(b.dataset.addLeg){addLeg(b.dataset.addLeg,b.dataset.legGroup);return;}
  if(b.dataset.open==='research'){update();return;}
  if(b.id==='research-analyze'){analyze();return;}
  if(b.id==='research-stop'){sequence++;setStatus('Stopped further requests. The current request may finish; loaded history is retained.');return;}
  if(b.dataset.usePlan!==undefined){const p=suggestions[Number(b.dataset.usePlan)];if(p){ticket=p.legs.map(l=>({event:l.event,groupId:l.groupId,selection:l.selection}));renderTicket();onReviewPlan?.(ticket);el('parlay-ticket').scrollIntoView({behavior:'smooth',block:'nearest'});}return;}
  if(b.dataset.removeLeg!==undefined){ticket.splice(Number(b.dataset.removeLeg),1);renderTicket();return;}
  if(b.id==='parlay-clear'){ticket=[];renderTicket();return;}
  if(b.id==='parlay-copy'){copyTicket();return;}
  if(b.id==='parlay-save'){saveTicket();return;}
  if(b.id==='parlay-track'){const c=ticketComparison();if(c.ok)onTrackTicket?.(ticket,c);return;}
  if(b.id==='paper-export'){exportPaper();return;}
  if(b.dataset.paperRemove){paper=paper.filter(t=>t.id!==b.dataset.paperRemove);persist('os-paper-tickets',paper);renderPaper();return;}
  if(b.dataset.reviewBook)reviewBook(b.dataset.reviewBook);
 });
 document.addEventListener('change',e=>{
  if(e.target.matches('[data-paper-result]')){const t=paper.find(t=>t.id===e.target.dataset.paperResult);if(t&&['pending','won','lost','void'].includes(e.target.value)){t.result=e.target.value;persist('os-paper-tickets',paper);renderPaper();}}
  if(e.target.matches('[data-handoff-check]'))el('handoff-link').setAttribute('aria-disabled',String(![...document.querySelectorAll('[data-handoff-check]')].every(c=>c.checked)));
  if(['research-window','research-legs','research-league','odds-format'].includes(e.target.id)||e.target.matches('[data-book]'))setTimeout(()=>{rerank();renderTicket();renderPaper();},0);
 });
 el('handoff-link').addEventListener('click',e=>{const c=ticketComparison();if(el('handoff-link').getAttribute('aria-disabled')==='true'||!c.ok||!c.books.some(b=>b.book===el('handoff-link').dataset.book)){e.preventDefault();toast('Complete the checks and refresh any expired odds before continuing.');}});
 el('parlay-stake').addEventListener('input',()=>{renderTicket();if(suggestions.length)el('research-results').innerHTML=suggestions.map(planCard).join('');});
 window.addEventListener('storage',e=>{if(e.key==='os-paper-tickets'){const value=saved('os-paper-tickets',[]);if(Array.isArray(value)){paper=value.filter(t=>t&&Array.isArray(t.legs)).slice(0,100);renderPaper();}}});
 function update(){
  const next=state.staticMode?'demo':'live';if(mode!==next){mode=next;ticket=[];suggestions=[];lastCandidates=[];sequence++;}
  el('research-mode').textContent=state.staticMode?'Fictional demo · rules-based research':'Rules-based research · not a prediction model';
  el('research-method').textContent=RESEARCH_METHOD;rerank();renderTicket();renderPaper();
 }
 // Recheck the three-minute odds gate while the research dialog is open.
 setInterval(()=>{if(!document.hidden&&el('research-dialog').open&&!busy){rerank();renderTicket();}},15000);
 return {update,openEventForm:event=>event?.id?openForm(event.id,event):Promise.resolve()};
}

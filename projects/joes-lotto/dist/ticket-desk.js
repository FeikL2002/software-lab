/* Joe's Lotto ticket collection. Private details use the existing v1 records;
 * photos use encrypted, local IndexedDB. Only game/date/session leave the device.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const money = n => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(n / 100);
  const bridge = () => window.JoeTicketsBridge;
  const rows = () => bridge()?.scans() || [];
  const tickets = () => bridge()?.tickets() || [];
  let renderScans = null;
  const meta = id => { const row=renderScans ? renderScans.get(id) : rows().find(row=>row.ticketId===id); return row ? clone(row) : null; };
  function prepareRender() { renderScans=new Map(rows().map(row=>[row.ticketId,row])); }
  const GAMES = ['Powerball','Mega Millions','Classic Lotto','Pick 3','Pick 4','Pick 5','Rolling Cash 5','Lucky for Life','KENO'];
  const OFFICIAL_APP = 'https://www.ohiolottery.com/games/mobile-app';
  const BUSY = new Set();
  // Unsaved records must not leave durable orphan photos when localStorage is full.
  const memoryPhotos = new Map();
  function keepMemoryPhoto(id,blob) { const entry={id:crypto.randomUUID(),blob};memoryPhotos.set(id,entry);return entry; }
  let photoURL = null;
  let photoEpoch = 0;
  let initialized = false;
  let attachingTicket = null;
  let checkingAll = false;
  const reasonText = {
    'review-ticket-details-first':'Review the scanned numbers and dates against your original ticket first.',
    'ticket-details-needed':'Add the draw date and your played numbers to compare results.',
    'game-needed':'Choose the game printed on the ticket.',
    'ohio-jurisdiction-needs-review':'Confirm that this is an Ohio Lottery ticket.',
    'draw-date-needed':'The draw date is still needed.',
    'draw-session-needed':'Choose the midday or evening draw.',
    'played-numbers-needed':'Your played numbers are still needed.',
    'bonus-number-needed':'The ticket’s bonus ball is still needed.',
    'play-type-needed':'The Pick play type is still needed.',
    'stake-needed':'The amount wagered on each Pick play is still needed.',
    'potential-prize-match':'Your reviewed numbers appear to match a prize tier. Validate the original ticket officially.',
    'potential-match-amount-needs-review':'A potential prize match was found. Its amount needs an official check.',
    'potential-match-with-unchecked-draws-or-options':'A potential match was found; some draws or options still need checking.',
    'no-prize-match-in-reviewed-draws':'No prize match was found in all the reviewed draws and supported options. This is a comparison, not official ticket validation.',
    'official-results-not-available-for-every-draw':'Official results are not yet available for every draw on this ticket.',
    'official-results-unavailable':'Official results could not be loaded. Your saved ticket is safe; try again later.',
    'add-on-needs-official-check':'An add-on needs a separate official check before a whole-ticket result can be shown.',
    'game-comparison-not-supported':'This game needs an official ticket check.',
    'draw-date-range-needs-review':'Review each draw date covered by the ticket.',
    'unread-play-needs-review':'At least one printed play was unclear. Review every play on the ticket.',
    'play-count-conflict':'The printed play count and the read numbers differ. Review every play.',
    'draw-count-conflict':'The printed draw count and the saved dates differ. Review every draw.',
    'unsupported-option-needs-review':'A printed option needs review or an official ticket check.',
  };
  const explain = code => reasonText[code] || 'Some ticket details or game rules need review. Check the original ticket officially.';
  function validISO(value) { return typeof value === 'string' && value.length < 40 && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)); }
  function text(value, max) { if (typeof value !== 'string' || value.length > max) throw Error('Invalid saved ticket detail.'); return value; }
  function hash(value) { if (value == null) return null; if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw Error('Invalid private scan reference.'); return value; }
  function allowedSource(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && ['www.ohiolottery.com','ohiolottery.com','www.powerball.com','www.megamillions.com'].includes(u.hostname) && !u.username && !u.password ? u.href : null; } catch (_) { return null; }
  }
  function cleanEvaluation(value) {
    if (!value) return null;
    if (!['pending','potential-winner','potential-loser'].includes(value.status)) throw Error('Unsupported verification state.');
    if (value.officiallyVerified || /^official/.test(value.status)) throw Error('A backup cannot establish official ticket validation.');
    const amount = value.potentialCents;
    if (amount !== null && amount !== undefined && (!Number.isSafeInteger(amount) || amount < 0 || amount > 100000000000)) throw Error('Invalid potential prize amount.');
    if (value.checkedAt && !validISO(value.checkedAt)) throw Error('Invalid result check date.');
    return {status:value.status,officiallyVerified:false,potentialCents:amount ?? null,reason:text(value.reason || 'official-results-unavailable',160),checkedAt:value.checkedAt || null,sourceURLs:Array.isArray(value.sourceURLs) ? [...new Set(value.sourceURLs.map(allowedSource).filter(Boolean))].slice(0,60) : []};
  }
  function validateDetails(input, ticketIds) {
    if (!Array.isArray(input) || input.length > 20000) throw Error('Invalid scanned-ticket collection.');
    const ids = new Set(ticketIds), seen = new Set();
    return input.map(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('Invalid scanned ticket.');
      const ticketId = text(row.ticketId,100);
      if (!ticketId || !ids.has(ticketId) || seen.has(ticketId)) throw Error('Duplicate or missing scanned-ticket record.');
      seen.add(ticketId);
      if (!validISO(row.scannedAt) || !['camera','photo','manual','details'].includes(row.source)) throw Error('Invalid scan information.');
      const draw = row.draw ? window.JoeDrawTicket?.validate(row.draw) : null;
      if (row.draw && !draw) throw Error('Invalid saved draw details.');
      const imageId = row.imageId == null ? null : text(row.imageId,100);
      if (imageId && !/^[a-zA-Z0-9_-]+$/.test(imageId)) throw Error('Invalid private photo reference.');
      return {ticketId,scannedAt:row.scannedAt,source:row.source,format:text(row.format || 'Details',40),referenceHash:hash(row.referenceHash),imageHash:hash(row.imageHash),imageId,imageError:text(row.imageError || '',240),draw,evaluation:cleanEvaluation(row.evaluation),noticeKey:text(row.noticeKey || '',120),refreshError:!!row.refreshError};
    });
  }
  function save(row) { return bridge()?.saveScan(row) ?? false; }
  function findDuplicate(detail) {
    const reference = hash(detail.referenceHash), image = hash(detail.imageHash);
    return rows().find(row => (reference && row.referenceHash === reference) || (image && row.imageHash === image))?.ticketId || null;
  }
  async function capture(ticket, detail) {
    const draw = detail.drawData ? window.JoeDrawTicket?.validate(detail.drawData) : null;
    const row = {ticketId:ticket.id,scannedAt:validISO(detail.scannedAt) ? detail.scannedAt : new Date().toISOString(),source:['photo','camera','manual'].includes(detail.source) ? detail.source : 'manual',format:String(detail.format || 'Barcode').slice(0,40),referenceHash:hash(detail.referenceHash),imageHash:hash(detail.imageHash),imageId:null,imageError:String(detail.imageError || '').slice(0,240),draw,evaluation:null,noticeKey:'',refreshError:false};
    // Persist metadata immediately; a photo quota failure cannot lose a purchase.
    const metadataSaved=save(row);
    if (detail.imageBlob instanceof Blob) {
      if(!metadataSaved){
        keepMemoryPhoto(ticket.id,detail.imageBlob);
        const latest=meta(ticket.id);if(latest){latest.imageError='Photo is in memory only. Export a private photo backup before closing.';save(latest);}
        detail.imageBlob=null;return row;
      }
      try {
        const image = await window.JoeTicketImages.save(detail.imageBlob);
        if (!bridge()?.get(ticket.id)) { await window.JoeTicketImages.remove(image.imageId); return; }
        // A user may have reviewed the draw while the photo was being written.
        const latest = meta(ticket.id);
        if(latest?.imageId){await window.JoeTicketImages.remove(image.imageId);}
        else if(latest){
          latest.imageId=image.imageId;latest.imageError='';
          if(!save(latest)){
            keepMemoryPhoto(ticket.id,detail.imageBlob);latest.imageId=null;latest.imageError='Photo is in memory only. Export a private photo backup before closing.';save(latest);
            await window.JoeTicketImages.remove(image.imageId);
          }
        }
      } catch (_) {
        keepMemoryPhoto(ticket.id,detail.imageBlob);
        const latest = meta(ticket.id);
        if (latest) { latest.imageError = 'Photo could not be saved on this device. It is in memory only; export a private photo backup before closing.'; save(latest); }
      }
    }
    detail.imageBlob = null;
    return row;
  }
  function category(ticket) {
    const row = meta(ticket.id);
    if (ticket.status === 'collected') return 'claimed';
    if (row?.evaluation?.status === 'potential-winner') return 'potential-winner';
    if (row?.evaluation?.status === 'potential-loser') return 'potential-loser';
    if (ticket.status === 'unclaimed') return 'recorded-winner';
    if (ticket.status === 'loss') return 'recorded-loser';
    return 'pending';
  }
  function matches(ticket, filter) { return filter === 'scanned' ? !!meta(ticket.id)&&meta(ticket.id).source!=='details' : ['official-winner','official-loser'].includes(filter) ? false : category(ticket) === filter; }
  function summaryHTML(ticket) {
    const row = meta(ticket.id), current = category(ticket);
    let label = current === 'potential-winner' ? 'Potential winner · unverified' : current === 'potential-loser' ? 'Potential no prize · unverified' : row?.draw ? row.draw.reviewed ? 'Waiting for comparison' : 'Review draw details' : 'Official check needed';
    if (current === 'claimed') label = 'Claimed · recorded by you';
    if (current === 'recorded-winner') label = 'Win recorded by you';
    if (current === 'recorded-loser') label = 'No prize recorded by you';
    const draw = row?.draw;
    const copy = row?.evaluation ? explain(row.evaluation.reason) : draw ? 'Review your plays and dates, then compare with published results.' : 'Scratch-offs and unread ticket details need the Ohio Lottery app or a retailer.';
    return '<div class="ticket-check-block"><span class="ticket-check-badge '+(['claimed','recorded-winner','recorded-loser'].includes(current)?'recorded':'pending')+'">'+escape(label)+'</span>'+(row?.evaluation?.potentialCents > 0 ? '<strong class="ticket-potential">'+money(row.evaluation.potentialCents)+' potential · not collected</strong>' : '')+'<p>'+escape(copy)+'</p>'+(draw?.drawDates?.length?'<p class="ticket-check-dates">Draw: '+escape(draw.drawDates.join(', '))+(draw.session?' · '+escape(draw.session):'')+' · '+draw.plays.length+' saved play'+(draw.plays.length===1?'':'s')+'</p>':'')+(row?.refreshError?'<p class="ticket-check-warning">Could not refresh. Showing the last saved comparison.</p>':'')+(row?.imageError?'<p class="ticket-check-warning">'+escape(row.imageError)+'</p>':'')+'<div class="ticket-check-actions"><button class="secondary" data-desk-action="review" data-id="'+escape(ticket.id)+'">'+(draw?'Review numbers & dates':'Add draw details')+'</button>'+(draw?'<button class="secondary" data-desk-action="check" data-id="'+escape(ticket.id)+'" '+(BUSY.has(ticket.id)?'disabled':'')+'>'+(BUSY.has(ticket.id)?'Checking…':'Check results')+'</button>':'')+(row?.imageId||memoryPhotos.has(ticket.id)?'<button class="subtle" data-desk-action="photo" data-id="'+escape(ticket.id)+'">View private photo</button>':'')+'<button class="subtle" data-desk-action="attach" data-id="'+escape(ticket.id)+'">'+(row?.imageId?'Replace photo':'Add photo')+'</button><a href="'+OFFICIAL_APP+'" target="_blank" rel="noopener noreferrer">Official ticket check ↗</a></div>'+(row?'<small>'+(row.source==='details'?'Details saved ':'Scanned ')+escape(new Date(row.scannedAt).toLocaleString())+(row.referenceHash?' · private reference '+escape(row.referenceHash.slice(0,10)):'')+'</small>':'')+'</div>';
  }
  function render() {
    if (!$('ticketCheckSummary')) return;
    const all = tickets(), count = kind => all.filter(t => category(t) === kind).length;
    const spent = all.reduce((sum,t) => sum + (t.pricePending ? 0 : t.cost),0), collected = all.reduce((sum,t) => sum + (t.status==='collected'?t.amount:0),0);
    $('ticketCheckSummary').innerHTML = [['Saved tickets',all.length],['Pending / review',count('pending')],['Potential winners',count('potential-winner')],['Claimed (recorded)',count('claimed')],['Total spent',money(spent)],['Officially verified winnings',money(0)],['Recorded cash less spending',money(collected-spent)]].map(([label,value])=>'<div><span>'+escape(label)+'</span><strong>'+escape(value)+'</strong></div>').join('');
    $('resultNoticeState').textContent = bridge()?.notifications() ? 'Result notices are enabled while this app is open. Closed-app push is not connected.' : 'Optional notices tell you when published results are available, never that you won. Checks run while this app is open.';
    $('enableResultNotices').textContent = bridge()?.notifications() ? 'Turn notices off' : 'Enable result notices';
    $('checkAllDraws').disabled = checkingAll;
  }
  function showError(message) { if ($('deskMessage')) { $('deskMessage').textContent = message; $('deskMessage').hidden = !message; } bridge()?.toast(message); }
  async function notifyAvailable(row) {
    const key = row.draw.game + ':' + row.draw.drawDates.join(',') + ':' + (row.draw.session || '');
    if (row.noticeKey === key || !bridge()?.notifications() || !('Notification' in window) || Notification.permission !== 'granted') return;
    row.noticeKey = key;
    save(row);
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) await registration.showNotification('Your '+row.draw.game+' results are available.',{body:'Open Joe’s Lotto to check your ticket.',icon:'./icon-192.png',tag:'joe-results-'+row.ticketId,data:{ticketId:row.ticketId}});
      else new Notification('Your '+row.draw.game+' results are available.',{body:'Open Joe’s Lotto to check your ticket.',tag:'joe-results-'+row.ticketId});
    } catch (_) { showError('Published results are ready. This browser could not display a system notice.'); }
  }
  async function checkTicket(id, {quiet=false} = {}) {
    if (BUSY.has(id)) return;
    const row = meta(id);
    if (!row?.draw?.reviewed) { if (!quiet) openReview(id); return; }
    if (row.draw.needsReview?.length) { if (!quiet) { openReview(id); $('drawReviewError').textContent = explain(row.draw.needsReview[0]); } return; }
    if (row.draw.game === 'KENO') { if (!quiet) showError('KENO needs an official ticket check. Your saved details are safe.'); return; }
    if (row.draw.drawDates.length > 52) return;
    BUSY.add(id); bridge()?.refresh();
    try {
      const results = [];
      for (const date of row.draw.drawDates) {
        const url = new URL('api/draw-results',document.baseURI);
        url.searchParams.set('game',row.draw.game);url.searchParams.set('date',date);
        if (/^Pick /.test(row.draw.game)) url.searchParams.set('session',row.draw.session);
        const response = await fetch(url,{credentials:'same-origin',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
        if (!response.ok) throw Error('Official results are temporarily unavailable.');
        const payload = await response.json();
        for (const result of payload.records || (payload.result?[payload.result]:[])) results.push(result);
      }
      // Do not attach an old response to a ticket the user edited while waiting.
      const latest = meta(id);
      if (!latest || JSON.stringify(latest.draw) !== JSON.stringify(row.draw)) return;
      latest.evaluation = cleanEvaluation({...window.JoeDrawTicket.compare(row.draw,results),checkedAt:new Date().toISOString()});
      latest.refreshError = false;
      save(latest);
      const everyDrawPublished=row.draw.drawDates.every(date=>results.some(result=>
        window.JoeDrawTicket.isPublishedResult(result,{game:row.draw.game,drawDate:date,session:row.draw.session})));
      if (everyDrawPublished) await notifyAvailable(latest);
      if (!quiet) showError(latest.evaluation.status==='pending' ? explain(latest.evaluation.reason) : 'Comparison saved. Official ticket validation is still required.');
    } catch (_) {
      const latest = meta(id);
      if (latest && JSON.stringify(latest.draw) === JSON.stringify(row.draw)) { latest.refreshError=true;save(latest); }
      if (!quiet) showError('Official results could not be loaded. Your ticket is saved; try again when online.');
    } finally { BUSY.delete(id); bridge()?.refresh(); }
  }
  async function checkAll({quiet=false} = {}) {
    if (checkingAll || document.hidden) return;
    checkingAll = true; render();
    try {
      const eligible = rows().filter(row=>row.draw?.reviewed && !row.draw.needsReview.length && row.draw.game!=='KENO' && (!quiet || !row.evaluation || row.evaluation.status==='pending' || row.refreshError)).slice(0,100);
      for (const row of eligible) { if (document.hidden) break; await checkTicket(row.ticketId,{quiet:true}); }
      if (!quiet) showError(eligible.length?'Available draw comparisons refreshed. Open a ticket for its result.':'Review a saved ticket’s draw details to start comparing results.');
    } finally { checkingAll=false;render(); }
  }
  function setChoice(id,value) { $(id).value = value === true ? 'yes' : value === false ? 'no' : ''; }
  const choice = id => $(id).value==='yes'?true:$(id).value==='no'?false:null;
  function reviewFields(){
    const game=$('drawGame').value,pick=/^Pick /.test(game);
    for(const id of ['drawSession','drawPlayType','drawStake'])$(id).closest('.field').hidden=!pick;
    $('drawPowerPlay').closest('.field').hidden=game!=='Powerball';
    $('drawDoublePlay').closest('.field').hidden=game!=='Powerball';
    $('drawMegaplier').closest('.field').hidden=game!=='Mega Millions'||!$('drawDates').value.split(/[\s,;]+/).some(d=>/^\d{4}-/.test(d)&&d<'2025-04-08');
    $('drawKicker').closest('.field').hidden=game!=='Classic Lotto';$('drawKickerNumbers').closest('.field').hidden=game!=='Classic Lotto';
    $('drawPlays').placeholder=pick?'040; 0.50; straight\n123; 1.00; box':'01 12 23 34 45 + 06\n02 13 24 35 46 + 07 x3';
  }
  function openReview(id) {
    const ticket = bridge()?.get(id); if (!ticket) return;
    const row = meta(id), draw = row?.draw;
    $('drawReviewForm').reset();$('drawTicketId').value=id;$('drawReviewError').textContent='';
    $('drawGame').value = draw?.game || (GAMES.includes(ticket.game)?ticket.game:'Powerball');
    $('drawDates').value=draw?.drawDates?.join(', ') || '';$('drawSession').value=draw?.session || '';
    $('drawPlays').value=draw?.plays?.map(play=>(/^Pick /.test(draw.game)?play.numbers.join(''):play.numbers.map(n=>String(n).padStart(2,'0')).join(' '))+(play.bonus!==null?' + '+String(play.bonus).padStart(2,'0'):'')+(play.multiplier?' x'+play.multiplier:'')+(/^Pick /.test(draw.game)?'; '+(play.stakeCents===null?'':(play.stakeCents/100).toFixed(2))+'; '+(play.playType||''):'')).join('\n') || '';
    $('drawPlayType').value=draw?.plays?.[0]?.playType || '';$('drawStake').value=draw?.plays?.[0]?.stakeCents!=null?(draw.plays[0].stakeCents/100).toFixed(2):'';
    $('drawCost').value=ticket.pricePending?'':(ticket.cost/100).toFixed(2);
    for (const [id,key] of [['drawPowerPlay','powerPlay'],['drawMegaplier','megaplier'],['drawKicker','kicker'],['drawDoublePlay','doublePlay']]) setChoice(id,draw?.[key]);
    $('drawKickerNumbers').value=draw?.kickerNumbers?.join('') || '';
    const mixed = /^Pick /.test(draw?.game || '') && new Set(draw.plays.map(play=>String(play.stakeCents)+':'+String(play.playType))).size > 1;
    $('drawOriginalIssues').textContent=(mixed?'These plays have different Pick stakes or types. Their per-line values are preserved after semicolons; check every line. ':'')+(draw?.needsReview?.length ? draw.needsReview.map(explain).join(' ') : 'Check every play and draw date, including any multi-draw or add-on options.');
    reviewFields();if (!$('drawReviewDialog').open) $('drawReviewDialog').showModal();
    $('drawGame').focus();
  }
  function amount(value,allowEmpty=true) {
    if (allowEmpty && value==='') return null;
    if (!/^\d+(\.\d{1,2})?$/.test(value)) throw Error('Enter a dollar amount with at most two decimal places.');
    const cents = Math.round(Number(value)*100);if (!Number.isSafeInteger(cents)||cents<0||cents>100000000) throw Error('The amount is out of range.');return cents;
  }
  async function submitReview(event) {
    event.preventDefault();
    try {
      if (!$('drawReviewed').checked) throw Error('Check the details against the original ticket before saving.');
      const id=$('drawTicketId').value,ticket=bridge()?.get(id);if (!ticket) throw Error('This ticket no longer exists.');
      const game=$('drawGame').value,dates=$('drawDates').value.trim().split(/[\s,;]+/).filter(Boolean);
      const plays=$('drawPlays').value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map((line,index)=>{
        const segments=line.split(';').map(part=>part.trim());if(segments.length>3||segments.length>1&&!/^Pick /.test(game))throw Error('Per-line stakes and types apply only to Pick games.');line=segments[0];
        let multiplier=null;const x=line.match(/\s+x(\d+)\s*$/i);if(x){multiplier=Number(x[1]);line=line.slice(0,x.index);}
        line=line.replace(/^[A-Z]\s*[:.)]\s*/i,'');const parts=line.split('+');if(parts.length>2)throw Error('Use one bonus ball after + on each play.');
        const main=parts[0].trim();if(!/^[\d\s,]+$/.test(main))throw Error('Enter numbers only, one play per line.');
        const numbers=/^Pick /.test(game)&&/^\d{3,5}$/.test(main)?main.split('').map(Number):main.split(/[\s,]+/).filter(Boolean).map(Number);
        const bonus=parts.length===2&&/^\s*\d{1,2}\s*$/.test(parts[1])?Number(parts[1]):null;
        if(parts.length===2&&bonus===null)throw Error('Enter the bonus ball after +.');
        return {label:String.fromCharCode(65+index%26),numbers,bonus,multiplier,stakeCents:/^Pick /.test(game)?amount(segments[1]||$('drawStake').value):null,playType:/^Pick /.test(game)?segments[2]||$('drawPlayType').value||null:null};
      });
      const kicker=$('drawKickerNumbers').value.trim();if(kicker&&!/^\d{6}$/.test(kicker))throw Error('Kicker uses six digits, including leading zeroes.');
      const draw=window.JoeDrawTicket.validate({game,jurisdiction:'OH',drawDates:dates,session:$('drawSession').value||null,plays,powerPlay:game==='Powerball'?choice('drawPowerPlay'):false,megaplier:game==='Mega Millions'&&dates.some(d=>d<'2025-04-08')?choice('drawMegaplier'):false,kicker:game==='Classic Lotto'?choice('drawKicker'):false,doublePlay:game==='Powerball'?choice('drawDoublePlay'):false,kickerNumbers:game==='Classic Lotto'&&kicker?kicker.split('').map(Number):null,totalPriceCents:amount($('drawCost').value),declaredPlayCount:plays.length,declaredDrawCount:dates.length,reviewed:true,source:'user-reviewed'});
      if(!draw)throw Error('Check the number counts, ranges, dates and play options. Some details are invalid.');
      if(!dates.length||!plays.length)throw Error('Add at least one draw date and every play on the ticket.');
      const row=meta(id)||{ticketId:id,scannedAt:new Date().toISOString(),source:'details',format:'Details',referenceHash:null,imageHash:null,imageId:null,imageError:'',noticeKey:'',refreshError:false};
      row.draw=draw;row.evaluation=null;row.noticeKey='';row.refreshError=false;
      const saved=bridge().review(id,row,draw.totalPriceCents);
      $('drawReviewDialog').close();showError(saved?'Draw details saved. Checking published results…':'Details are in memory only. Export a backup before closing.');
      await checkTicket(id);
    } catch(error) { $('drawReviewError').textContent=error.message; }
  }
  async function viewPhoto(id) {
    const row=meta(id);if(!row?.imageId&&!memoryPhotos.has(id))return;
    const epoch=++photoEpoch;
    try {
      const blob=memoryPhotos.get(id)?.blob||await window.JoeTicketImages.get(row.imageId);if(epoch!==photoEpoch)return;if(!blob)throw Error();
      if(photoURL)URL.revokeObjectURL(photoURL);photoURL=URL.createObjectURL(blob);$('ticketPrivatePhoto').src=photoURL;
      $('ticketPhotoDialog').showModal();
    } catch(_) { showError('This photo is unavailable in this browser. Restore a backup containing photos or keep the original ticket.'); }
  }
  async function attachPhoto(event) {
    const file=event.target.files?.[0],id=attachingTicket;event.target.value='';attachingTicket=null;
    if(!file||!id||!bridge()?.get(id))return;
    let image;
    try {
      image=await window.JoeTicketImages.save(file);
      if(!bridge()?.get(id)){await window.JoeTicketImages.remove(image.imageId);return;}
      const row=meta(id)||{ticketId:id,scannedAt:new Date().toISOString(),source:'details',format:'Photo attachment',referenceHash:null,imageHash:null,imageId:null,imageError:'',draw:null,evaluation:null,noticeKey:'',refreshError:false};
      const previousImage=row.imageId;row.imageId=image.imageId;row.imageError='';
      const saved=save(row);
      if(saved){memoryPhotos.delete(id);if(previousImage&&previousImage!==image.imageId)await window.JoeTicketImages.remove(previousImage);}
      else{
        const blob=await window.JoeTicketImages.get(image.imageId);if(blob)keepMemoryPhoto(id,blob);
        row.imageId=previousImage;row.imageError='Replacement photo is in memory only. Export a private photo backup before closing.';save(row);
        await window.JoeTicketImages.remove(image.imageId);
      }
      showError(saved?'Private ticket photo saved.':'Photo is attached in memory only. Export a backup before closing.');
    }catch(_){showError('This photo could not be saved. Try a smaller clear photo; your existing ticket and photo were kept.');}
  }
  async function exportData(includePhotos,scans=rows()) {
    scans=clone(scans);
    const portableMemory=[];
    if(includePhotos)for(const row of scans){const entry=memoryPhotos.get(row.ticketId);if(entry){row.imageId=entry.id;portableMemory.push(entry);}}
    const memoryIds=new Set(portableMemory.map(entry=>entry.id));
    const ids=[...new Set(scans.map(row=>row.imageId).filter(id=>id&&!memoryIds.has(id)))];
    const images=includePhotos&&ids.length?await window.JoeTicketImages.exportAll(ids):[];
    for(const entry of portableMemory){
      const bytes=new Uint8Array(await entry.blob.arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
      images.push({id:entry.id,dataUrl:'data:'+entry.blob.type+';base64,'+btoa(binary)});
    }
    if(JSON.stringify(images).length>12*1024*1024)throw Error('Photos exceed the 12 MB portable backup limit.');
    return {scans,images};
  }
  async function restoreImages(scans,images) {
    if(!Array.isArray(images)||images.length>500)throw Error('Invalid backup photo collection.');
    const mapping=new Map(), used=new Set(scans.map(row=>row.imageId).filter(Boolean));
    const imported=images.map(image=>{if(!image||!used.has(image.id)||mapping.has(image.id))throw Error('Backup photo does not match a ticket.');const id=crypto.randomUUID();mapping.set(image.id,id);return {id,dataUrl:image.dataUrl};});
    if(imported.length)await window.JoeTicketImages.importAll(imported);
    return scans.map(row=>({...row,imageId:row.imageId?mapping.get(row.imageId)||null:null,imageError:row.imageId&&!mapping.has(row.imageId)?'This backup did not include the ticket photo.':'',evaluation:null,refreshError:false,noticeKey:''}));
  }
  async function remove(id) { memoryPhotos.delete(id);const row=meta(id);if(row?.imageId)try{await window.JoeTicketImages.remove(row.imageId);}catch(_){} }
  async function enableNotices() {
    if(bridge()?.notifications()){bridge().setNotifications(false);render();return;}
    if(!('Notification'in window)||!window.isSecureContext){showError('System notices are unavailable in this browser. Result comparisons still work inside the app.');return;}
    let permission;try{permission=await Notification.requestPermission();}catch(_){showError('This browser could not enable notices. Results remain available inside the app.');return;}if(permission!=='granted'){showError('Notices were not enabled. You can still check results in My tickets.');return;}
    bridge().setNotifications(true);render();checkAll({quiet:true});
  }
  function init() {
    if(initialized||!$('tickets'))return;initialized=true;
    const panel=document.createElement('div');panel.className='panel ticket-check-dashboard';panel.innerHTML='<p class="eyebrow">YOUR TICKETS, WITH CLEAR RESULTS</p><div id="ticketCheckSummary" class="ticket-check-summary"></div><p class="fine muted">Potential prizes are estimates from reviewed numbers and published results. They are excluded from received cash and verified winnings. Recorded wins and losses are entries you made; an official ticket-validation connection is not available.</p><div class="actions"><button id="checkAllDraws" type="button">Check reviewed draw tickets</button><button id="enableResultNotices" type="button" class="secondary">Enable result notices</button></div><p class="fine muted" id="resultNoticeState"></p><p class="notice" id="deskMessage" role="status" hidden></p>';
    $('tickets').querySelector('.hero').after(panel);
    const filter=$('filterStatus');for(const [value,label]of [['scanned','Scanned tickets'],['potential-winner','Potential winners · unverified'],['potential-loser','Potential no prize · unverified'],['official-winner','Officially verified winners'],['official-loser','Officially verified no prize'],['recorded-winner','Wins recorded by you'],['recorded-loser','No prize recorded by you'],['claimed','Claimed prizes']]){const option=new Option(label,'scan:'+value);filter.add(option);}
    const modal=document.createElement('dialog');modal.id='drawReviewDialog';modal.className='dialog ticket-draw-dialog';modal.setAttribute('aria-labelledby','drawReviewTitle');
    const tri=(id,label)=>'<div class="field"><label for="'+id+'">'+label+'</label><select id="'+id+'"><option value="">Not sure</option><option value="no">No</option><option value="yes">Yes</option></select></div>';
    modal.innerHTML='<div class="dialog-head"><div><p class="eyebrow">MATCH THE ORIGINAL TICKET</p><h2 id="drawReviewTitle">Review numbers & dates</h2></div><button type="button" class="close-button" data-desk-action="close-review" aria-label="Close draw details">×</button></div><div class="dialog-body"><form id="drawReviewForm"><input type="hidden" id="drawTicketId"><p class="notice info" id="drawOriginalIssues"></p><div class="fields"><div class="field"><label for="drawGame">Ohio Lottery game</label><select id="drawGame">'+GAMES.map(g=>'<option>'+escape(g)+'</option>').join('')+'</select></div><div class="field"><label for="drawSession">Pick draw time</label><select id="drawSession"><option value="">Not applicable / not sure</option><option value="midday">Midday</option><option value="evening">Evening</option></select></div><div class="field full"><label for="drawDates">Every draw date (YYYY-MM-DD)</label><input id="drawDates" maxlength="650" placeholder="2026-10-28, 2026-10-31" required><small>Use the draw dates, which may differ from the purchase date.</small></div><div class="field full"><label for="drawPlays">Your plays — one per line</label><textarea id="drawPlays" maxlength="4000" rows="5" placeholder="01 12 23 34 45 + 06\n02 13 24 35 46 + 07 x3" required></textarea><small>For Pick, use 040; 0.50; straight to preserve each line’s stake and type. Defaults apply only where omitted. Use + for the bonus ball. For current Mega Millions, add each play’s printed multiplier, such as x3.</small></div><div class="field"><label for="drawPlayType">Default Pick type (lines without a type)</label><select id="drawPlayType"><option value="">Not applicable / not sure</option><option value="straight">Straight</option><option value="box">Box</option><option value="straight-box">Straight / box</option><option value="wheel">Wheel</option><option value="front-pair">Front pair</option><option value="back-pair">Back pair</option><option value="split-pair">Split pair</option></select></div><div class="field"><label for="drawStake">Default Pick stake per play ($)</label><input id="drawStake" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.50"></div><div class="field"><label for="drawCost">Total paid for this ticket ($)</label><input id="drawCost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Leave blank if unknown"></div>'+tri('drawPowerPlay','Power Play')+tri('drawMegaplier','Legacy Megaplier')+tri('drawKicker','Classic Lotto Kicker')+tri('drawDoublePlay','Double Play')+'<div class="field"><label for="drawKickerNumbers">Kicker digits (if played)</label><input id="drawKickerNumbers" maxlength="6" inputmode="numeric" placeholder="000000"></div></div><label class="checkline"><input type="checkbox" id="drawReviewed" required><span>I checked every play, date and option against my original Ohio Lottery ticket.</span></label><p class="negative" id="drawReviewError" role="alert"></p><div class="actions"><button type="submit">Save reviewed details & check</button><button class="secondary" type="button" data-desk-action="close-review">Cancel</button></div><p class="fine muted">Published-number comparisons are potential results. Keep your original ticket for official validation and prize claims. Lucky for Life comparisons cover historical draws through February 21, 2026.</p></form></div>';
    document.body.append(modal);
    const attach=document.createElement('input');attach.type='file';attach.accept='image/*';attach.id='ticketAttachPhoto';attach.hidden=true;attach.addEventListener('change',attachPhoto);document.body.append(attach);
    const photo=document.createElement('dialog');photo.id='ticketPhotoDialog';photo.className='dialog ticket-photo-dialog';photo.setAttribute('aria-labelledby','ticketPhotoTitle');photo.innerHTML='<div class="dialog-head"><h2 id="ticketPhotoTitle">Your private ticket photo</h2><button type="button" class="close-button" data-desk-action="close-photo" aria-label="Close ticket photo">×</button></div><div class="dialog-body"><img id="ticketPrivatePhoto" alt="Your saved lottery ticket"><p class="fine muted">Stored encrypted in this browser. Keep the original ticket and keep photo backups private.</p></div>';document.body.append(photo);
    $('drawReviewForm').addEventListener('submit',submitReview);$('drawGame').addEventListener('change',reviewFields);$('drawDates').addEventListener('input',reviewFields);
    const guide=$('joeStartGuide');try{if(localStorage.getItem('joes-lotto-guide-read-v1')==='yes'&&guide)guide.open=false;}catch(_){}
    document.addEventListener('click',event=>{if(event.target.closest('[data-action="guide-understood"]')){if(guide)guide.open=false;try{localStorage.setItem('joes-lotto-guide-read-v1','yes');}catch(_){}}});
    photo.addEventListener('close',()=>{photoEpoch++;$('ticketPrivatePhoto').removeAttribute('src');if(photoURL)URL.revokeObjectURL(photoURL);photoURL=null;});
    $('checkAllDraws').addEventListener('click',()=>checkAll());$('enableResultNotices').addEventListener('click',enableNotices);
    document.addEventListener('click',event=>{const button=event.target.closest('[data-desk-action]');if(!button)return;const action=button.dataset.deskAction,id=button.dataset.id;if(action==='review')openReview(id);if(action==='check')checkTicket(id);if(action==='photo')viewPhoto(id);if(action==='attach'){attachingTicket=id;attach.click();}if(action==='close-review')modal.close();if(action==='close-photo')photo.close();});
    navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='joe-open-tickets')bridge()?.navigate('tickets');});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkAll({quiet:true});});
    setInterval(()=>{if(!document.hidden)checkAll({quiet:true});},15*60*1000);
    bridge()?.refresh();checkAll({quiet:true});
  }
  window.JoeTicketDesk=Object.freeze({validateDetails,findDuplicate,capture,category,matches,summaryHTML,prepareRender,render,checkTicket,checkAll,openReview,exportData,restoreImages,remove,forgetMemory:id=>memoryPhotos.delete(id),forgetAllMemory:()=>memoryPhotos.clear()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

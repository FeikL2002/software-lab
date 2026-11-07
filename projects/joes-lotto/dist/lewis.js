/* Lewis: honest local app help, with an optional same-origin AI service. */
(function () {
  'use strict';

  const MAX_QUESTION = 2000;
  const MAX_MESSAGES = 12;
  const TIMEOUT_MS = 20000;
  const SOURCES = Object.freeze({
    ohio: { label: 'Ohio Lottery', url: 'https://www.ohiolottery.com/' },
    scratch: { label: 'Official Ohio scratch-offs', url: 'https://www.ohiolottery.com/games/scratch-offs/' },
    pick3: { label: 'Official Ohio Pick 3', url: 'https://www.ohiolottery.com/games/draw-games/pick-3' },
    pick4: { label: 'Official Ohio Pick 4', url: 'https://www.ohiolottery.com/games/draw-games/pick-4' },
    pick5: { label: 'Official Ohio Pick 5', url: 'https://www.ohiolottery.com/games/draw-games/pick-5' },
    powerball: { label: 'Official Powerball rules', url: 'https://www.powerball.com/faqs' },
    mega: { label: 'Official Mega Millions rules', url: 'https://www.megamillions.com/FAQs.aspx' },
    release: { label: 'Ohio Lottery retailer announcements', url: 'https://www.ohiolottery.com/retailers/retailer-resources/ticket-seller-news' }
  });
  const VIEWS = new Set(['overview', 'scan', 'tickets', 'numbers', 'statsview', 'nearby', 'backup', 'scratch', 'stores']);
  const summaryKeys = ['spentCents', 'collectedCents', 'unclaimedCents', 'netCents', 'ticketCount', 'purchaseCount', 'monthlyLimitCents', 'monthSpentCents', 'unpricedTicketCount'];
  let ui;
  let ready = false;
  let mode = 'local';
  let modeReason = 'AI connection is not set up';
  let probing = null;
  let lastProbe = 0;
  let activeController = null;
  let busy = false;
  let generation = 0;
  let opener = null;
  // Only remote exchanges enter the API context. Local calculations never leak
  // into later requests through assistant history when summary sharing is off.
  let remoteHistory = [];

  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  const ohioYear = () => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric' }).format(new Date());
  const normalized = value => value.toLowerCase().normalize('NFKC').replace(/[’']/g, '').replace(/[^a-z0-9$,.\s-]/g, ' ').replace(/\s+/g, ' ').trim();

  function showStatus() {
    if (!ui) return;
    const offline = navigator.onLine === false;
    ui.status.dataset.mode = mode;
    ui.status.textContent = mode === 'connected'
      ? 'AI connected · Questions are sent to the AI service. Spending stays private unless you include it below.'
      : mode === 'connecting'
        ? 'Connecting to Lewis… App help is available locally.'
        : 'Local app guide · ' + (offline ? 'Offline' : modeReason) + '. App questions and spending totals work on this device.';
    ui.share.disabled = mode !== 'connected';
  }

  function setMode(next, reason) {
    mode = next;
    ready = next === 'connected';
    if (reason) modeReason = reason;
    showStatus();
  }

  async function fetchJSON(url, options, controller) {
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options, { signal: controller.signal }));
      if (!response.ok) {
        const error = new Error('Lewis service returned ' + response.status);
        error.status = response.status;
        throw error;
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) throw new Error('Lewis service is not configured');
      return await response.json();
    } finally { clearTimeout(timeout); }
  }

  function checkConnection(force) {
    if (document.querySelector('meta[name="lewis-service"]')?.content === 'local') {
      setMode('local', 'General AI is not connected');
      return Promise.resolve(false);
    }
    if (probing) return probing;
    if (!force && Date.now() - lastProbe < 30000) return Promise.resolve(ready);
    if (navigator.onLine === false) { setMode('local', 'Offline'); return Promise.resolve(false); }
    lastProbe = Date.now();
    setMode('connecting');
    const controller = new AbortController();
    probing = fetchJSON('/api/lewis/status', { method: 'GET', headers: { Accept: 'application/json' } }, controller)
      .then(result => {
        if (result && result.ready === true) setMode('connected');
        else setMode('local', 'AI connection is not set up');
        return ready;
      })
      .catch(() => { setMode('local', navigator.onLine === false ? 'Offline' : 'AI service is unavailable'); return false; })
      .finally(() => { probing = null; });
    return probing;
  }

  function scrollChat() {
    ui.messages.scrollTop = ui.messages.scrollHeight;
  }

  function addMessage(role, text, options) {
    const data = options || {};
    const row = document.createElement('div');
    row.className = 'lewis-message' + (data.pending ? ' pending' : '') + (data.error ? ' error' : '');
    row.dataset.role = role;
    const label = document.createElement('div');
    label.className = 'lewis-message-label';
    label.textContent = role === 'user' ? 'You' : 'Lewis';
    const bubble = document.createElement('div');
    bubble.className = 'lewis-bubble';
    bubble.style.whiteSpace = 'pre-line';
    bubble.textContent = text;
    row.append(label, bubble);
    if (Array.isArray(data.actions) && data.actions.length) {
      const controls = document.createElement('div');
      controls.className = 'lewis-message-actions';
      data.actions.forEach(action => {
        if (!VIEWS.has(action.view) && !['random', 'recent'].includes(action.method)) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lewis-message-action secondary';
        button.textContent = action.label;
        button.addEventListener('click', async () => {
          const bridge = window.JoeLewisBridge;
          if (!bridge || typeof bridge.navigate !== 'function') {
            addMessage('assistant', 'That screen is not available yet. Use the app navigation to open it.');
            return;
          }
          ui.dialog.close();
          bridge.navigate(action.method ? 'numbers' : action.view);
          if (action.method && typeof bridge.generate === 'function') {
            try { await bridge.generate(action.method); }
            catch (_) { /* The app owns its pause, spending-limit, and result messages. */ }
          }
        });
        controls.append(button);
      });
      bubble.append(controls);
    }
    if (Array.isArray(data.sources) && data.sources.length) {
      const links = document.createElement('div');
      links.className = 'lewis-message-source';
      [...new Set(data.sources)].forEach(key => {
        const source = SOURCES[key];
        if (!source) return;
        const link = document.createElement('a');
        link.className = 'lewis-source';
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = source.label + ' ↗';
        links.append(link);
      });
      bubble.append(links);
    }
    if (data.local) {
      const note = document.createElement('small');
      note.className = 'lewis-message-source';
      note.textContent = data.personal ? 'Calculated here on this device. No spending records were uploaded.' : 'Local app guide · This answer uses the app’s built-in help.';
      bubble.append(note);
    }
    ui.messages.append(row);
    scrollChat();
    return row;
  }

  function setBusy(value) {
    busy = value;
    ui.send.disabled = value;
    ui.question.disabled = value;
    ui.form.setAttribute('aria-busy', String(value));
    ui.send.setAttribute('aria-label', value ? 'Lewis is answering' : 'Send question to Lewis');
    document.querySelectorAll('[data-lewis-prompt]').forEach(button => { button.disabled = value; });
  }

  function periodFor(question) {
    const year = question.match(/\b(20\d{2})\b/);
    if (year) return year[1];
    if (/\b(last|previous) year\b/.test(question)) return String(Number(ohioYear()) - 1);
    if (/\b(all time|all years|ever|overall|lifetime|everything)\b/.test(question)) return 'all';
    if (/\b(this month|monthly|month|limit|budget)\b/.test(question)) return 'month';
    return ohioYear();
  }

  function spendingSummary(period) {
    try {
      if (typeof window.JoeLewisBridge?.summary !== 'function') return null;
      const raw = window.JoeLewisBridge.summary(period);
      if (!raw || typeof raw !== 'object') return null;
      const safe = { year: /^20\d{2}$/.test(String(raw.year)) ? String(raw.year) : ohioYear(), period, monthlyLimitCents: null, monthSpentCents: 0 };
      summaryKeys.forEach(key => {
        const value = raw[key];
        if (key === 'monthlyLimitCents' && value === null) safe[key] = null;
        else if (Number.isSafeInteger(value)) safe[key] = value;
      });
      return ['spentCents', 'collectedCents', 'unclaimedCents', 'netCents', 'ticketCount', 'purchaseCount'].every(key => Number.isSafeInteger(safe[key])) ? safe : null;
    } catch (_) { return null; }
  }

  const go = (label, view) => ({ label, view });
  const pickActions = () => [go('Open My numbers', 'numbers'), { label: 'Fresh random numbers', method: 'random' }, { label: 'Use recent Ohio draws', method: 'recent' }];

  function personalAnswer(question) {
    if (/\b(last|previous) month\b/.test(question)) {
      return { text: 'I can total this month, a calendar year, or all years here. For an earlier month, open My year & savings and choose its year to see the monthly chart.', actions: [go('Open My year & savings', 'statsview')] };
    }
    const period = periodFor(question);
    const summary = spendingSummary(period);
    if (!summary) return { text: 'Open My year & savings to see the totals from your saved purchases. I cannot read a reliable spending summary from this version of the app yet.', actions: [go('Open My year & savings', 'statsview')] };
    const label = period === 'all' ? 'Across all years recorded here' : period === 'month' ? 'For this month' : 'For ' + period;
    let text = label + ', you have recorded ' + money(summary.spentCents) + ' spent on ' + summary.ticketCount + ' ticket' + (summary.ticketCount === 1 ? '' : 's') + ' in ' + summary.purchaseCount + ' purchase' + (summary.purchaseCount === 1 ? '' : 's') + '.\n\n' +
      money(summary.collectedCents) + ' is marked collected. ' + money(summary.unclaimedCents) + ' is marked not collected. Cash collected minus spending is ' + money(summary.netCents) + '.\n\n' +
      'This includes purchases you saved in this browser. Missing purchases are not estimated. The year follows the purchase date, so collected prizes stay with the year their ticket was bought.';
    if (summary.unpricedTicketCount > 0) text += '\n\n' + summary.unpricedTicketCount + ' scanned ticket(s) still need a price. They are excluded from this spending total until you add the amount paid.';
    if (/\b(limit|budget|monthly)\b/.test(question)) {
      text += '\n\n' + (summary.monthlyLimitCents === null
        ? 'You have not set a monthly spending limit. You can set one in My year & savings, including $0.'
        : 'Your monthly limit is ' + money(summary.monthlyLimitCents) + '. Recorded spending this month is ' + money(summary.monthSpentCents || 0) + '. ' + (summary.monthSpentCents >= summary.monthlyLimitCents ? 'The app pauses new number generation while the limit is reached.' : money(summary.monthlyLimitCents - (summary.monthSpentCents || 0)) + ' remains below that ceiling.'));
    }
    return { text, personal: true, actions: [go('View my year & savings', 'statsview'), go('Review my tickets', 'tickets')] };
  }

  function localAnswer(input) {
    const q = normalized(input);
    if (/^(hi|hey|hello|hiya|good morning|good evening|thanks|thank you|thankyou|ok|okay|great|awesome|cool)( lewis)?[.! ]*$/.test(q)) {
      return { text: /thank|great|awesome|cool/.test(q) ? 'You’re welcome, Joe. I’m here when you need a hand with the app.' : 'Hey, Joe. I can help you scan a ticket, understand your totals, find the map, or choose a number-picking method. What would you like a hand with?', actions: [go('Scan a ticket', 'scan'), go('See my year', 'statsview')] };
    }
    if (/\b(real ai|artificial intelligence|chatgpt|who are you|what are you|are you ai|connected|connection|offline|anything|what can you|help me use|how do i use)\b/.test(q)) {
      return { text: 'I’m Lewis, your companion inside Joe’s Lotto. Right now I’m running as a local app guide. I can explain the scanner, your recorded spending, backups, maps, and the two number-picking options. I can also calculate totals from this browser.\n\nA full AI service is not available right now, so I cannot reliably answer every general question. The status above will say “AI connected” when that service is ready.', actions: [go('Open My tickets', 'tickets'), go('Open My numbers', 'numbers'), go('Open My year & savings', 'statsview')] };
    }
    if (/\b(install|installation|home screen|homescreen|add to home|dock|pwa)\b/.test(q)) {
      return { text: 'On the Home screen, tap Add to home screen or Install Joe’s Lotto. You can also open More → Install Joe’s Lotto. If your browser offers an install screen, confirm it.\n\nOn Android, open the app link in Chrome, tap the ⋮ menu and look for Install and create shortcut, Install app or Add to Home screen. Then open the green Joe’s Lotto icon. The app has its own window and keeps your tickets on this device.\n\nInstall from the same browser you already use for Joe’s Lotto so your records stay together. Back up your JSON records before changing browsers or devices. Maps, winner updates and sending an update request need internet.', actions: [go('Open More & install help', 'more')] };
    }
    if (/\b(privacy|private|share|shared|sharing|upload|cloud|sync|synchronize|device|devices|android|mac|saved|save|data|records)\b/.test(q) && /\b(privacy|private|share|shared|sharing|upload|cloud|sync|synchronize|device|devices|android|mac|data|records|stored|where)\b/.test(q) && !/\b(number|numbers|favorite|favorites|spent|spending|total|won|winnings|barcode|scan|scanning)\b/.test(q)) {
      return { text: 'Ticket records stay in this browser on this device. Android and Mac do not sync automatically. Export a full JSON backup in Settings, then restore it on the other device. Restoring replaces that device’s existing records, so export its backup first if you need to keep them.\n\nLocal app-guide answers can calculate your totals here without uploading records. If AI is connected, typed chat questions go to that service. “Include my spending summary” starts off and only adds computed totals when you choose it. Scanned codes, store notes, and location are not attached to chat requests. Chat history lasts for this page session and is cleared by Clear chat.', actions: [go('Open Settings & backups', 'backup')] };
    }
    if (/\b(backup|restore|export|import|csv|json|clear chat|delete chat)\b/.test(q)) {
      return { text: 'Open Settings for a full JSON backup. That file keeps tickets, saved numbers, settings, store notes, and restock observations. Keep it somewhere private. Restore a JSON backup when moving to another browser or device; restoring replaces the records already there.\n\nCSV export is a spreadsheet copy of ticket history. Use JSON when you want a backup that the app can restore. “Clear chat” below removes only this conversation, and leaves your saved tickets alone.', actions: [go('Open Settings & backups', 'backup')] };
    }
    if (/\b(scan|scanner|barcode|bar code|camera|upc|ticket price|cost of (this|a|the) ticket)\b/.test(q)) {
      return { text: 'Open Scan and show the product barcode on one ticket. A recognized code adds the game and published unit price automatically. For other tickets, show the printed game number on the back or the game name and price, then tap Read game & price. You can also choose a clear full-ticket photo.\n\nThe on-device text reader can look up every game in the current Ohio scratch-off reference from a legible printed game number in its documented back-of-ticket layout. It can also recognize an exact printed title and price. Older repeated game names need the correct game number. Draw tickets require the printed game name and an explicit total cost; it never guesses the amount wagered. Clear photos and good light matter, so universal recognition is not guaranteed.\n\nThe text reader downloads on its first use. Photos can be saved encrypted in this browser. Recognized text and raw codes are not retained or uploaded. Private photo backups contain readable images; keep them private. Unclear prices stay out of spending totals. A remembered product-barcode choice can still fill a future scan on this device. Edit the amount, quantity or date if needed. Only Ohio Lottery or a licensed retailer can validate prizes.', actions: [go('Open the scanner', 'scan'), go('Add or review a ticket', 'tickets')], sources: ['scratch'] };
    }
    if (/\b(check.*ticket|ticket.*(?:win|won|los|result)|potential winner|potential loser|verification|verified|result.*available|notifications?)\b/.test(q)) {
      return {text:'Open My tickets and choose Review numbers & dates. Check every printed play, draw date, Pick session, stake and add-on against the original Ohio ticket, then save the reviewed details. The app retrieves official published winning numbers and compares supported plays locally. Your ticket numbers and photos are not sent with the results request.\n\nA potential winner or potential no-prize label is a comparison, not official ticket validation. Potential prizes never enter recorded cash or verified winnings. Some wagers, jackpots and add-ons still need an official amount check. Scratch-offs use the official Ohio Lottery app or a retailer.\n\nOptional system notices say only that results are available. Checks run while this app is open; closed-app push is not connected. Lucky for Life is historical through February 21, 2026. Photos remain encrypted in this browser and can be included in a private JSON backup.',actions:[go('Review and check tickets','tickets'),go('Back up records and photos','backup')],sources:['ohio']};
    }
    if (/\b(location|map|maps|earth|satellite|nearby|near me|gps|where.*won|winning store|winner|winners|reports)\b/.test(q)) {
      return { text: 'Open Around me and tap “Use my location” to see official Ohio Lottery stores within 1, 3 or 5 miles. You can also enter an Ohio town or ZIP, or move the map and tap “Search this map area.” Blue pins are stores; green pins are reported winners. The stores include different chains and independent shops.\n\nWinner stories refresh from Ohio Lottery’s press room. The map shows each story’s publication date and the last successful check. Checks run every 15 minutes while the map is open, with an hourly background refresh. Tap “Refresh reports” to request the newest available server response. These are published stories, not every win. Stories without a verified retailer location stay in the list without a pin.\n\nYour exact GPS stays in memory; only a rounded map area goes to the store search. Satellite imagery comes from Esri and Google Earth opens separately. A store’s past winner does not improve its next ticket’s odds. Call the store for current hours and ticket availability.', actions: [go('Open Around me', 'nearby')], sources: ['ohio'] };
    }
    if (/\b(delivery|deliveries|delivered|restock|shipment|new ticket|new game|arrival|arrive|eta|inventory|stock)\b/.test(q)) {
      return { text: 'Ohio Lottery publishes statewide new-game announcements. This app does not have a verified store-by-store delivery feed or exact arrival times.\n\nIn Around me, you can save a time the store confirmed or a time you personally observed new tickets. Any pattern shown comes from those dated notes. It is an observation to check with the store, and cannot promise when tickets will arrive or be available.', actions: [go('View restock notes', 'nearby'), go('Open my stores', 'stores')], sources: ['release'] };
    }
    if (/\b(random|generate|generator|pick numbers|choose numbers|pick me|my numbers|lucky|hot number|cold number|predict|prediction|predictive|winning numbers|recent|draws|draw|powerball|mega millions|pick 3|pick 4|pick 5|number|numbers|odds)\b/.test(q)) {
      let text = 'In My numbers, choose Pick 3, Pick 4, Pick 5, Powerball, or Mega Millions. Then choose how Lewis should pick:\n\nFresh random numbers uses secure random selection within the game’s rules.\n\nFrom recent Ohio draws uses a saved window of official published results. Numbers appearing in that window get additional selection weight; Pick 3/4/5 digits use their own positions, and main and bonus balls use separate pools. The app shows the source dates and number of draws used. If verified data is unavailable for a game, that option stays unavailable.\n\nPast results do not predict the next draw or improve the chance of a chosen ticket. Both options respect your pause setting and monthly limit. Generating or saving numbers does not buy a ticket.';
      if (/\b(pick 3|pick 4|pick 5)\b/.test(q)) text += '\n\nPick 3/4/5 allow leading zeroes and repeated digits. Keep the full digit string when saving or copying your picks.';
      return { text, actions: pickActions(), sources: /mega/.test(q) ? ['mega'] : /powerball/.test(q) ? ['powerball'] : ['pick3', 'pick4', 'pick5'] };
    }
    if (/\b(saving|savings|millionaire|millionair|saved instead|put aside|invest|interest|per day|a day|daily)\b/.test(q)) {
      const daily = q.match(/\$?([0-9]{1,6}(?:\.[0-9]{1,2})?)\s*(?:dollars?\s*)?(?:a|per|each|every)\s*day/);
      const years = q.match(/\b([0-9]{1,3})\s*years?\b/);
      if (daily && years && Number(years[1]) > 0 && Number(years[1]) <= 100) {
        const dailyCents = Math.round(Number(daily[1]) * 100);
        const total = dailyCents * 365 * Number(years[1]);
        if (Number.isSafeInteger(total)) return { text: money(dailyCents) + ' a day × 365 days × ' + Number(years[1]) + ' years adds up to ' + money(total) + '.\n\nThat is a simple “money put aside” example. It does not assume investment growth, lottery returns, or inflation. Open My year & savings to move the daily amount and years yourself.', personal: true, actions: [go('Explore My year & savings', 'statsview')] };
      }
      return { text: 'My year & savings includes a “What if you saved it?” calculator. Choose a daily amount and a number of years to see daily amount × 365 × years.\n\nFor example, $10 a day for 20 years adds up to $73,000 put aside. The calculator uses no investment-growth or future-winnings assumption. Your actual spending total comes from the purchases saved here.', actions: [go('Explore My year & savings', 'statsview')] };
    }
    if (/\b(limit|budget|pause|paused|stop|spending|spend|spent|total|yearly|annual|collected|unclaimed|winnings|profit|net|cash back|lost|loss|money|ticket count|how many tickets|how much have i won|how much did i win)\b/.test(q)) {
      if (/\b(how|work|works|mean|meaning|explain|difference)\b/.test(q) && !/\b(how much|how many|my limit|my budget|i spent|i spend|have i|did i|my winnings|my profit|my net)\b/.test(q)) {
        return { text: 'Your spending total is the total paid on saved purchases, including losing and unchecked tickets. Quantity is the ticket count; the saved total paid is the amount counted, so it is not multiplied twice. Scans marked Price needed are excluded until you enter their price.\n\nCollected means cash actually received. Not collected means a recorded prize that has not been received yet, so it stays separate from cash back. Cash collected minus spending is the net figure. Totals follow each ticket’s purchase date.\n\nMy year & savings shows one calendar year at a time and an all-years total. Missing purchases are not guessed. Your monthly spending limit is a ceiling you choose; reaching it pauses new number generation.', actions: [go('Open My year & savings', 'statsview'), go('Set my spending limit', 'statsview')] };
      }
      return personalAnswer(q);
    }
    if (/\b(ticket|tickets|check|checked|prize|claim|won|win|record|edit|mistake|duplicate)\b/.test(q)) {
      return { text: 'In My tickets, add a ticket by hand or scan its barcode. A readable scan adds one ticket automatically. Supported games use their published price; other scans are marked Price needed and do not count as spending until you add the amount paid. Use Edit details to correct the date, game, price, or quantity. You can add a store and notes too.\n\nUse Update or Edit to correct a purchase or change its status: Not checked, No prize, Not collected, or Collected. Enter cash actually paid to you for Collected. “Again” starts another purchase with the old details, so confirm its date and price before saving.\n\nLewis and the barcode scanner do not confirm prizes. Check the ticket through Ohio Lottery’s official service or a licensed retailer.', actions: [go('Open My tickets', 'tickets'), go('Scan a ticket', 'scan')], sources: ['ohio'] };
    }
    if (/\b(install|home screen|homescreen|app icon|download|add to home)\b/.test(q)) {
      return { text: 'On Android, open this app in Chrome and use the browser’s install or “Add to Home screen” option when available. On Mac, you can keep the app in a browser tab or use your browser’s app-install option. The core app can work offline after its first online visit.\n\nMap tiles, external official links, and a connected AI service need internet. Records remain in the browser where you entered them; keep a JSON backup before changing browsers or devices.', actions: [go('Open Settings & backups', 'backup')] };
    }
    return { text: 'I can help with Joe’s Lotto in local app-guide mode. A full AI service is not available right now, so I cannot reliably answer that wider question yet.\n\nTry asking “How do I scan a ticket?”, “How much have I spent this year?”, “How do the recent-draw picks work?”, or “How do I move my records to another device?”', actions: [go('Open My tickets', 'tickets'), go('Open My numbers', 'numbers')] };
  }

  // Do not send pasted ticket identifiers, GPS pairs, or conversation excerpts
  // containing them to the optional AI service. Game picks and ordinary dollar
  // amounts remain valid chat text; raw codes are only handled by the scanner.
  function containsPrivateCode(text) {
    return /\b(?:\d[ -]?){9,}\b/.test(text) || /\b(?:barcode|bar code|ticket code|ticket number|serial|upc)\s*(?:is|:|#)?\s*[a-z0-9-]{8,}\b/i.test(text) || /[-+]?\d{1,3}\.\d{3,}[\s,;]+[-+]?\d{1,3}\.\d{3,}/.test(text);
  }

  async function answer(input) {
    if (busy) return;
    const question = String(input || '').trim().slice(0, MAX_QUESTION);
    if (!question) return;
    addMessage('user', question);
    ui.question.value = '';
    setBusy(true);
    const requestGeneration = generation;
    const pending = addMessage('assistant', 'One moment…', { pending: true });
    try {
      if (probing) await probing;
      if (generation !== requestGeneration) return;
      let fallbackNote = '';
      if (navigator.onLine === false) setMode('local', 'Offline');
      if (ready && !containsPrivateCode(question)) {
        const controller = new AbortController();
        activeController = controller;
        // Turning summary sharing off also removes any earlier AI replies that
        // could repeat shared totals. Metadata is never sent to the service.
        const context = remoteHistory.filter(entry => ui.share.checked || !entry.includesSummary);
        const messages = context.concat({ role: 'user', content: question }).slice(-MAX_MESSAGES).map(entry => ({ role: entry.role, content: entry.content }));
        const body = { messages };
        if (ui.share.checked) {
          const summary = spendingSummary(periodFor(normalized(question)));
          if (summary) body.summary = summary;
        }
        try {
          const result = await fetchJSON('/api/lewis', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }, controller);
          if (generation !== requestGeneration) return;
          const reply = result && (result.reply || result.message);
          if (typeof reply !== 'string' || !reply.trim() || reply.length > 16000) throw new Error('Lewis returned an unreadable answer');
          pending.remove();
          addMessage('assistant', reply.trim());
          const includesSummary = Boolean(body.summary) || context.some(entry => entry.includesSummary);
          remoteHistory = messages.map(entry => Object.assign({}, entry, { includesSummary })).concat({ role: 'assistant', content: reply.trim(), includesSummary }).slice(-MAX_MESSAGES);
          return;
        } catch (error) {
          if (generation !== requestGeneration) return;
          const reason = error.status === 429 ? 'AI is busy right now' : navigator.onLine === false ? 'Offline' : error.name === 'AbortError' ? 'AI request timed out' : 'AI service is unavailable';
          setMode('local', reason);
          fallbackNote = reason + '. I’ve switched to the local app guide for this answer.\n\n';
        }
      } else if (ready && containsPrivateCode(question)) {
        fallbackNote = 'I kept that question on this device because it appears to include a ticket code or precise coordinates. Use the scanner for ticket codes.\n\n';
      }
      if (generation !== requestGeneration) return;
      const response = localAnswer(question);
      pending.remove();
      addMessage('assistant', fallbackNote + response.text, Object.assign({}, response, { local: true }));
    } finally {
      pending.remove();
      activeController = null;
      if (generation === requestGeneration) {
        setBusy(false);
        if (ui.dialog.open && !window.matchMedia('(max-width: 720px)').matches) ui.question.focus({ preventScroll: true });
      }
    }
  }

  function resetChat() {
    generation += 1;
    if (activeController) activeController.abort();
    activeController = null;
    remoteHistory = [];
    ui.messages.replaceChildren();
    ui.question.value = '';
    ui.share.checked = false;
    setBusy(false);
    addMessage('assistant', 'Fresh start, Joe. This conversation has been cleared. Your saved tickets and spending records are still here.');
    ui.question.focus({ preventScroll: true });
  }

  function open(prompt) {
    if (!ui) return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!ui.dialog.open) {
      if (typeof ui.dialog.showModal === 'function') ui.dialog.showModal();
      else ui.dialog.setAttribute('open', '');
    }
    checkConnection(false);
    if (typeof prompt === 'string' && prompt.trim()) {
      ui.question.value = prompt.trim().slice(0, MAX_QUESTION);
      ui.question.focus({ preventScroll: true });
    } else if (!window.matchMedia('(max-width: 720px)').matches) ui.question.focus({ preventScroll: true });
  }

  function init() {
    const ids = ['Dialog', 'Messages', 'Form', 'Question', 'Send', 'Close', 'Status', 'Clear', 'ShareRecords'];
    const nodes = ids.map(suffix => document.getElementById('lewis' + suffix));
    if (nodes.some(node => !node)) return;
    ui = Object.fromEntries(ids.map((name, index) => [name.charAt(0).toLowerCase() + name.slice(1), nodes[index]]));
    // Short, predictable aliases keep the UI contract independent of CSS.
    ui.share = ui.shareRecords;
    ui.question.maxLength = MAX_QUESTION;
    ui.share.checked = false;
    showStatus();
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      const trigger = target?.closest('[data-lewis-open], [data-action="open-lewis"]');
      if (trigger) { open(); return; }
      const quick = target?.closest('[data-lewis-prompt]');
      if (quick && !busy) answer(quick.dataset.lewisPrompt);
    });
    ui.form.addEventListener('submit', event => { event.preventDefault(); answer(ui.question.value); });
    ui.question.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!busy) answer(ui.question.value);
      }
    });
    ui.close.addEventListener('click', () => ui.dialog.close());
    ui.clear.addEventListener('click', resetChat);
    ui.dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });
    ui.dialog.addEventListener('click', event => {
      if (event.target !== ui.dialog) return;
      const bounds = ui.dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) ui.dialog.close();
    });
    window.addEventListener('offline', () => { setMode('local', 'Offline'); if (activeController) activeController.abort(); });
    window.addEventListener('online', () => { if (ui.dialog.open) checkConnection(true); });
    checkConnection(false);
  }

  window.LewisBot = Object.freeze({ open, getMode: () => mode, status: () => ({ mode, ready, reason: modeReason }) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

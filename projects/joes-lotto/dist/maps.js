/* Joe's Lotto — official retailer search and refreshing winner stories. Exact GPS stays in memory. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const OHIO = [40.36, -82.8], REFRESH_MS = 15 * 60 * 1000;
  const savedDataUrl = new URL('./data/ohio-winners.json', document.currentScript?.src || document.baseURI).href;
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const markerById = new Map(), retailerMarkerById = new Map();
  let map, layers, satelliteLabels, winnerMarkers, retailerMarkers, ownMarker, accuracyCircle, radiusCircle, viewObserver, tileStatus;
  let records = [], winnerData = {}, retailers = [], retailerData = {}, selected = null, ownPosition = null, retailerCenter = null;
  let query = '', loadingWinners = false, loadingRetailers = false, winnersLoaded = false, bound = false, layerName = 'satellite';
  let lastWinnerAttempt = 0, retailerRequest = 0, retailerOrigin = 'map', retailerStale = false;
  const normalize = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const dateLabel = value => {
    if (!value) return 'Date not supplied';
    const d = new Date(String(value).slice(0, 10) + 'T12:00:00');
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const checkedLabel = value => {
    const d = new Date(value);
    return !value || Number.isNaN(d.getTime()) ? 'check time unavailable' : d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  };
  const prizeLabel = value => typeof value === 'number' ? money.format(value) : String(value || 'Winner story');
  const eventLabel = record => record.eventDateType === 'drawing' ? 'Draw date' : record.eventDateType === 'bet placed' ? 'Bet placed' : 'Event date';
  const hasPoint = record => Number.isFinite(record.lat) && Number.isFinite(record.lng) && record.lat >= 38 && record.lat <= 43 && record.lng >= -85 && record.lng <= -80;
  const isApproximate = record => record.precision !== 'retailer';
  const storyKey = record => String(record.articleId || record.sourceUrl || record.id);
  const isDraw = record => /^(draw|keno|ezplay)$/i.test(record.gameType || '') || /pick [345]|powerball|mega millions|classic lotto|rolling cash/i.test(record.game || '');
  const isScratch = record => /scratch|instant/i.test(record.category || record.gameType || record.ticketType || '') || record.type === 'scratch';
  const isVisible = () => !!$('lottoMap')?.offsetWidth && !document.hidden;
  const safeLink = value => {
    try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch (_) { return ''; }
  };
  const radius = () => Number($('mapRadius')?.value || 5);
  const placeMode = () => ['zip', 'city'].includes(retailerData.query?.mode);
  function element(tag, className, content) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (content !== undefined) el.textContent = content;
    return el;
  }
  function link(label, url) {
    const a = element('a', '', label);
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }
  function setStatus(message, state = '') {
    const status = $('mapStatus');
    if (status) { status.textContent = message; status.dataset.state = state; }
  }
  function setTileStatus(message = '') {
    if (!tileStatus && $('lottoMap')) {
      tileStatus = element('p', 'map-tile-status'); tileStatus.setAttribute('role', 'status');
      $('lottoMap').closest('.lotto-map-wrap')?.after(tileStatus);
    }
    if (tileStatus) { tileStatus.textContent = message; tileStatus.hidden = !message; }
  }
  function distanceMiles(a, b) {
    const rad = Math.PI / 180, lat = (b[0] - a[0]) * rad, lng = (b[1] - a[1]) * rad;
    const x = Math.sin(lat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(lng / 2) ** 2;
    return 3958.7613 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function textMatch(record) {
    return !query || normalize([record.name, record.retailer, record.city, record.address, record.zip, record.game, record.title].join(' ')).includes(query);
  }
  function filteredWinners() {
    const type = $('mapFilter')?.value || 'all';
    return records.filter(r => (type !== 'scratch' || isScratch(r)) && (type !== 'draw' || isDraw(r)) && textMatch(r)).sort((a, b) => String(b.publicationDate || b.date || '').localeCompare(String(a.publicationDate || a.date || '')));
  }
  function nearbyRetailers() {
    return retailers.filter(r => placeMode() || (retailerCenter && hasPoint(r) && distanceMiles(retailerCenter, [r.lat, r.lng]) <= radius()));
  }
  function filteredRetailers() {
    const center = retailerCenter || ownPosition;
    return nearbyRetailers().filter(textMatch).sort((a, b) => center ? (hasPoint(a) ? distanceMiles(center, [a.lat, a.lng]) : Infinity) - (hasPoint(b) ? distanceMiles(center, [b.lat, b.lng]) : Infinity) : String(a.name).localeCompare(String(b.name)));
  }
  function directionsUrl(record) {
    const url = new URL('https://www.google.com/maps/search/');
    url.searchParams.set('api', '1');
    url.searchParams.set('query', [record.name || record.retailer, record.address, record.city, record.state || 'Ohio', record.zip].filter(Boolean).join(', '));
    return url.href;
  }
  function setEarthLink(record) {
    const a = $('mapEarth'); if (!a) return;
    const center = hasPoint(record || {}) ? [record.lat, record.lng] : map ? [map.getCenter().lat, map.getCenter().lng] : OHIO;
    a.href = 'https://earth.google.com/web/search/' + encodeURIComponent(center.map(n => n.toFixed(6)).join(',')) + '/';
    a.title = record ? 'Open this location in Google Earth' : 'Open the map center in Google Earth';
  }
  function selectRecord(record, kind = 'winner', focusMap = false) {
    selected = { record, kind }; setEarthLink(record);
    document.querySelectorAll('.map-winner-card[data-id],.map-retailer-card[data-id]').forEach(card => { card.dataset.selected = String(card.dataset.id === record.id && card.dataset.kind === kind); });
    if (focusMap && map && hasPoint(record)) {
      map.setView([record.lat, record.lng], kind === 'winner' && isApproximate(record) ? 11 : 15);
      const toggle = $(kind === 'winner' ? 'mapShowWinners' : 'mapShowRetailers');
      if (toggle && !toggle.checked) { toggle.checked = true; renderMarkers(); }
      (kind === 'winner' ? markerById : retailerMarkerById).get(record.id)?.openPopup();
      $('lottoMap')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  function winnerPopup(record) {
    const box = element('div', 'map-popup');
    box.append(element('strong', '', prizeLabel(record.prize)), element('div', 'map-popup-game', record.game || record.title || 'Ohio Lottery winner story'));
    if (record.title && normalize(record.title) !== normalize(record.game)) box.append(element('div', 'map-popup-fine', record.title));
    box.append(element('div', '', record.retailer || record.city || 'Location not supplied'));
    if (record.retailer && record.city) box.append(element('div', '', record.city + ', Ohio'));
    box.append(element('div', 'map-popup-fine', 'Story published ' + dateLabel(record.publicationDate || record.date)));
    box.append(element('div', 'map-popup-fine', isApproximate(record) ? 'Town area marker · not the exact retailer' : 'Retailer address · approximate map position'));
    if (record.prizeBasis === 'annuity-total' && record.note) box.append(element('div', 'map-popup-fine', record.note));
    const source = safeLink(record.sourceUrl); if (source) box.append(link('Ohio Lottery story ↗', source));
    if (record.retailer || record.address) box.append(link('Google Maps ↗', directionsUrl(record)));
    return box;
  }
  function retailerPopup(record) {
    const box = element('div', 'map-popup map-retailer-popup');
    box.append(element('div', 'map-popup-tag', 'OHIO LOTTERY RETAILER'), element('strong', '', record.name || 'Lottery retailer'));
    if (record.address) box.append(element('div', '', record.address));
    box.append(element('div', '', [record.city, record.state || 'OH', record.zip].filter(Boolean).join(' ')));
    box.append(element('div', 'map-popup-fine', 'Listed by Ohio Lottery. Call ahead for hours and ticket availability.'));
    box.append(link('Directions ↗', directionsUrl(record)));
    return box;
  }
  function renderMarkers() {
    if (!map || !winnerMarkers || !retailerMarkers) return;
    winnerMarkers.clearLayers(); retailerMarkers.clearLayers(); markerById.clear(); retailerMarkerById.clear();
    if ($('mapShowWinners')?.checked) filteredWinners().filter(hasPoint).forEach(record => {
      const icon = L.divIcon({ className: 'map-marker-icon', html: '<div class="map-pin' + (isApproximate(record) ? ' city-pin' : '') + '" aria-hidden="true">✳</div>', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -21] });
      const marker = L.marker([record.lat, record.lng], { icon, title: [record.game || record.title, prizeLabel(record.prize), record.city, isApproximate(record) ? 'town area' : 'retailer location'].filter(Boolean).join(' · '), keyboard: true, zIndexOffset: 100 });
      marker.bindPopup(winnerPopup(record), { maxWidth: 270 }).on('click', () => selectRecord(record)).addTo(winnerMarkers); markerById.set(record.id, marker);
    });
    if ($('mapShowRetailers')?.checked) filteredRetailers().filter(hasPoint).forEach(record => {
      const icon = L.divIcon({ className: 'map-marker-icon', html: '<div class="map-store-pin" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10a3 3 0 0 0 4.5 2.5 3 3 0 0 0 4.5 0 3 3 0 0 0 4.5 0A3 3 0 0 0 21 10M9 20v-6h6v6"/></svg></div>', iconSize: [36, 40], iconAnchor: [18, 38], popupAnchor: [0, -35] });
      const marker = L.marker([record.lat, record.lng], { icon, title: [record.name, record.address, record.city].filter(Boolean).join(' · '), keyboard: true });
      marker.bindPopup(retailerPopup(record), { maxWidth: 270 }).on('click', () => selectRecord(record, 'retailer')).addTo(retailerMarkers); retailerMarkerById.set(record.id, marker);
    });
    if (radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }
    if ($('mapShowRetailers')?.checked && retailerCenter && !placeMode()) radiusCircle = L.circle(retailerCenter, { radius: radius() * 1609.344, color: '#327bed', weight: 1.5, dashArray: '5 7', fillColor: '#327bed', fillOpacity: 0.025, interactive: false }).addTo(map);
  }
  function renderWinnerCards(list) {
    const target = $('mapWinnerList'); if (!target) return; target.replaceChildren();
    if (!list.length) {
      const empty = element('div', 'map-empty');
      empty.append(element('strong', '', query || records.length ? 'No matching winner stories.' : 'No winner stories loaded yet.'), document.createTextNode(query || records.length ? 'Try another filter. The feed includes Ohio Lottery’s published stories, not every winning ticket.' : 'The store search still works. Tap Refresh reports to try the official stories again.')); target.append(empty); return;
    }
    list.forEach(record => {
      const card = element('article', 'map-winner-card'); card.dataset.id = record.id; card.dataset.kind = 'winner'; card.dataset.selected = String(record.id === selected?.record.id && selected?.kind === 'winner');
      const top = element('div', 'map-winner-top'); top.append(element('strong', '', prizeLabel(record.prize)), element('span', 'winner-type', isScratch(record) ? 'Scratch-off' : record.gameType === 'draw' ? 'Draw game' : 'Winner story')); card.append(top);
      card.append(element('h3', '', record.game || record.title || 'Ohio Lottery ticket'));
      if (record.title && normalize(record.title) !== normalize(record.game)) card.append(element('p', '', record.title));
      const locationCount = records.filter(item => storyKey(item) === storyKey(record)).length;
      if (locationCount > 1) card.append(element('p', 'map-story-location-note', 'One of ' + locationCount + ' reported store locations in this story'));
      card.append(element('p', 'map-location-detail', [record.retailer, record.city ? record.city + ', OH' : 'Ohio'].filter(Boolean).join(' · ')));
      if (record.address) card.append(element('p', '', record.address));
      card.append(element('p', '', 'Story published ' + dateLabel(record.publicationDate || record.date)));
      if (record.eventDate) card.append(element('p', '', eventLabel(record) + ': ' + dateLabel(record.eventDate)));
      if (record.purchaseDate) card.append(element('p', '', 'Ticket purchased: ' + dateLabel(record.purchaseDate)));
      if (record.note && record.prizeBasis === 'annuity-total') card.append(element('p', '', record.note));
      if (ownPosition && hasPoint(record)) { const miles = distanceMiles(ownPosition, [record.lat, record.lng]); card.append(element('p', 'map-location-distance', 'About ' + miles.toFixed(miles < 10 ? 1 : 0) + ' miles from you · straight line')); }
      card.append(element('p', 'map-precision', hasPoint(record) ? isApproximate(record) ? 'Town area · exact store not pinned' : 'Retailer address · approximate position' : 'No verified map position · story only'));
      const actions = element('div', 'map-card-links');
      if (hasPoint(record)) { const btn = element('button', 'secondary', 'Show on map'); btn.type = 'button'; btn.addEventListener('click', () => selectRecord(record, 'winner', true)); actions.append(btn); }
      const source = safeLink(record.sourceUrl); if (source) actions.append(link('Official story ↗', source));
      if (record.retailer || record.address) actions.append(link('Google Maps ↗', directionsUrl(record))); card.append(actions); target.append(card);
    });
  }
  function renderRetailerCards(list) {
    const target = $('mapRetailerList'); if (!target) return;
    if (!retailerData.query && !loadingRetailers) return;
    target.replaceChildren();
    if (!list.length) { const empty = element('div', 'map-empty'); empty.append(element('strong', '', query ? 'No matching stores in these results.' : 'No listed stores found here.'), document.createTextNode(query ? 'Clear the filter to see the loaded stores.' : placeMode() ? 'Try a nearby town or ZIP, or search the map area.' : 'Try a larger radius, another town or ZIP, or move the map and search that area.')); target.append(empty); return; }
    list.forEach(record => {
      const card = element('article', 'map-retailer-card'); card.dataset.id = record.id; card.dataset.kind = 'retailer'; card.dataset.selected = String(record.id === selected?.record.id && selected?.kind === 'retailer');
      const head = element('div', 'map-store-heading'); head.append(element('span', 'map-store-badge', '▤'), element('h3', '', record.name || 'Ohio Lottery retailer')); card.append(head);
      if (record.address) card.append(element('p', '', record.address));
      card.append(element('p', '', [record.city, record.state || 'OH', record.zip].filter(Boolean).join(' ')));
      if (retailerCenter && hasPoint(record)) { const miles = distanceMiles(retailerCenter, [record.lat, record.lng]); card.append(element('p', 'map-location-distance', miles.toFixed(1) + ' mi' + (retailerOrigin === 'location' ? ' from you' : ' from searched center') + ' · straight line')); }
      if (!hasPoint(record)) card.append(element('p', 'map-precision', 'Listed retailer · no verified map position'));
      const actions = element('div', 'map-card-links'); actions.append(link('Directions ↗', directionsUrl(record)));
      if (hasPoint(record)) { const btn = element('button', 'secondary', 'On map'); btn.type = 'button'; btn.addEventListener('click', () => selectRecord(record, 'retailer', true)); actions.append(btn); }
      const phone = String(record.phone || '').replace(/[^\d+]/g, '');
      if (phone.length >= 10) { const call = element('a', '', 'Call store'); call.href = 'tel:' + phone; actions.append(call); }
      card.append(actions); target.append(card);
    });
  }
  function updateRetailerStatus() {
    const status = $('retailerStatus'); if (!status || !retailerData.query) return;
    const list = filteredRetailers(), all = nearbyRetailers(), mode = placeMode();
    const origin = retailerOrigin === 'location' ? 'your location' : 'the searched map center';
    $('mapRetailerHeading').textContent = mode ? 'Lottery stores in ' + (retailerData.query.place || 'this area') : 'Lottery stores within ' + radius() + (radius() === 1 ? ' mile' : ' miles');
    const where = mode ? 'Ohio Lottery listings matching ' + (retailerData.query.place || 'your town or ZIP') + '. Town and ZIP searches show all returned listings; no mile filter is applied.' : 'All ' + all.length + ' listed stores within ' + radius() + (radius() === 1 ? ' mile of ' : ' miles of ') + origin + '.';
    const unmapped = !mode ? retailers.filter(r => !hasPoint(r)).length : 0;
    status.textContent = (retailerStale || retailerData.stale ? 'Saved results · ' : '') + where + (query ? ' ' + list.length + ' match your filter.' : '') + ' Checked ' + checkedLabel(retailerData.checkedAt) + '.' + (unmapped ? ' ' + unmapped + ' additional listings lack a map position and cannot be placed within this radius.' : '') + (retailerStale || retailerData.stale ? ' The latest check failed; refresh the search when connected.' : ' Source: Ohio Lottery.');
    status.dataset.state = retailerStale || retailerData.stale ? 'stale' : 'fresh';
    if ($('mapRadius')) { $('mapRadius').disabled = mode; $('mapRadius').title = mode ? 'Town and ZIP searches show all returned listings. Use Search this map area for a mile radius.' : ''; }
  }
  function updateWinnerStatus() {
    const status = $('mapSnapshot'); if (!status || !winnersLoaded) return;
    const coverage = winnerData.coverage;
    const count = Number.isInteger(coverage?.storyCount) ? coverage.storyCount : new Set(records.map(storyKey)).size;
    const mapped = records.filter(hasPoint).length;
    let windowText = coverage && typeof coverage === 'object' && coverage.from ? ' Story dates ' + dateLabel(coverage.from) + (coverage.to && coverage.to !== coverage.from ? '–' + dateLabel(coverage.to) : '') + '.' : '';
    const saved = winnerData.status === 'saved' || winnerData.saved;
    const stale = winnerData.stale || saved;
    status.textContent = (saved ? 'Saved offline snapshot' : stale ? 'Saved official results' : 'Official stories checked') + (saved ? ' · saved ' + dateLabel(winnerData.checkedAt || winnerData.updatedAt) : ' ' + checkedLabel(winnerData.checkedAt)) + ' · ' + count + (count === 1 ? ' story' : ' stories') + ', ' + mapped + ' mapped locations.' + windowText + (stale ? ' A current check could not finish. Tap Refresh reports when connected.' : ' Checks refresh every 15 minutes while this screen is open.');
    status.dataset.state = stale ? 'stale' : 'fresh';
  }
  function render() { renderWinnerCards(filteredWinners()); renderRetailerCards(filteredRetailers()); renderMarkers(); updateRetailerStatus(); updateWinnerStatus(); }
  function cleanRecords(list, kind) {
    return list.filter(r => r && typeof r === 'object').map((record, i) => ({ ...record, id: String(record.id || kind + '-' + i), lat: typeof record.lat === 'number' ? record.lat : null, lng: typeof record.lng === 'number' ? record.lng : null }));
  }
  async function fetchJSON(url, timeout = 18000) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
    try { const response = await fetch(url, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error('Service unavailable'); const data = await response.json(); if (!Array.isArray(data.records)) throw new Error('Invalid data'); return data; } finally { clearTimeout(timer); }
  }
  async function loadWinners(force = false) {
    if (loadingWinners || (!force && Date.now() - lastWinnerAttempt < REFRESH_MS)) return;
    loadingWinners = true; lastWinnerAttempt = Date.now();
    const button = $('mapRefreshReports'); if (button) { button.disabled = true; button.textContent = 'Checking…'; }
    if ($('mapSnapshot')) $('mapSnapshot').textContent = 'Checking the latest official Ohio Lottery stories…';
    try {
      const data = await fetchJSON('/api/winners'); winnerData = data; records = cleanRecords(data.records, 'winner'); winnersLoaded = true; render();
    } catch (_) {
      if (winnersLoaded) { winnerData = { ...winnerData, stale: true }; render(); }
      else {
        try { const data = await fetchJSON(savedDataUrl, 8000); winnerData = { ...data, checkedAt: data.updatedAt || data.lastChecked, saved: true, stale: true, status: 'saved' }; records = cleanRecords(data.records, 'winner'); winnersLoaded = true; render(); }
        catch (_) { records = []; renderWinnerCards([]); if ($('mapSnapshot')) { $('mapSnapshot').textContent = 'Winner stories are unavailable. Reconnect and tap Refresh reports. The store search is separate.'; $('mapSnapshot').dataset.state = 'error'; } }
      }
    } finally { loadingWinners = false; if (button) { button.disabled = false; button.textContent = 'Refresh reports'; } }
  }
  async function loadRetailers(options) {
    const requestId = ++retailerRequest;
    loadingRetailers = true; const params = new URLSearchParams();
    if (options.place) params.set('place', options.place);
    else { params.set('lat', options.center[0].toFixed(2)); params.set('lng', options.center[1].toFixed(2)); }
    $('mapPlaceButton').disabled = true; $('mapSearchArea').disabled = true;
    setStatus('Finding official Ohio Lottery retailers' + (options.place ? ' in ' + options.place : ' around this area') + '…');
    try {
      const data = await fetchJSON('/api/retailers?' + params.toString()); if (requestId !== retailerRequest) return;
      retailerData = { ...data, query: data.query || { mode: options.place ? (/^\d{5}$/.test(options.place) ? 'zip' : 'city') : 'nearby', place: options.place } };
      retailers = cleanRecords(data.records, 'retailer'); retailerCenter = options.place ? null : [...options.center]; retailerOrigin = options.origin || 'map'; retailerStale = false;
      selected = null; render();
      const points = filteredRetailers().filter(hasPoint);
      if (options.place && map && points.length) map.fitBounds(L.latLngBounds(points.map(record => [record.lat, record.lng])), { padding: [36, 36], maxZoom: 14 });
      else if (!options.place && map) { map.setView(options.center, radius() === 1 ? 14 : 12); }
      setStatus(placeMode() ? 'Showing official listings for ' + (retailerData.query.place || options.place) + '. Tap a blue store pin or choose Directions below.' : 'Showing listed stores around ' + (retailerOrigin === 'location' ? 'your location' : 'the searched map center') + '. Use Store radius to adjust the range, or move the map to search another area.', data.stale ? 'stale' : '');
      setEarthLink();
    } catch (_) {
      if (requestId !== retailerRequest) return;
      retailerStale = true; updateRetailerStatus();
      setStatus(retailers.length ? 'The store search could not update. Your previous results are still shown. Reconnect and search again.' : 'The store search is unavailable right now. Try again, or use the official locator link below.', 'error');
      if (!retailers.length && $('retailerStatus')) { $('retailerStatus').textContent = 'No retailer data has been loaded. Reconnect and retry your location or town search. The official locator is also available.'; $('retailerStatus').dataset.state = 'error'; }
    } finally { if (requestId === retailerRequest) { loadingRetailers = false; $('mapPlaceButton').disabled = false; $('mapSearchArea').disabled = false; } }
  }
  function setLayer(name) {
    layerName = name;
    if (map && layers) {
      Object.values(layers).forEach(layer => { if (map.hasLayer(layer)) map.removeLayer(layer); });
      if (satelliteLabels && map.hasLayer(satelliteLabels)) map.removeLayer(satelliteLabels);
      layers[name].addTo(map); if (name === 'satellite' && satelliteLabels) satelliteLabels.addTo(map); setTileStatus('');
    }
    $('mapSatellite')?.setAttribute('aria-pressed', String(name === 'satellite')); $('mapStreet')?.setAttribute('aria-pressed', String(name === 'street'));
    const label = document.querySelector('.map-provider-label'); if (label) label.textContent = name === 'satellite' ? 'SATELLITE · ESRI WORLD IMAGERY' : 'STREET · OPENSTREETMAP';
  }
  function makeMap() {
    const target = $('lottoMap'); if (!target || map || !target.offsetWidth) return;
    if (!window.L) { setStatus('The map could not start. Store listings and official story links below still work.', 'error'); return; }
    map = L.map(target, { zoomControl: true, scrollWheelZoom: false, tap: true }).setView(OHIO, 7);
    layers = {
      satellite: L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a>, Vantor, Earthstar Geographics, and the GIS User Community' }),
      street: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>' })
    };
    satelliteLabels = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, pane: 'overlayPane', attribution: 'Labels: Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community' });
    Object.values(layers).forEach(layer => { layer.on('tileerror', () => setTileStatus('Some map images could not load. Try the other map style or check your connection. Store listings and story links remain available.')); });
    winnerMarkers = L.layerGroup().addTo(map); retailerMarkers = L.layerGroup().addTo(map); L.control.scale({ metric: false, imperial: true, position: 'bottomleft' }).addTo(map); setLayer(layerName); setEarthLink(); renderMarkers();
    map.on('moveend', () => { setEarthLink(); const moved = retailerCenter && distanceMiles(retailerCenter, [map.getCenter().lat, map.getCenter().lng]) > 0.25; $('mapSearchArea')?.classList.toggle('map-area-moved', !!moved); });
    if (ownPosition) showOwnPosition();
  }
  function showOwnPosition(accuracy) {
    if (!map || !ownPosition) return;
    if (ownMarker) map.removeLayer(ownMarker); if (accuracyCircle) map.removeLayer(accuracyCircle);
    const icon = L.divIcon({ className: 'map-marker-icon', html: '<div class="map-own-pin" aria-hidden="true"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    ownMarker = L.marker(ownPosition, { icon, title: 'Your device location', zIndexOffset: 2000 }).addTo(map).bindPopup('Your device location · kept in memory for this visit only.');
    if (Number.isFinite(accuracy)) accuracyCircle = L.circle(ownPosition, { radius: accuracy, color: '#327bed', weight: 1, fillColor: '#327bed', fillOpacity: 0.08, interactive: false }).addTo(map);
    map.setView(ownPosition, 12);
  }
  function locate() {
    const button = $('mapLocate');
    if (!navigator.geolocation) { setStatus('This browser does not provide location. Enter an Ohio town or ZIP instead.', 'error'); return; }
    if (!window.isSecureContext) { setStatus('Location needs a secure HTTPS app address. Enter a town or ZIP here instead.', 'error'); return; }
    button.disabled = true; button.textContent = 'Finding you…'; setStatus('Waiting for your location permission. Your exact position is not saved or sent to the store search.');
    navigator.geolocation.getCurrentPosition(position => {
      ownPosition = [position.coords.latitude, position.coords.longitude]; selected = null; makeMap(); showOwnPosition(position.coords.accuracy); render();
      button.disabled = false; button.textContent = 'Refresh my location';
      loadRetailers({ center: ownPosition, origin: 'location' });
    }, error => {
      const message = error.code === 1 ? 'Location permission was declined. Enter an Ohio town or ZIP, or allow location in browser settings and retry.' : error.code === 3 ? 'Finding your location took too long. Retry or enter an Ohio town or ZIP.' : 'Your device could not locate you. Retry or enter an Ohio town or ZIP.';
      setStatus(message, 'error'); button.disabled = false; button.textContent = 'Use my location';
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  }
  function searchPlace(event) {
    event?.preventDefault(); const place = $('mapPlace').value.trim().replace(/\s+/g, ' ');
    if (!place || (!/^\d{5}$/.test(place) && !/^[A-Za-z .'-]{2,80}$/.test(place))) { setStatus('Enter an Ohio town name or a five-digit ZIP code.', 'error'); $('mapPlace').focus(); return; }
    makeMap(); loadRetailers({ place, origin: 'place' });
  }
  function searchArea() {
    makeMap(); const center = map ? [map.getCenter().lat, map.getCenter().lng] : ownPosition || OHIO;
    loadRetailers({ center, origin: 'map' });
  }
  function search() { query = normalize($('mapSearch')?.value.trim()); selected = null; render(); }
  function refresh(force = false) {
    makeMap(); if (map) { requestAnimationFrame(() => map.invalidateSize()); setTimeout(() => map.invalidateSize(), 150); }
    if (isVisible()) loadWinners(force);
  }
  function init() {
    if (!$('lottoMap') || bound) return; bound = true;
    $('mapLocate')?.addEventListener('click', locate); $('mapPlaceForm')?.addEventListener('submit', searchPlace); $('mapSearchArea')?.addEventListener('click', searchArea);
    $('mapSatellite')?.addEventListener('click', () => setLayer('satellite')); $('mapStreet')?.addEventListener('click', () => setLayer('street'));
    $('mapShowRetailers')?.addEventListener('change', renderMarkers); $('mapShowWinners')?.addEventListener('change', renderMarkers);
    $('mapRadius')?.addEventListener('change', () => { render(); if (retailerCenter && map) map.setView(retailerCenter, radius() === 1 ? 14 : 12); });
    $('mapSearchButton')?.addEventListener('click', search); $('mapSearch')?.addEventListener('input', search); $('mapFilter')?.addEventListener('change', search);
    $('mapRefreshReports')?.addEventListener('click', () => loadWinners(true));
    const view = $('lottoMap').closest('.view');
    if (view) { viewObserver = new MutationObserver(() => { if (!view.hidden) refresh(); }); viewObserver.observe(view, { attributes: true, attributeFilter: ['hidden', 'class'] }); }
    window.addEventListener('resize', () => { if (isVisible()) refresh(); });
    document.addEventListener('visibilitychange', () => { if (isVisible()) refresh(); });
    window.addEventListener('online', () => { if (isVisible()) loadWinners(true); });
    setInterval(() => { if (isVisible()) loadWinners(); }, 60000);
    refresh();
  }
  window.JoeMap = Object.freeze({ init, refresh });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

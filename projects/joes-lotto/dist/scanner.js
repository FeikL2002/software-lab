/* Joe's Lotto: local barcode recognition. Ticket validation remains with the lottery. */
(() => {
  'use strict';

  const NATIVE_FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'pdf417', 'data_matrix', 'qr_code', 'upc_a', 'upc_e', 'ean_13', 'ean_8', 'aztec'];
  const FORMAT_LABELS = {
    code_128: 'Code 128', code_39: 'Code 39', code_93: 'Code 93', codabar: 'Codabar', itf: 'ITF',
    pdf417: 'PDF417', data_matrix: 'Data Matrix', qr_code: 'QR code', upc_a: 'UPC-A', upc_e: 'UPC-E',
    ean_13: 'EAN-13', ean_8: 'EAN-8', aztec: 'Aztec',
    CODE_128: 'Code 128', CODE_39: 'Code 39', CODE_93: 'Code 93', CODABAR: 'Codabar', ITF: 'ITF',
    PDF_417: 'PDF417', DATA_MATRIX: 'Data Matrix', QR_CODE: 'QR code', UPC_A: 'UPC-A', UPC_E: 'UPC-E',
    EAN_13: 'EAN-13', EAN_8: 'EAN-8', AZTEC: 'Aztec', RSS_14: 'GS1 DataBar', RSS_EXPANDED: 'GS1 DataBar Expanded',
  };
  let ui;
  let session = 0;
  let stream = null;
  let timer = 0;
  let guideTimer = 0;
  let canvas = null;
  let reader = null;
  let productReader = null;
  let cameraCandidate = null;
  let candidateSince = 0;
  let cameraTrack = null;
  let torchOn = false;
  let imageUrl = null;
  let imageElement = null;
  let rejectImageLoad = null;
  let pendingFormat = null;
  let pendingFingerprint = null;
  let pendingGameMatch = null;
  let pendingProductFingerprint = null;
  let mode = 'idle';
  let detectorPromise = null;
  let textController = null;
  let textAutoTried = false;
  let cameraDetector = null;
  let pendingDetails = null;
  let selectedCameraId = '';
  let cameraFacing = 'environment';
  let availableCameras = [];

  function nativeDetector() {
    if (!detectorPromise) {
      detectorPromise = (async () => {
        if (!window.BarcodeDetector || typeof window.BarcodeDetector.getSupportedFormats !== 'function') return null;
        try {
          const available = await window.BarcodeDetector.getSupportedFormats();
          const formats = NATIVE_FORMATS.filter(format => available.includes(format));
          return formats.length ? new window.BarcodeDetector({ formats }) : null;
        } catch (_) {
          return null;
        }
      })();
    }
    return detectorPromise;
  }

  function makeReader(tryHarder = false, productOnly = false) {
    if (!window.ZXingBrowser?.BrowserMultiFormatReader) return null;
    // Default multi-format decoder includes both one- and two-dimensional formats.
    // DecodeHintType.TRY_HARDER is 3 in the pinned official 0.2.1 UMD bundle;
    // the browser bundle exports BarcodeFormat but not DecodeHintType.
    const hints = new Map();
    if (tryHarder) hints.set(3, true);
    if (productOnly) {
      const formats = window.ZXingBrowser.BarcodeFormat;
      if (formats) hints.set(2, [formats.UPC_A, formats.EAN_13]);
    }
    return new window.ZXingBrowser.BrowserMultiFormatReader(hints);
  }

  function status(message, nextMode = mode) {
    mode = nextMode;
    ui.status.textContent = message;
    ui.screen.dataset.scannerState = mode;
    ui.screen.setAttribute('aria-busy', String(['starting', 'photo', 'processing', 'text'].includes(mode)));
    ui.start.disabled = ['starting', 'camera', 'photo', 'processing', 'text'].includes(mode);
    ui.stop.disabled = !['starting', 'camera', 'photo', 'processing', 'text'].includes(mode);
    ui.stop.hidden = !['starting', 'camera', 'photo', 'processing', 'text'].includes(mode);
    if (ui.readText) { ui.readText.hidden = !stream; ui.readText.disabled = mode !== 'camera'; }
    if (ui.saveUnknown) ui.saveUnknown.disabled = mode !== 'camera';
    if (ui.torch && mode !== 'camera') ui.torch.disabled = true;
    else if (ui.torch) ui.torch.disabled = false;
    if (ui.cameraSelect) ui.cameraSelect.disabled = mode !== 'camera';
    if (ui.switchCamera) ui.switchCamera.disabled = mode !== 'camera';
    if (ui.manualCode) ui.manualCode.disabled = ['starting', 'camera', 'photo', 'processing', 'text'].includes(mode);
    if (ui.manualFormat) ui.manualFormat.disabled = ['starting', 'camera', 'photo', 'processing', 'text'].includes(mode);
    if (ui.startLabel) ui.startLabel.textContent = mode === 'starting' ? 'Opening camera…' : 'Start camera';
  }

  function clearImage() {
    const cancelLoad = rejectImageLoad;
    rejectImageLoad = null;
    if (cancelLoad) cancelLoad(new Error('ScanCanceled'));
    if (imageElement) {
      imageElement.onload = null;
      imageElement.onerror = null;
      imageElement.removeAttribute('src');
      imageElement = null;
    }
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
      imageUrl = null;
    }
  }

  function releaseResources() {
    textController?.abort();
    textController = null;
    textAutoTried = false;
    cameraDetector = null;
    window.clearTimeout(timer);
    window.clearTimeout(guideTimer);
    timer = 0;
    guideTimer = 0;
    cameraCandidate = null;
    candidateSince = 0;
    cameraTrack = null;
    torchOn = false;
    if (ui?.torch) { ui.torch.hidden = true; ui.torch.disabled = false; ui.torch.setAttribute('aria-pressed', 'false'); ui.torch.textContent = 'Light on'; }
    if (ui?.saveUnknown) ui.saveUnknown.hidden = true;
    if (ui?.readText) ui.readText.hidden = true;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    if (ui?.video) {
      ui.video.pause();
      ui.video.srcObject = null;
      ui.video.hidden = true;
    }
    clearImage();
    if (canvas) {
      // Release decoder pixels. A successful scan may already have copied one
      // compressed full-ticket image for the app's private photo store.
      canvas.width = 0;
      canvas.height = 0;
      canvas = null;
    }
    reader = null;
    productReader = null;
  }

  function stop(message = 'Scanner stopped. Start the camera or choose a photo to try again.', nextMode = 'idle') {
    session += 1;
    releaseResources();
    pendingFormat = null;
    pendingFingerprint = null;
    pendingGameMatch = null;
    pendingProductFingerprint = null;
    pendingDetails = null;
    if (!ui) return;
    ui.confirm.hidden = true;
    ui.format.textContent = '';
    status(message, nextMode);
  }

  function formatLabel(format) {
    return FORMAT_LABELS[format] || 'Barcode';
  }

  function zxingFormat(result) {
    const code = result.getBarcodeFormat();
    const enumName = window.ZXingBrowser?.BarcodeFormat?.[code];
    return formatLabel(enumName);
  }

  function nativeCandidates(codes) {
    return Array.from(codes || []).filter(code => typeof code?.rawValue === 'string' && code.rawValue.length > 0 && code.rawValue.length <= 8192)
      .slice(0, 40).map(code => ({ rawValue: code.rawValue, format: formatLabel(code.format) }));
  }

  function decodedCandidate(result) {
    const rawValue = result.getText();
    return typeof rawValue === 'string' && rawValue.length > 0 && rawValue.length <= 8192 ? { rawValue, format: zxingFormat(result) } : null;
  }

  async function selectCandidate(candidates) {
    const readable = candidates.filter(Boolean);
    if (!readable.length) return null;
    try {
      const selection = await window.JoeTicketIntelligence?.selectCandidate(readable);
      if (selection?.ambiguous) return { ambiguous: true };
      if (selection && readable[selection.index]) return { ...readable[selection.index], gameMatch: selection.gameMatch, kind: selection.kind };
      // Older cached game intelligence can still identify each candidate.
      for (const candidate of readable) {
        const gameMatch = await window.JoeTicketIntelligence?.identify(candidate.rawValue, candidate.format);
        if (gameMatch) return { ...candidate, gameMatch, kind: 'verified' };
      }
    } catch (_) { /* A catalog lookup failure must not prevent an unpriced scan. */ }
    return { ...readable[0], gameMatch: null, kind: 'other' };
  }

  async function rememberedProduct(candidate) {
    if (!candidate || candidate.kind !== 'product') return false;
    try {
      const fingerprint = await window.JoeTicketIntelligence?.productFingerprint(candidate.rawValue, candidate.format);
      return !!fingerprint && !!window.JoeScanMemory?.has(fingerprint);
    } catch (_) { return false; }
  }

  async function readTicketText(source, currentSession, fallback = null, fromCamera = false) {
    if (currentSession !== session || document.hidden || ui.screen.hidden) return false;
    window.clearTimeout(timer);
    window.clearTimeout(guideTimer);
    textAutoTried = true;
    textController?.abort();
    const controller = new AbortController();
    textController = controller;
    status('Reading the printed game on your device… The first read downloads the text reader.', 'text');
    let result = null;
    let readFailure = '';
    try {
      if (!window.JoeTicketTextReader || !window.JoeTicketTextMatch) throw new Error('TextReaderUnavailable');
      const frame = frameCanvas(source, 2400);
      if (!frame) throw new Error('ImageUnreadable');
      result = await window.JoeTicketTextReader.read(frame, {
        signal: controller.signal,
        timeoutMs: 30000,
        onProgress: progress => {
          if (currentSession !== session || controller.signal.aborted) return;
          status(progress.status === 'reading' ? 'Reading the printed game and price… ' + Math.round(progress.progress * 100) + '%' : 'Preparing the on-device text reader…', 'text');
        },
      });
      if (currentSession !== session || controller.signal.aborted || document.hidden) return false;
      const catalog = await window.JoeTicketIntelligence.ready();
      if (currentSession !== session || controller.signal.aborted) return false;
      const scratch = window.JoeTicketTextMatch.match(result.text, catalog.games);
      const draw = window.JoeTicketTextMatch.matchDraw(result.text);
      const parsedDraw = window.JoeDrawTicket?.parse(result.text);
      const drawData = parsedDraw && window.JoeDrawTicket?.validate(parsedDraw);
      const reference = printedReference(result.text, scratch.gameMatch);
      result.text = '';
      // A photo containing both ticket types is not one identifiable purchase.
      const match = scratch.gameMatch && !draw.candidates.length ? scratch.gameMatch
        : draw.gameMatch && !scratch.candidates.length ? draw.gameMatch : null;
      // A single Ohio draw game can be saved with missing price/numbers/date,
      // clearly pending review, rather than forcing a fabricated wager amount.
      const partialDraw = drawData?.game && drawData.jurisdiction === 'OH' && !scratch.candidates.length;
      if (match || partialDraw) {
        textController = null;
        detected(fallback?.format || 'Printed ticket', currentSession, fallback?.rawValue || null, match, { drawData: partialDraw ? drawData : null, reference });
        return true;
      }
    } catch (error) {
      if (currentSession !== session || controller.signal.aborted || error?.name === 'AbortError') return false;
      readFailure = error?.name === 'TimeoutError' ? 'Reading took too long. Try a closer, well-lit view and tap Read game & price again. '
        : 'The text reader could not finish. Check your connection for its first download, then try again. ';
    } finally {
      if (result) result.text = '';
      if (textController === controller) textController = null;
    }
    if (currentSession !== session || document.hidden || ui.screen.hidden) return false;
    if (fromCamera) {
      status(readFailure + 'Show the printed game number on the back, or the game name and price, then tap Read game & price. Nothing has been added yet.', 'camera');
      if (ui.saveUnknown) ui.saveUnknown.hidden = !cameraCandidate;
      timer = window.setTimeout(() => scanFrame(currentSession, cameraDetector), 350);
    }
    return false;
  }

  function dispatchPendingScan() {
    if (!pendingFormat || document.hidden || ui.screen.hidden) return;
    const detail = { format: pendingFormat, fingerprint: pendingFingerprint, gameMatch: pendingGameMatch, productFingerprint: pendingProductFingerprint, ...pendingDetails };
    // Clear the pending action before notifying the app. A legacy button click
    // or another queued camera frame must not capture the same scan twice.
    stop('Ticket barcode captured. Ready for another ticket.', 'success');
    try { navigator.vibrate?.(60); } catch (_) { /* Haptics must not block capture. */ }
    // The app can change views and stop the scanner synchronously here. Do not
    // update scanner state or UI after this event.
    window.dispatchEvent(new CustomEvent('joe:scanned-ticket', { detail }));
  }

  function printedReference(text, gameMatch) {
    if (!gameMatch?.gameNumber || typeof text !== 'string' || !/\bohio\s*(?:lottery|lotto)\b/i.test(text)) return null;
    const references = new Set();
    for (const line of text.split(/\r?\n/)) {
      // These complete, standalone printed-back layouts are documented by Ohio
      // Lottery. Never infer a serial from a validation barcode or OCR prose.
      const value = line.trim();
      const found = value.match(/^(?:(\d{3})\s*-\s*\d{6}\s*-\s*\d{3}\s*-\s*\d|(\d{4})\s*-\s*\d{7}\s*-\s*\d{3}\s*-\s*\d)$/);
      if (found && String(Number(found[1] || found[2])) === String(Number(gameMatch.gameNumber))) references.add(value.replace(/\s/g, ''));
    }
    return references.size === 1 ? [...references][0] : null;
  }

  async function sha256(value) {
    if (!window.crypto?.subtle) return null;
    let bytes;
    try {
      bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : new TextEncoder().encode(value);
      const digest = await window.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    } catch (_) { return null; }
    finally { bytes?.fill(0); }
  }

  async function snapshot(source) {
    if (!source) return { imageBlob: null, imageHash: null };
    let captured = null;
    try {
      const width = source.videoWidth || source.naturalWidth || source.width;
      const height = source.videoHeight || source.naturalHeight || source.height;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 40000000) throw new Error('ImageDimensions');
      const scale = Math.min(1, 1400 / Math.max(width, height));
      captured = document.createElement('canvas');
      captured.width = Math.max(1, Math.round(width * scale));
      captured.height = Math.max(1, Math.round(height * scale));
      const context = captured.getContext('2d', { alpha: false });
      if (!context) throw new Error('ImageCanvas');
      context.fillStyle = '#fff'; context.fillRect(0, 0, captured.width, captured.height);
      // This synchronous full-frame copy must happen before releaseResources()
      // stops the camera or clears the uploaded image/decoder's cropped canvas.
      context.drawImage(source, 0, 0, captured.width, captured.height);
      for (const quality of [0.82, 0.65, 0.45, 0.3]) {
        const blob = await new Promise(resolve => { const timeout = window.setTimeout(() => resolve(null), 3000); captured.toBlob(value => { window.clearTimeout(timeout); resolve(value); }, 'image/jpeg', quality); });
        if (blob?.type === 'image/jpeg' && blob.size && blob.size <= 300 * 1024) return { imageBlob: blob, imageHash: await sha256(blob) };
      }
      throw new Error('ImageSize');
    } catch (_) { return { imageBlob: null, imageHash: null, imageError: 'The ticket was read, but its photo could not be captured. You can add a clear photo later.' }; }
    finally { if (captured) { captured.width = 0; captured.height = 0; } }
  }

  async function detected(label, currentSession, rawValue, identifiedMatch, extra = {}) {
    if (currentSession !== session || document.hidden || ui.screen.hidden) return;
    // snapshot() copies pixels immediately, before its first await. Barcode-only
    // recognition stays fast and never forces an OCR read for extra details.
    const source = extra.source === 'manual' ? 'manual' : stream ? 'camera' : imageElement ? 'photo' : 'manual';
    const scannedAt = new Date().toISOString();
    const imageTask = snapshot(source === 'camera' ? ui.video : source === 'photo' ? imageElement : null);
    session += 1;
    const completionSession = session;
    releaseResources();
    status('Ticket found. Saving its details…', 'processing');
    let gameMatch = null;
    let productFingerprint = null;
    let fingerprint = null;
    let referenceHash = null;
    let image = null;
    let reference = extra.reference || null;
    try {
      [gameMatch, productFingerprint, fingerprint, referenceHash, image] = await Promise.all([
        Promise.resolve(identifiedMatch || window.JoeTicketIntelligence?.identify(rawValue, label) || null).catch(() => null),
        Promise.resolve(window.JoeTicketIntelligence?.productFingerprint(rawValue, label) || null).catch(() => null),
        typeof rawValue === 'string' && rawValue ? sha256(rawValue) : null,
        reference ? sha256(reference) : null,
        imageTask,
      ]);
    } catch (_) { image = await imageTask; }
    finally { rawValue = null; reference = null; extra.reference = null; }
    if (completionSession !== session || document.hidden || ui.screen.hidden) return;
    // Only hashes and sanitized structured fields leave this module. Raw OCR,
    // decoded codes, and complete printed references are immediately discarded.
    pendingFormat = label;
    pendingFingerprint = /UPC|EAN/i.test(label) || gameMatch?.barcodeIdentity === 'game' ? null : fingerprint;
    pendingGameMatch = gameMatch;
    pendingProductFingerprint = productFingerprint;
    pendingDetails = { ...image, scannedAt, source, referenceHash, drawData: extra.drawData || null };
    dispatchPendingScan();
  }

  function cameraError(error) {
    switch (error?.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return 'Camera permission was blocked. Allow camera access in your browser and retry, or choose a ticket photo.';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'No camera was found. Choose a ticket photo or add the ticket by hand.';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'The camera is busy or unavailable. Close other camera apps and retry, or choose a photo.';
      case 'OverconstrainedError':
        return 'This camera could not start. Try another device, choose a photo, or add the ticket by hand.';
      case 'SecurityError':
        return 'This browser blocked camera access. Open the app over HTTPS, or choose a ticket photo.';
      default:
        return 'The camera could not start. Try again, choose a ticket photo, or add the ticket by hand.';
    }
  }

  function frameCanvas(source, maxDimension, rotation = 0, crop = null) {
    const width = source.videoWidth || source.naturalWidth || source.width;
    const height = source.videoHeight || source.naturalHeight || source.height;
    if (!width || !height) return null;
    const sx = crop ? width * crop[0] : 0;
    const sy = crop ? height * crop[1] : 0;
    const sw = crop ? width * crop[2] : width;
    const sh = crop ? height * crop[3] : height;
    const scale = Math.min(1, maxDimension / Math.max(sw, sh));
    const scaledWidth = Math.max(1, Math.round(sw * scale));
    const scaledHeight = Math.max(1, Math.round(sh * scale));
    if (!canvas) canvas = document.createElement('canvas');
    const sideways = rotation === 90 || rotation === 270;
    canvas.width = sideways ? scaledHeight : scaledWidth;
    canvas.height = sideways ? scaledWidth : scaledHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('CanvasUnavailable');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.drawImage(source, sx, sy, sw, sh, -scaledWidth / 2, -scaledHeight / 2, scaledWidth, scaledHeight);
    return canvas;
  }

  async function scanFrame(currentSession, detector, turn = 0) {
    if (currentSession !== session || mode !== 'camera') return;
    if (ui.video.readyState >= 2 && ui.video.videoWidth > 0) {
      const candidates = [];
      if (detector) {
        try {
          const codes = await detector.detect(ui.video);
          if (currentSession !== session) return;
          candidates.push(...nativeCandidates(codes));
        } catch (_) {
          // Native detection is optional; keep the bundled browser decoder available.
          detector = null;
        }
      }
      if (currentSession !== session) return;
      // A ticket's large validation barcode can hide its smaller product UPC
      // from a general-purpose decoder. Search UPC/EAN explicitly first.
      if (productReader || reader) {
        try {
          const crop = turn % 4 === 2 ? [0, 0.35, 1, 0.65] : turn % 4 === 3 ? [0, 0, 1, 0.65] : null;
          const frame = frameCanvas(ui.video, 1600, turn % 2 ? 90 : 0, crop);
          if (productReader) {
            try { candidates.push(decodedCandidate(productReader.decodeFromCanvas(frame))); } catch (_) {}
          }
          if (reader) {
            try { candidates.push(decodedCandidate(reader.decodeFromCanvas(frame))); } catch (_) {}
          }
        } catch (_) { /* A frame without a readable barcode is expected. */ }
      }
      if (currentSession !== session) return;
      const selection = await selectCandidate(candidates);
      if (currentSession !== session) return;
      if (selection?.ambiguous) {
        cameraCandidate = null;
        candidateSince = 0;
        if (ui.saveUnknown) ui.saveUnknown.hidden = true;
        status('More than one game is visible. Show the barcode on just one ticket.', 'camera');
      } else if (selection?.gameMatch) {
        detected(selection.format, currentSession, selection.rawValue, selection.gameMatch);
        return;
      } else if (selection) {
        if (!cameraCandidate) {
          candidateSince = performance.now();
          status('Barcode read. Looking for the product barcode to find the game and price…', 'camera');
          if (ui.saveUnknown) ui.saveUnknown.hidden = false;
        }
        if (!cameraCandidate || selection.kind === 'product') cameraCandidate = selection;
      }
      if (cameraCandidate && !textAutoTried && performance.now() - candidateSince >= 3000) {
        const fallback = cameraCandidate;
        if (await rememberedProduct(fallback)) {
          if (currentSession === session) detected(fallback.format, currentSession, fallback.rawValue);
          return;
        }
        if (currentSession === session) await readTicketText(ui.video, currentSession, fallback, true);
        return;
      }
    }
    if (currentSession === session) timer = window.setTimeout(() => scanFrame(currentSession, detector, turn + 1), 350);
  }

  async function configureCamera(currentSession) {
    const track = stream?.getVideoTracks()[0];
    cameraTrack = track || null;
    if (!track) return;
    let capabilities;
    try { capabilities = track.getCapabilities?.() || {}; } catch (_) { return; }
    if (capabilities.focusMode?.includes('continuous')) {
      try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (_) {}
    }
    if (currentSession !== session) return;
    if (ui.torch) ui.torch.hidden = !capabilities.torch;
  }

  async function toggleTorch() {
    if (!cameraTrack || mode !== 'camera' || !ui.torch) return;
    const track = cameraTrack;
    const currentSession = session;
    ui.torch.disabled = true;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      if (currentSession !== session) return;
      torchOn = next;
      ui.torch.setAttribute('aria-pressed', String(next));
      ui.torch.textContent = next ? 'Light off' : 'Light on';
    } catch (_) {
      if (currentSession === session) status('This camera could not change its light. Try a brighter place and avoid glare.', 'camera');
    } finally { if (currentSession === session) ui.torch.disabled = false; }
  }

  async function startCamera() {
    if (!ui || document.hidden || ui.screen.hidden) return;
    stop('Opening your camera…', 'starting');
    const currentSession = session;
    if (!window.isSecureContext) {
      stop('Camera scanning needs HTTPS. Choose a ticket photo here, or use the secure app link.', 'error');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      stop('This browser does not support camera scanning. Choose a ticket photo or add the ticket by hand.', 'error');
      return;
    }
    let acquired;
    try {
      // This is called only from the user's Start camera button.
      acquired = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...(selectedCameraId ? { deviceId: { exact: selectedCameraId } } : { facingMode: { ideal: cameraFacing } }), width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (currentSession !== session || document.hidden) {
        acquired.getTracks().forEach(track => track.stop());
        return;
      }
      stream = acquired;
      const detector = await nativeDetector();
      if (currentSession !== session) return;
      cameraDetector = detector;
      reader = makeReader();
      productReader = makeReader(false, true);
      if (!detector && !reader) {
        stop('The barcode reader could not load. Refresh the app or add the ticket by hand.', 'error');
        return;
      }
      ui.video.muted = true;
      ui.video.playsInline = true;
      ui.video.hidden = false;
      ui.video.srcObject = stream;
      await ui.video.play();
      if (currentSession !== session) return;
      await configureCamera(currentSession);
      if (currentSession !== session) return;
      await listCameras(currentSession);
      if (currentSession !== session) return;
      stream.getVideoTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (currentSession === session) stop('The camera disconnected. Start again, choose a photo, or add the ticket by hand.', 'error');
        }, { once: true });
      });
      status('Show the product barcode, or show the printed game and tap Read game & price. Hold one ticket steady.', 'camera');
      guideTimer = window.setTimeout(() => {
        if (currentSession === session && mode === 'camera') status('Show the printed game name, game # and price, then tap Read game & price. A clear full-ticket photo works too.', 'camera');
      }, 16000);
      scanFrame(currentSession, detector);
    } catch (error) {
      if (currentSession !== session) {
        acquired?.getTracks().forEach(track => track.stop());
        return;
      }
      stop(cameraError(error), 'error');
    }
  }

  async function listCameras(currentSession) {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (currentSession !== session) return;
      availableCameras = devices.filter(device => device.kind === 'videoinput' && device.deviceId).slice(0, 20);
      const activeId = cameraTrack?.getSettings?.().deviceId;
      if (activeId) selectedCameraId = activeId;
      if (ui.cameraSelect) {
        ui.cameraSelect.replaceChildren();
        for (let index = 0; index < availableCameras.length; index++) {
          const option = document.createElement('option');
          option.value = availableCameras[index].deviceId;
          option.textContent = availableCameras[index].label || 'Camera ' + (index + 1);
          ui.cameraSelect.append(option);
        }
        if (!availableCameras.length) {
          const option = document.createElement('option'); option.value = ''; option.textContent = 'Default camera'; ui.cameraSelect.append(option);
        }
        ui.cameraSelect.value = selectedCameraId;
      }
    } catch (_) { /* Camera switching can still try front/rear facingMode. */ }
  }

  function switchCamera() {
    if (mode !== 'camera') return;
    if (availableCameras.length > 1) {
      const index = availableCameras.findIndex(device => device.deviceId === selectedCameraId);
      selectedCameraId = availableCameras[(index + 1) % availableCameras.length].deviceId;
    } else { selectedCameraId = ''; cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment'; }
    startCamera();
  }

  function manualScan(event) {
    event.preventDefault();
    if (!ui.manualCode) return;
    let value = ui.manualCode.value.trim();
    ui.manualCode.value = '';
    const chosen = ui.manualFormat?.value || 'Barcode';
    const label = FORMAT_LABELS[chosen] || (Object.values(FORMAT_LABELS).includes(chosen) ? chosen : 'Barcode');
    if (!value || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) {
      value = null; stop('Enter one complete ticket code, up to 8,192 characters. No code was saved.', 'error'); return;
    }
    stop('Checking the entered code…', 'processing');
    const currentSession = session;
    detected(label, currentSession, value, null, { source: 'manual' });
    value = null;
  }

  function loadImage(url, currentSession) {
    return new Promise((resolve, reject) => {
      rejectImageLoad = reject;
      imageElement = new Image();
      imageElement.onload = () => {
        rejectImageLoad = null;
        if (currentSession === session) resolve(imageElement);
      };
      imageElement.onerror = () => {
        rejectImageLoad = null;
        reject(new Error('ImageUnreadable'));
      };
      imageElement.src = url;
    });
  }

  async function scanPhoto(file) {
    if (document.hidden || ui.screen.hidden) {
      stop('Scanner paused while the app was away. Choose a photo again when you are ready.');
      return;
    }
    stop('Reading your photo on this device…', 'photo');
    const currentSession = session;
    if (file.type && !file.type.startsWith('image/')) {
      stop('Choose a JPG, PNG, or other browser-readable image of the ticket.', 'error');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      stop('This photo is too large. Choose a photo under 20 MB, or crop to the barcode and try again.', 'error');
      return;
    }
    try {
      imageUrl = URL.createObjectURL(file);
      const source = await loadImage(imageUrl, currentSession);
      if (currentSession !== session) return;
      const detector = await nativeDetector();
      if (currentSession !== session) return;
      const candidates = [];
      const remember = candidate => {
        if (candidate && candidates.length < 40 && !candidates.some(item => item.rawValue === candidate.rawValue && item.format === candidate.format)) candidates.push(candidate);
      };
      if (detector) {
        try {
          const codes = await detector.detect(source);
          if (currentSession !== session) return;
          nativeCandidates(codes).forEach(remember);
          const selection = await selectCandidate(candidates);
          if (currentSession !== session) return;
          if (selection?.ambiguous) {
            stop('More than one game is in this photo. Choose a photo of just one ticket so the right price is saved.', 'error');
            return;
          }
          if (selection?.gameMatch) {
            detected(selection.format, currentSession, selection.rawValue, selection.gameMatch);
            return;
          }
        } catch (_) { /* Try the bundled multi-format decoder below. */ }
      }
      reader = makeReader(true);
      productReader = makeReader(true, true);
      if (!reader && !detector) {
        stop('The barcode reader could not load. Refresh the app or add the ticket by hand.', 'error');
        return;
      }
      if (reader || detector) {
        // Overlapping crops keep small edge barcodes readable in a whole-ticket
        // photo. Each pass still uses the exact published UPC to assign a price.
        const passes = [
          [0, null], [90, null],
          [0, [0, 0.4, 1, 0.6]], [0, [0, 0, 1, 0.6]],
          [0, [0.4, 0, 0.6, 1]], [0, [0, 0, 0.6, 1]],
          [90, [0, 0.4, 1, 0.6]], [90, [0, 0, 1, 0.6]],
          [0, [0, 0.2, 1, 0.6]], [90, [0.4, 0, 0.6, 1]], [90, [0, 0, 0.6, 1]],
        ];
        for (let index = 0; index < passes.length; index += 1) {
          // Yield between attempts so Stop and navigation can cancel processing.
          await new Promise(resolve => window.setTimeout(resolve, 0));
          if (currentSession !== session) return;
          if (index === 2) status(candidates.length ? 'Barcode read. Checking the rest of the ticket for its game and price…' : 'Looking more closely at the ticket’s barcodes…', 'photo');
          try {
            const [rotation, crop] = passes[index];
            const frame = frameCanvas(source, 2400, rotation, crop);
            if (detector) {
              try {
                const codes = await detector.detect(frame);
                if (currentSession !== session) return;
                nativeCandidates(codes).forEach(remember);
              } catch (_) { /* The bundled decoder can still read this pass. */ }
            }
            if (productReader) {
              try { remember(decodedCandidate(productReader.decodeFromCanvas(frame))); } catch (_) {}
            }
            // Once an unrecognized code has been captured, the remaining work
            // is to find the product code, not repeatedly decode the same serial.
            if (reader && (!candidates.length || index < 2)) {
              try { remember(decodedCandidate(reader.decodeFromCanvas(frame))); } catch (_) {}
            }
            const selection = await selectCandidate(candidates);
            if (currentSession !== session) return;
            if (selection?.ambiguous) {
              stop('More than one game is in this photo. Choose a photo of just one ticket so the right price is saved.', 'error');
              return;
            }
            if (selection?.gameMatch) {
              detected(selection.format, currentSession, selection.rawValue, selection.gameMatch);
              return;
            }
          } catch (_) { /* Try the next crop or orientation. */ }
        }
      }
      if (currentSession !== session) return;
      const fallback = await selectCandidate(candidates);
      if (currentSession !== session) return;
      if (fallback?.ambiguous) {
        stop('More than one game is in this photo. Choose a photo of just one ticket.', 'error');
        return;
      }
      if (await rememberedProduct(fallback)) {
        if (currentSession === session) detected(fallback.format, currentSession, fallback.rawValue);
        return;
      }
      if (currentSession !== session) return;
      if (await readTicketText(source, currentSession, fallback)) return;
      if (currentSession !== session) return;
      if (fallback && !fallback.ambiguous) {
        detected(fallback.format, currentSession, fallback.rawValue);
        return;
      }
      stop('The game could not be read confidently. Try a clear photo of one ticket with its printed game name, game # and price visible. No ticket was added.', 'error');
    } catch (_) {
      if (currentSession === session) stop('This photo could not be opened. Try a JPG or PNG, use the camera, or add the ticket by hand.', 'error');
    }
  }

  function init() {
    const byId = id => document.getElementById(id);
    ui = {
      screen: byId('scan'), video: byId('scannerVideo'), start: byId('scanStart'), stop: byId('scanStop'),
      photo: byId('scanPhoto'), status: byId('scanStatus'), confirm: byId('scanConfirm'),
      use: byId('scanUse'), again: byId('scanAgain'), format: byId('scanFormat'),
    };
    if (Object.values(ui).some(element => !element)) {
      ui = null;
      return;
    }
    ui.startLabel = ui.start.querySelector('[data-scan-start-label]');
    ui.torch = byId('scanTorch');
    ui.saveUnknown = byId('scanSaveUnknown');
    ui.readText = byId('scanReadText');
    ui.cameraSelect = byId('scanCameraSelect');
    ui.switchCamera = byId('scanSwitchCamera');
    ui.manualForm = byId('scanManualForm');
    ui.manualCode = byId('scanManualCode');
    ui.manualFormat = byId('scanManualFormat');
    ui.cameraSelect?.addEventListener('change', () => { if (mode === 'camera') { selectedCameraId = ui.cameraSelect.value; startCamera(); } });
    ui.switchCamera?.addEventListener('click', switchCamera);
    ui.manualForm?.addEventListener('submit', manualScan);
    ui.readText?.addEventListener('click', () => {
      if (mode === 'camera' && ui.video.readyState >= 2) readTicketText(ui.video, session, cameraCandidate, true);
    });
    ui.torch?.addEventListener('click', toggleTorch);
    ui.saveUnknown?.addEventListener('click', () => {
      if (mode !== 'camera' || !cameraCandidate) return;
      const fallback = cameraCandidate;
      detected(fallback.format, session, fallback.rawValue);
    });
    ui.status.setAttribute('role', 'status');
    ui.status.setAttribute('aria-live', 'polite');
    ui.status.setAttribute('aria-atomic', 'true');
    ui.start.addEventListener('click', startCamera);
    ui.stop.addEventListener('click', () => stop());
    ui.photo.addEventListener('change', event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) scanPhoto(file);
    });
    ui.again.addEventListener('click', () => {
      stop('Ready for another ticket. Start the camera or choose a photo.');
      ui.start.focus({ preventScroll: true });
    });
    // Retain the old control safely for cached markup; successful reads now
    // dispatch immediately and leave no pending action for this button.
    ui.use.addEventListener('click', dispatchPendingScan);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && ['starting', 'camera', 'photo', 'processing', 'text'].includes(mode)) stop('Scanner paused while the app was away. Start the camera or choose a photo to continue.');
    });
    window.addEventListener('pagehide', () => stop());
    // Root also calls JoeScanner.stop() during route changes; this covers hidden views.
    new MutationObserver(() => {
      if (ui.screen.hidden && ['starting', 'camera', 'photo', 'processing', 'text', 'success'].includes(mode)) stop();
    }).observe(ui.screen, { attributes: true, attributeFilter: ['hidden'] });
    stop('Show a product barcode, or read the printed game and price. Clear full-ticket photos work too.');
  }

  window.JoeScanner = Object.freeze({ stop: () => stop(), startCamera: () => startCamera() });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

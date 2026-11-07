/* Local ticket OCR. Images and recognized text never leave this browser.
 * The worker message protocol is pinned to vendored Tesseract.js 7.0.0:
 * https://github.com/naptha/tesseract.js/blob/v7.0.0/src/worker-script/index.js
 * Owning the worker lets Stop/Abort terminate it even while its engine loads.
 */
(function () {
  'use strict';
  const scriptURL = document.currentScript?.src || new URL('ticket-text-reader.js', document.baseURI).href;
  const assetURL = new URL('vendor/ocr/', scriptURL);
  let active = null;
  let nextSession = 0;

  const error = (name, message) => Object.assign(new Error(message), { name });
  const abortError = () => error('AbortError', 'Ticket reading stopped.');
  const supported = () => typeof Worker === 'function' && typeof WebAssembly === 'object';

  async function prepareImage(input, session) {
    let source = input;
    let bitmap = null;
    let imageURL = null;
    let canvas = null;
    try {
      if (typeof Blob !== 'undefined' && input instanceof Blob) {
        if (!input.size || input.size > 25 * 1024 * 1024) throw error('ImageError', 'Choose a ticket photo smaller than 25 MB.');
        if (typeof createImageBitmap === 'function') {
          bitmap = await createImageBitmap(input);
          source = bitmap;
        } else {
          imageURL = URL.createObjectURL(input);
          source = await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(error('ImageError', 'This photo could not be opened. Try a JPG or PNG.'));
            image.src = imageURL;
          });
        }
      }
      session.check();
      const width = Number(source?.width || source?.naturalWidth);
      const height = Number(source?.height || source?.naturalHeight);
      if (!(width > 0 && height > 0 && width <= 25000 && height <= 25000 && width * height <= 100000000)) {
        throw error('ImageError', 'Use a clear photo or camera frame of one ticket.');
      }
      const longest = Math.max(width, height);
      const scale = Math.min(2200 / longest, Math.sqrt(3300000 / (width * height)), Math.max(1, 1400 / longest));
      canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw error('ImageError', 'This browser could not prepare the ticket photo.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(error('ImageError', 'The ticket photo could not be read.')), 'image/png'));
      session.check();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      session.check();
      return { bytes, width: canvas.width, height: canvas.height };
    } finally {
      bitmap?.close();
      if (imageURL) URL.revokeObjectURL(imageURL);
      if (canvas) { canvas.width = 1; canvas.height = 1; }
    }
  }

  async function read(input, { signal, onProgress, timeoutMs = 30000 } = {}) {
    if (signal?.aborted) throw abortError();
    if (!supported()) throw error('UnsupportedError', 'This browser cannot read printed ticket details. Try a recent version of Chrome.');
    active?.cancel(abortError());
    const sessionId = ++nextSession;
    const workerId = `joe-ticket-text-${sessionId}`;
    const pending = new Map();
    let worker = null;
    let stopped = false;
    let stopReason = null;
    let job = 0;
    let cancelReject;
    const cancelled = new Promise((_, reject) => { cancelReject = reject; });
    const session = {
      check() { if (stopped) throw stopReason || abortError(); },
      cancel(reason) {
        if (stopped) return;
        stopped = true;
        stopReason = reason;
        worker?.terminate();
        worker = null;
        for (const item of pending.values()) item.reject(reason);
        pending.clear();
        cancelReject(reason);
      }
    };
    active = session;
    const report = (status, progress, message) => {
      if (stopped || typeof onProgress !== 'function') return;
      try { onProgress({ status, progress: Math.max(0, Math.min(1, Number(progress) || 0)), message }); } catch (_) { /* A display callback cannot interrupt cleanup. */ }
    };
    const abort = () => session.cancel(abortError());
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => session.cancel(error('TimeoutError', 'Reading took too long. Try again with a closer, well-lit ticket photo.')), Math.max(1000, Math.min(30000, Number(timeoutMs) || 30000)));
    const send = (action, payload) => {
      session.check();
      const jobId = `${sessionId}-${++job}`;
      return new Promise((resolve, reject) => {
        pending.set(jobId, { resolve, reject });
        worker.postMessage({ workerId, jobId, action, payload });
      });
    };

    const task = (async () => {
      report('loading', 0, 'Preparing private ticket reader…');
      const image = await prepareImage(input, session);
      session.check();
      worker = new Worker(new URL('worker.min.js', assetURL).href, { name: 'Joe’s private ticket reader' });
      worker.onerror = () => session.cancel(error('ReaderError', 'The ticket reader could not load. Check your connection and try again.'));
      worker.onmessageerror = () => session.cancel(error('ReaderError', 'The ticket reader could not read this photo. Please try again.'));
      worker.onmessage = ({ data }) => {
        if (stopped || data?.workerId !== workerId) return;
        if (data.status === 'progress') {
          if (data.action === 'recognize') report('reading', data.data?.progress, 'Reading the printed game and price…');
          else report('loading', data.data?.progress, 'Loading private ticket reader…');
          return;
        }
        const item = pending.get(data.jobId);
        if (!item) return;
        pending.delete(data.jobId);
        if (data.status === 'resolve') item.resolve(data.data);
        else item.reject(error('ReaderError', 'The ticket reader could not read this photo. Please try a clearer photo.'));
      };
      await send('load', { options: { lstmOnly: true, corePath: new URL('core/', assetURL).href, logging: false } });
      await send('loadLanguage', { langs: 'eng', options: { langPath: new URL('lang/', assetURL).href.replace(/\/$/, ''), cachePath: 'joes-ticket-ocr-v7-eng', cacheMethod: 'write', gzip: true, lstmOnly: true } });
      await send('initialize', { langs: 'eng', oem: 1, config: {} });
      await send('setParameters', { params: { tessedit_pageseg_mode: '11', preserve_interword_spaces: '1', user_defined_dpi: '300' } });
      report('reading', 0, 'Reading the printed game and price…');
      const result = await send('recognize', { image: image.bytes, options: { rotateAuto: true }, output: { text: true } });
      session.check();
      report('reading', 1, 'Ticket details read.');
      const text = typeof result?.text === 'string' ? result.text.slice(0, 24000) : '';
      return { text, confidence: Math.max(0, Math.min(100, Number(result?.confidence) || 0)), width: image.width, height: image.height };
    })();

    try { return await Promise.race([task, cancelled]); }
    finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      stopped = true;
      worker?.terminate();
      worker = null;
      for (const item of pending.values()) item.reject(stopReason || abortError());
      pending.clear();
      if (active === session) active = null;
    }
  }

  window.JoeTicketTextReader = Object.freeze({
    read,
    cancel() { active?.cancel(abortError()); },
    isSupported: supported,
    getState() { return { active: Boolean(active) }; }
  });
})();

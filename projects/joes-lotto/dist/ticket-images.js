/* Joe's Lotto private ticket photos. Photos stay in this browser's IndexedDB.
 * AES-GCM protects stored bytes; same-origin code and an unlocked device can still
 * access them. Portable JSON exports intentionally contain readable JPEG photos.
 */
(() => {
  'use strict';
  const DB_NAME = 'joes-lotto-private-ticket-images';
  const DB_VERSION = 1;
  const KEY_ID = 'ticket-image-key-v1';
  const LIMITS = Object.freeze({ inputBytes: 25 * 1024 * 1024, inputPixels: 40 * 1000 * 1000, longestEdge: 1400, imageBytes: 300 * 1024, backupBytes: 12 * 1024 * 1024, imageCount: 500, storedBytes: 64 * 1024 * 1024 });
  let databasePromise;
  let keyPromise;
  let available = null;
  let lastError = '';
  const supported = !!(window.indexedDB && window.crypto?.subtle && window.crypto?.getRandomValues && typeof Blob === 'function' && document?.createElement);

  function error(code, message) { const result = new Error(message); result.name = 'TicketImageError'; result.code = code; return result; }
  function safeError(cause) {
    if (cause?.name === 'TicketImageError') return cause;
    if (cause?.name === 'QuotaExceededError') return error('QUOTA', 'Photo storage is full. The ticket can still be saved without a photo. Export a backup or free device space.');
    return error('STORAGE', 'Private photo storage is unavailable in this browser. The ticket can still be saved without a photo.');
  }
  async function operation(action) {
    try { const result = await action(); lastError = ''; return result; }
    catch (cause) { const result = safeError(cause); lastError = result.message; throw result; }
  }
  function validId(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(id)) throw error('INVALID_ID', 'Invalid ticket photo reference.');
    return id;
  }
  function newId() { return 'photo-' + (window.crypto.randomUUID ? window.crypto.randomUUID() : [...window.crypto.getRandomValues(new Uint8Array(18))].map(v => v.toString(16).padStart(2, '0')).join('')); }
  function openDatabase() {
    if (!supported) return Promise.reject(error('UNSUPPORTED', 'This browser does not support private offline photos. The ticket can still be saved without a photo.'));
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(error('BLOCKED', 'Photo storage is busy in another tab. Close the other tab and try again.')), 8000);
      function finish(cause, db) { if (settled) { db?.close(); return; } settled = true; clearTimeout(timer); if (cause) { available = false; databasePromise = null; reject(cause); } else { available = true; resolve(db); } }
      let request;
      try { request = window.indexedDB.open(DB_NAME, DB_VERSION); } catch (cause) { finish(cause); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      request.onerror = () => finish(request.error);
      request.onblocked = () => finish(error('BLOCKED', 'Photo storage is busy in another tab. Close the other tab and try again.'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); databasePromise = null; keyPromise = null; available = null; };
        finish(null, db);
      };
    });
    return databasePromise;
  }
  function read(db, store, id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const request = tx.objectStore(store).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  function usableKey(key) { return key && key.type === 'secret' && key.extractable === false && key.algorithm?.name === 'AES-GCM' && key.algorithm?.length === 256 && key.usages?.includes('encrypt') && key.usages?.includes('decrypt'); }
  async function getKey(db, create = true) {
    if (!keyPromise) keyPromise = (async () => {
      const existing = await read(db, 'meta', KEY_ID);
      if (existing) {
        if (!usableKey(existing)) throw error('KEY', 'The private photo key cannot be read. Keep your existing backup; no stored photos were replaced.');
        return existing;
      }
      if (!create) throw error('KEY', 'The private photo key is missing. Restore photos from a private JSON backup.');
      const generated = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      // Check and create inside one transaction so two tabs never overwrite keys.
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['meta', 'images'], 'readwrite');
        const meta = tx.objectStore('meta');
        let selected;
        let failure;
        const request = meta.get(KEY_ID);
        request.onsuccess = () => {
          if (request.result) {
            if (!usableKey(request.result)) { failure = error('KEY', 'The private photo key cannot be read. No stored photos were replaced.'); tx.abort(); return; }
            selected = request.result;
          } else {
            const count = tx.objectStore('images').count();
            count.onsuccess = () => {
              if (count.result) { failure = error('KEY', 'The private photo key is missing. Existing encrypted photos were kept unchanged. Restore a private JSON backup.'); tx.abort(); return; }
              selected = generated;
              meta.put(generated, KEY_ID);
            };
          }
        };
        tx.oncomplete = () => resolve(selected);
        tx.onabort = () => reject(failure || tx.error);
        tx.onerror = () => {};
      });
    })().catch(cause => { keyPromise = null; throw cause; });
    return keyPromise;
  }
  function dimensions(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16000 || height > 16000 || width * height > LIMITS.inputPixels) throw error('DIMENSIONS', 'This photo is too large to process safely. Use a smaller photo or the camera.');
  }
  function canvasBlob(canvas, quality) { return new Promise((resolve, reject) => { try { canvas.toBlob(blob => blob?.size ? resolve(blob) : reject(error('IMAGE', 'The ticket photo could not be prepared. Try another photo.')), 'image/jpeg', quality); } catch { reject(error('IMAGE', 'The ticket photo could not be prepared. Try another photo.')); } }); }
  async function loadImage(blob) {
    if (!(blob instanceof Blob) || blob.size < 1 || blob.size > LIMITS.inputBytes) throw error('INPUT', 'Choose a ticket photo smaller than 25 MB.');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif'].includes(blob.type.toLowerCase())) throw error('TYPE', 'Choose a supported ticket image, such as JPEG, PNG, or WebP.');
    if (typeof window.createImageBitmap === 'function') {
      try { const bitmap = await window.createImageBitmap(blob, { imageOrientation: 'from-image' }); return { image: bitmap, release: () => bitmap.close() }; }
      catch { /* Some Android browsers decode image formats through Image only. */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      let finished = false;
      const timer = setTimeout(() => finish(error('IMAGE', 'The ticket photo took too long to open. Try a smaller JPEG photo.')), 15000);
      function finish(cause) { if (finished) return; finished = true; clearTimeout(timer); URL.revokeObjectURL(url); img.onload = null; img.onerror = null; if (cause) reject(cause); else resolve({ image: img, release() {} }); }
      img.onload = () => finish();
      img.onerror = () => finish(error('IMAGE', 'This ticket photo could not be opened. Try a JPEG photo.'));
      img.src = url;
    });
  }
  async function prepare(input) {
    let loaded;
    const isCanvas = input && typeof input.getContext === 'function' && typeof input.toBlob === 'function';
    try {
      loaded = isCanvas ? { image: input, release() {} } : await loadImage(input);
      const width = loaded.image.naturalWidth || loaded.image.width;
      const height = loaded.image.naturalHeight || loaded.image.height;
      dimensions(width, height);
      let ratio = Math.min(1, LIMITS.longestEdge / Math.max(width, height));
      const canvas = document.createElement('canvas');
      for (let attempt = 0; attempt < 6; attempt++) {
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw error('IMAGE', 'The ticket photo could not be prepared on this device.');
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(loaded.image, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.82, 0.66, 0.48, 0.32]) {
          const blob = await canvasBlob(canvas, quality);
          if (blob.type !== 'image/jpeg') throw error('IMAGE', 'This browser cannot prepare private JPEG photos.');
          if (blob.size <= LIMITS.imageBytes) return { blob, width: canvas.width, height: canvas.height };
        }
        ratio *= 0.75;
      }
      throw error('SIZE', 'This photo could not be made small enough. Try a closer, clearer ticket photo.');
    } finally { loaded?.release(); }
  }
  function aad(id) { return new TextEncoder().encode('joes-lotto-ticket-image-v1:' + id); }
  async function encryptedRecord(prepared, id, key) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(id), tagLength: 128 }, key, await prepared.blob.arrayBuffer());
    return { id, version: 1, iv, ciphertext, bytes: prepared.blob.size, width: prepared.width, height: prepared.height, mime: 'image/jpeg' };
  }
  function metadata(record) { return { imageId: record.id, bytes: record.bytes, width: record.width, height: record.height }; }
  function putRecords(db, records) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      let failure;
      const existing = store.getAll();
      existing.onsuccess = () => {
        const sizes = new Map(existing.result.map(record => [record.id, record.bytes || 0]));
        for (const record of records) sizes.set(record.id, record.bytes);
        if (sizes.size > LIMITS.imageCount || [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0) > LIMITS.storedBytes) {
          failure = error('QUOTA', 'Private photo storage has reached its limit. Keep or export existing photos before adding more.'); tx.abort(); return;
        }
        for (const record of records) store.put(record);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(failure || tx.error);
      tx.onerror = () => {};
    });
  }
  async function save(input, options = {}) {
    return operation(async () => {
      const id = options.id === undefined ? newId() : validId(options.id);
      const prepared = await prepare(input);
      const db = await openDatabase();
      const record = await encryptedRecord(prepared, id, await getKey(db));
      await putRecords(db, [record]);
      return metadata(record);
    });
  }
  async function get(imageId) {
    return operation(async () => {
      const id = validId(imageId);
      const db = await openDatabase();
      const record = await read(db, 'images', id);
      if (!record) return null;
      if (record.version !== 1 || record.mime !== 'image/jpeg' || !Number.isSafeInteger(record.bytes) || record.bytes < 1 || record.bytes > LIMITS.imageBytes || record.iv?.byteLength !== 12 || record.ciphertext?.byteLength !== record.bytes + 16) throw error('CORRUPT', 'This saved photo is damaged. The ticket record is still available.');
      let plaintext;
      try { plaintext = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv, additionalData: aad(id), tagLength: 128 }, await getKey(db, false), record.ciphertext); }
      catch (cause) { if (cause?.name === 'TicketImageError') throw cause; throw error('CORRUPT', 'This saved photo cannot be opened. Restore its photo from a private JSON backup.'); }
      return new Blob([plaintext], { type: 'image/jpeg' });
    });
  }
  async function remove(imageId) {
    return operation(async () => {
      const id = validId(imageId); const db = await openDatabase();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readwrite'); tx.objectStore('images').delete(id);
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => {};
      });
      return true;
    });
  }
  function blobDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(error('EXPORT', 'A ticket photo could not be included in the backup. Try exporting again.'));
      reader.readAsDataURL(blob);
    });
  }
  async function exportAll(imageIds = []) {
    return operation(async () => {
      if (!Array.isArray(imageIds) || imageIds.length > LIMITS.imageCount) throw error('BACKUP', 'Too many photo references in this backup.');
      const ids = [...new Set(imageIds.map(validId))];
      const output = []; let bytes = 2;
      for (const id of ids) {
        const blob = await get(id);
        if (!blob) throw error('MISSING', 'A saved ticket photo is missing. Keep your previous backup; export records without photos if needed.');
        const row = { id, dataUrl: await blobDataURL(blob) };
        bytes += JSON.stringify(row).length + 1;
        if (bytes > LIMITS.backupBytes) throw error('BACKUP_SIZE', 'Photos exceed the 12 MB portable backup limit. Export records without photos or fewer photos.');
        output.push(row);
      }
      return output;
    });
  }
  function backupBlob(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw error('BACKUP', 'Invalid ticket photo in backup.');
    const id = validId(row.id);
    if (typeof row.dataUrl !== 'string' || row.dataUrl.length > Math.ceil(LIMITS.imageBytes * 4 / 3) + 100 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(row.dataUrl)) throw error('BACKUP', 'Invalid or oversized ticket photo in backup.');
    const [header, encoded] = row.dataUrl.split(',');
    let decoded;
    try { decoded = atob(encoded); if (btoa(decoded) !== encoded) throw new Error(); } catch { throw error('BACKUP', 'Invalid ticket photo encoding in backup.'); }
    const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
    if (bytes.length < 1 || bytes.length > LIMITS.imageBytes) throw error('BACKUP', 'Invalid or oversized ticket photo in backup.');
    return { id, blob: new Blob([bytes], { type: header.slice(5, -7) }) };
  }
  async function importAll(rows = []) {
    return operation(async () => {
      if (!Array.isArray(rows) || rows.length > LIMITS.imageCount) throw error('BACKUP', 'Invalid photo list in backup.');
      const validated = []; const ids = new Set(); let bytes = 2;
      for (const row of rows) {
        const decoded = backupBlob(row);
        if (ids.has(decoded.id)) throw error('BACKUP', 'Duplicate ticket photo reference in backup.');
        ids.add(decoded.id); bytes += JSON.stringify({ id: row.id, dataUrl: row.dataUrl }).length + 1;
        if (bytes > LIMITS.backupBytes) throw error('BACKUP_SIZE', 'Photos exceed the 12 MB portable backup limit.');
        validated.push(decoded);
      }
      if (!validated.length) return { imported: 0, images: [] };
      // Decode/re-encode every image before opening a write transaction. A bad
      // backup cannot partially replace photos. Existing unrelated photos stay.
      const prepared = [];
      for (const row of validated) prepared.push({ id: row.id, ...(await prepare(row.blob)) });
      const db = await openDatabase(); const key = await getKey(db); const records = [];
      for (const row of prepared) records.push(await encryptedRecord(row, row.id, key));
      await putRecords(db, records);
      return { imported: records.length, images: records.map(metadata) };
    });
  }
  window.JoeTicketImages = Object.freeze({ save, get, remove, exportAll, importAll, limits: LIMITS, getStatus: () => ({ supported, available, encrypted: true, storage: 'this-browser', lastError }) });
})();

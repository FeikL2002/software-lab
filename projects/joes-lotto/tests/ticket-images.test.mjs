import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../dist/ticket-images.js', import.meta.url), 'utf8');
const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 4, 74, 70, 255, 217]);

// Transactions stage writes until completion, exercising the module's async
// IndexedDB lifetime and abort semantics without touching a user's browser.
function fakeIndexedDB() {
  const stores = new Map(); let opens = 0; let failNextWrite = false;
  const db = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name) { stores.set(name, new Map()); },
    close() {},
    transaction(names, mode) {
      names = Array.isArray(names) ? names : [names];
      const staged = new Map(names.map(name => [name, new Map(stores.get(name))]));
      const tx = { error: null, pending: 0, aborted: false, timer: null,
        abort() { if (tx.aborted) return; tx.aborted = true; clearTimeout(tx.timer); setTimeout(() => tx.onabort?.(), 0); },
        objectStore(name) {
          return {
            get(id) { return request(() => staged.get(name).get(id)); },
            getAll() { return request(() => [...staged.get(name).values()]); },
            count() { return request(() => staged.get(name).size); },
            put(value, id) { return request(() => { if (failNextWrite && name === 'images') { failNextWrite = false; const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } staged.get(name).set(id ?? value.id, structuredClone(value)); }); },
            delete(id) { return request(() => staged.get(name).delete(id)); },
          };
        },
      };
      function completeLater() { clearTimeout(tx.timer); tx.timer = setTimeout(() => { if (!tx.aborted && !tx.pending) { if (mode === 'readwrite') for (const [name, map] of staged) stores.set(name, map); tx.oncomplete?.(); } }, 0); }
      function request(fn) {
        const req = { result: undefined, error: null }; tx.pending++; clearTimeout(tx.timer);
        setTimeout(() => { if (tx.aborted) return; try { req.result = fn(); req.onsuccess?.(); } catch (cause) { req.error = tx.error = cause; req.onerror?.(); tx.abort(); } finally { tx.pending--; completeLater(); } }, 0);
        return req;
      }
      completeLater(); return tx;
    },
  };
  return {
    open() { opens++; const req = {}; setTimeout(() => { req.result = db; if (!stores.size) req.onupgradeneeded?.(); req.onsuccess?.(); }, 0); return req; },
    stores, get opens() { return opens; }, failWrite() { failNextWrite = true; },
  };
}

function browser({ unsupported = false, idb = fakeIndexedDB(), oversized = false } = {}) {
  let encodes = 0;
  const makeCanvas = () => ({ width: 0, height: 0,
    getContext: () => ({ fillRect() {}, drawImage() {} }),
    toBlob(callback, type, quality) { encodes++; callback(new Blob([oversized && quality > .4 ? new Uint8Array(350 * 1024) : jpeg], { type })); },
  });
  class Reader {
    async readAsDataURL(blob) { this.result = `data:${blob.type};base64,` + Buffer.from(await blob.arrayBuffer()).toString('base64'); this.onload?.(); }
  }
  const window = {
    indexedDB: unsupported ? null : idb, crypto: webcrypto,
    async createImageBitmap(blob) { if ((await blob.arrayBuffer()).byteLength < 3) throw new Error('bad'); return { width: 3000, height: 2000, close() {} }; },
  };
  const context = vm.createContext({ window, document: { createElement: makeCanvas }, Blob, URL, Uint8Array, TextEncoder, setTimeout, clearTimeout, FileReader: Reader,
    atob: value => Buffer.from(value, 'base64').toString('binary'), btoa: value => Buffer.from(value, 'binary').toString('base64'), Image: class { set src(value) { setTimeout(() => this.onerror?.(), 0); } },
  });
  vm.runInContext(source, context);
  return { api: window.JoeTicketImages, idb, get encodes() { return encodes; }, canvas: { width: 3000, height: 2000, getContext() {}, toBlob() {} } };
}

async function rejectsCode(promise, code) { await assert.rejects(promise, cause => cause.code === code && cause.name === 'TicketImageError'); }

test('photos are resized, metadata stripped, AES-GCM encrypted, and durable across module reloads', async () => {
  const b = browser({ oversized: true });
  const saved = await b.api.save(b.canvas, { id: 'ticket-photo-1' });
  assert.equal(saved.imageId, 'ticket-photo-1');
  assert.equal(saved.width, 1400); assert.equal(saved.height, 933);
  assert.ok(saved.bytes <= 300 * 1024); assert.equal(b.encodes, 4);
  const key = b.idb.stores.get('meta').get('ticket-image-key-v1');
  assert.equal(key.extractable, false); assert.equal(key.algorithm.name, 'AES-GCM');
  await assert.rejects(webcrypto.subtle.exportKey('raw', key));
  const stored = b.idb.stores.get('images').get(saved.imageId);
  assert.equal(stored.ciphertext.byteLength, jpeg.length + 16); assert.equal(stored.iv.byteLength, 12);
  assert.equal(stored.blob, undefined); assert.equal(stored.dataUrl, undefined);
  assert.notDeepEqual([...new Uint8Array(stored.ciphertext).slice(0, jpeg.length)], [...jpeg]);
  const reopened = browser({ idb: b.idb });
  assert.deepEqual([...new Uint8Array(await (await reopened.api.get(saved.imageId)).arrayBuffer())], [...jpeg]);
  assert.equal(await reopened.api.get('missing'), null);
});

test('portable backups restore all photos atomically and preserve unrelated encrypted photos', async () => {
  const from = browser(); await from.api.save(from.canvas, { id: 'source' });
  const exported = await from.api.exportAll(['source', 'source']);
  assert.equal(exported.length, 1); assert.match(exported[0].dataUrl, /^data:image\/jpeg;base64,/);
  const to = browser(); await to.api.save(to.canvas, { id: 'existing' });
  const keyBefore = to.idb.stores.get('meta').get('ticket-image-key-v1');
  const result = await to.api.importAll(exported);
  assert.equal(result.imported, 1); assert.equal(result.images[0].imageId, 'source');
  assert.ok(await to.api.get('existing')); assert.ok(await to.api.get('source'));
  assert.equal(to.idb.stores.get('meta').get('ticket-image-key-v1'), keyBefore);
  assert.equal(to.idb.stores.get('images').size, 2);
  assert.equal(await to.api.remove('source'), true); assert.equal(await to.api.get('source'), null);
  assert.ok(await to.api.get('existing'));
});

test('invalid and oversized backup inputs never change stored images', async () => {
  const b = browser(); await b.api.save(b.canvas, { id: 'keep' });
  const existing = b.idb.stores.get('images').get('keep');
  const good = { id: 'new', dataUrl: 'data:image/jpeg;base64,' + Buffer.from(jpeg).toString('base64') };
  await rejectsCode(b.api.importAll([good, { id: 'bad', dataUrl: 'https://example.test/photo.jpg' }]), 'BACKUP');
  await rejectsCode(b.api.importAll([good, good]), 'BACKUP');
  await rejectsCode(b.api.importAll([{ id: '../unsafe', dataUrl: good.dataUrl }]), 'INVALID_ID');
  await rejectsCode(b.api.importAll([{ id: 'bad', dataUrl: 'data:image/jpeg;base64,AA==' }]), 'IMAGE');
  await rejectsCode(b.api.importAll(new Array(501).fill(good)), 'BACKUP');
  assert.equal(b.idb.stores.get('images').size, 1); assert.equal(b.idb.stores.get('images').get('keep'), existing);
  await rejectsCode(b.api.exportAll(['missing']), 'MISSING');
});

test('tampering, missing keys, and exhausted quota produce safe errors without deleting photos', async () => {
  const b = browser(); await b.api.save(b.canvas, { id: 'keep' });
  const row = b.idb.stores.get('images').get('keep'); new Uint8Array(row.ciphertext)[0] ^= 1;
  await rejectsCode(b.api.get('keep'), 'CORRUPT');
  assert.equal(b.idb.stores.get('images').size, 1);
  b.idb.stores.get('meta').clear();
  const reopened = browser({ idb: b.idb });
  await rejectsCode(reopened.api.get('keep'), 'KEY');
  await rejectsCode(reopened.api.save(reopened.canvas, { id: 'cannot-replace-key' }), 'KEY');
  assert.equal(b.idb.stores.get('meta').size, 0); assert.equal(b.idb.stores.get('images').size, 1);
  const quota = browser(); await quota.api.save(quota.canvas, { id: 'preserved' }); quota.idb.failWrite();
  await rejectsCode(quota.api.save(quota.canvas, { id: 'failed' }), 'QUOTA');
  assert.equal(quota.idb.stores.get('images').size, 1); assert.ok(await quota.api.get('preserved'));
});

test('unsupported devices, huge images, and unsafe references fail without network or data loss', async () => {
  const b = browser({ unsupported: true }); assert.equal(b.api.getStatus().supported, false);
  await rejectsCode(b.api.get('photo'), 'UNSUPPORTED');
  const working = browser();
  await rejectsCode(working.api.save({ ...working.canvas, width: 10000, height: 10000 }), 'DIMENSIONS');
  await rejectsCode(working.api.save(new Blob([jpeg], { type: 'text/html' })), 'TYPE');
  await rejectsCode(working.api.save(new Blob([new Uint8Array(26 * 1024 * 1024)], { type: 'image/jpeg' })), 'INPUT');
  await rejectsCode(working.api.remove('<script>'), 'INVALID_ID');
  assert.equal(working.idb.opens, 0);
  assert.equal(working.api.getStatus().storage, 'this-browser');
  assert.equal(working.api.limits.imageBytes, 300 * 1024);
  assert.equal(/\b(?:fetch|XMLHttpRequest|localStorage)\s*[.(]/.test(source), false);
});

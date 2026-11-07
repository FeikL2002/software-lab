import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../dist/ticket-text-reader.js', import.meta.url), 'utf8');

function browser() {
  const workers = [];
  class FakeWorker {
    constructor(url) { this.url = url; this.messages = []; this.terminated = false; this.hold = FakeWorker.hold; workers.push(this); }
    postMessage(packet) {
      this.messages.push(packet);
      if (this.hold) return;
      queueMicrotask(() => {
        if (this.terminated) return;
        this.onmessage?.({ data: { ...packet, status: 'progress', data: { progress: 0.5 } } });
        this.onmessage?.({ data: { ...packet, status: 'resolve', data: packet.action === 'recognize' ? { text: 'HOLIDAY CASH\nGAME #1106\n$1', confidence: 94 } : {} } });
      });
    }
    terminate() { this.terminated = true; }
  }
  const canvas = () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob: callback => callback(new Blob(['test-image'])) });
  const context = vm.createContext({
    window: {}, document: { currentScript: { src: 'https://example.test/ticket-text-reader.js' }, createElement: canvas },
    Worker: FakeWorker, WebAssembly: {}, Blob, URL, Uint8Array, setTimeout, clearTimeout, AbortController,
  });
  vm.runInContext(source, context);
  return { reader: context.window.JoeTicketTextReader, workers, Worker: FakeWorker, input: { width: 1000, height: 600 } };
}

test('local OCR returns text, releases its worker, and loads only same-origin LSTM assets', async () => {
  const b = browser();
  const progress = [];
  const result = await b.reader.read(b.input, { onProgress: value => progress.push(value) });
  assert.equal(result.text, 'HOLIDAY CASH\nGAME #1106\n$1');
  assert.equal(result.confidence, 94);
  assert.equal(result.width, 1400);
  assert.equal(b.workers.length, 1);
  assert.equal(b.workers[0].terminated, true);
  assert.equal(b.reader.getState().active, false);
  assert.equal(b.workers[0].url, 'https://example.test/vendor/ocr/worker.min.js');
  const messages = b.workers[0].messages;
  assert.equal(messages[0].payload.options.corePath, 'https://example.test/vendor/ocr/core/');
  assert.equal(messages[0].payload.options.lstmOnly, true);
  assert.equal(messages[1].payload.options.langPath, 'https://example.test/vendor/ocr/lang');
  assert.equal(messages[1].payload.options.cachePath, 'joes-ticket-ocr-v7-eng');
  assert.ok(progress.some(value => value.status === 'reading' && value.progress === 1));
});

test('stopping while the engine loads immediately terminates it and allows a later read', async () => {
  const b = browser();
  b.Worker.hold = true;
  const signal = new AbortController();
  const reading = b.reader.read(b.input, { signal: signal.signal });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(b.workers.length, 1);
  signal.abort();
  await assert.rejects(reading, { name: 'AbortError' });
  assert.equal(b.workers[0].terminated, true);
  assert.equal(b.reader.getState().active, false);
  b.Worker.hold = false;
  assert.equal((await b.reader.read(b.input)).confidence, 94);
  assert.ok(b.workers.every(worker => worker.terminated));
});

test('a newer read cancels an older read without mixing their results', async () => {
  const b = browser();
  b.Worker.hold = true;
  const previous = b.reader.read(b.input);
  const rejection = assert.rejects(previous, { name: 'AbortError' });
  await new Promise(resolve => setTimeout(resolve, 0));
  b.Worker.hold = false;
  const current = b.reader.read(b.input, { onProgress() { throw new Error('display callback failed'); } });
  await rejection;
  assert.equal((await current).confidence, 94);
  assert.ok(b.workers.every(worker => worker.terminated));
  assert.equal(b.reader.getState().active, false);
});

test('a stalled reader times out, releases resources, and an already-aborted read starts no worker', async () => {
  const b = browser();
  b.Worker.hold = true;
  await assert.rejects(b.reader.read(b.input, { timeoutMs: 1000 }), { name: 'TimeoutError' });
  assert.equal(b.workers[0].terminated, true);
  assert.equal(b.reader.getState().active, false);
  const signal = new AbortController();
  signal.abort();
  await assert.rejects(b.reader.read(b.input, { signal: signal.signal }), { name: 'AbortError' });
  assert.equal(b.workers.length, 1);
});

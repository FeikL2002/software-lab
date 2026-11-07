import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalChat, readChat, validChatMessage } from '../src/services/chat.js';

test('local chat validates persisted records and never renders malformed dates', () => {
  globalThis.localStorage = { getItem: () => JSON.stringify([{ id:'ok', username:'viewer', text:'hello', at:Date.now() }, {id:'bad', username:'viewer', text:'bad date', at:'broken'}]) };
  assert.equal(readChat().length, 1);
  assert.equal(validChatMessage({ id:'invalid', username:'viewer', text:'x', at:Infinity }), false);
});

test('local chat persists real sends and blocks immediate duplicate/rapid spam', () => {
  const records = new Map();
  globalThis.localStorage = { getItem: key => records.get(key)||null, setItem: (key,value) => records.set(key,value) };
  globalThis.window = { addEventListener(){}, removeEventListener(){} };
  const received=[]; const chat=createLocalChat(message=>received.push(message));
  chat.send('viewer','first message');
  assert.throws(()=>chat.send('viewer','first message'),/breathing room/);
  chat.send('viewer','second message'); chat.send('viewer','third message');
  assert.throws(()=>chat.send('viewer','fourth message'),/breathing room/);
  assert.equal(readChat().length,3); assert.equal(received.length,3);
  assert.equal(readChat().every(message=>message.sample===false),true);
  chat.close();
});

test('local chat enforces username and message bounds before saving', () => {
  globalThis.localStorage = { getItem:()=>null, setItem:()=>assert.fail('must not persist invalid input') };
  globalThis.window = { addEventListener(){}, removeEventListener(){} };
  const chat=createLocalChat(()=>{});
  assert.throws(()=>chat.send('x','hello'),/2–24/);
  assert.throws(()=>chat.send('viewer','x'.repeat(241)),/240/);
  assert.throws(()=>chat.send('viewer','   '),/240/);
  chat.close();
});

// Replace this adapter with a moderated, authenticated realtime service for shared chat.
// These messages stay in this browser/origin and never claim to be a global chat.
const STORAGE = 'signal-local-chat-v1';
export const MAX_MESSAGE_LENGTH = 240;
export const sampleMessages = [
  { id:'sample-1', username:'signal', role:'creator', text:'Welcome to the little corner of the internet we call home. 👋', sample:true, at:Date.now()-240000 },
  { id:'sample-2', username:'mila.design', role:'viewer', text:'Good company, good ideas. My kind of place.', sample:true, at:Date.now()-180000 },
  { id:'sample-3', username:'jules', role:'viewer', text:'The offline vibes are already immaculate ✨', sample:true, at:Date.now()-120000 },
];
export function validChatMessage(m) { return m && typeof m.id==='string' && typeof m.text==='string' && m.text.length<=MAX_MESSAGE_LENGTH && typeof m.username==='string' && m.username.length<=24 && Number.isFinite(m.at) && !Number.isNaN(new Date(m.at).getTime()); }
export function readChat() { try { const messages=JSON.parse(localStorage.getItem(STORAGE)||'[]'); return Array.isArray(messages) ? messages.filter(validChatMessage).slice(-80) : []; } catch { return []; } }
export function createLocalChat(onMessage) {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('signal-chat') : null;
  const receive = event => { if (event.data?.type === 'message' && validChatMessage(event.data.message)) onMessage(event.data.message); };
  if (channel) channel.onmessage = receive;
  const storage = event => { if (!channel && event.key === STORAGE) onMessage(null); };
  window.addEventListener('storage', storage);
  let sent = [];
  let lastText = '';
  return {
    send(username, text) {
      const clean=text.trim(), now=Date.now(); sent=sent.filter(at=>now-at<10000);
      if (!clean || clean.length>MAX_MESSAGE_LENGTH) throw new Error('Keep your message between 1 and 240 characters.');
      if (sent.length>=3 || (lastText===clean && sent.some(at=>now-at<5000))) throw new Error('A little breathing room. Try again in a few seconds.');
      if (!/^[\p{L}\p{N}_. -]{2,24}$/u.test(username)) throw new Error('Use a name with 2–24 letters, numbers, spaces, or . _ -');
      const message={ id:crypto.randomUUID(), username, text:clean, at:now, role:'viewer', sample:false };
      localStorage.setItem(STORAGE, JSON.stringify([...readChat(),message].slice(-80)));
      sent.push(now); lastText=clean; channel?.postMessage({ type:'message',message }); onMessage(message);
    },
    close() { channel?.close(); window.removeEventListener('storage',storage); }
  };
}

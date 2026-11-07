import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, MessageCircle, PanelRightClose, Smile, Sparkles } from 'lucide-react';
import { createLocalChat, readChat, sampleMessages, MAX_MESSAGE_LENGTH } from '../services/chat';
export default function Chat({ onClose }) {
  const [messages,setMessages]=useState(()=>[...sampleMessages,...readChat()]);
  const [text,setText]=useState(''); const [name,setName]=useState(()=>localStorage.getItem('signal-chat-name')||'guest');
  const [error,setError]=useState(''); const [emojis,setEmojis]=useState(false); const [atBottom,setAtBottom]=useState(true);
  const adapter=useRef(null), list=useRef(null), input=useRef(null), nearBottom=useRef(true);
  const scrollBottom=()=>{ if(list.current)list.current.scrollTo({top:list.current.scrollHeight,behavior:'smooth'});setAtBottom(true);nearBottom.current=true; };
  useEffect(()=>{ adapter.current=createLocalChat(message=>setMessages(previous=>message ? previous.some(m=>m.id===message.id)?previous:[...previous,message].slice(-100) : [...sampleMessages,...readChat()]));return()=>adapter.current?.close(); },[]);
  useEffect(()=>{ if(nearBottom.current) scrollBottom(); },[messages.length]);
  const send=event=>{ event.preventDefault(); try { adapter.current.send(name.trim(),text); localStorage.setItem('signal-chat-name',name.trim());setText('');setError('');setEmojis(false);nearBottom.current=true; } catch(e) { setError(e.message); } };
  return <aside className="chat-panel" aria-label="Stream chat">
    <div className="chat-heading"><div><MessageCircle size={17}/><strong>Stream chat</strong></div><button className="icon-button" onClick={onClose} aria-label="Collapse chat"><PanelRightClose size={18}/></button></div>
    <div className="chat-local"><span className="tiny-dot"/> LOCAL DEMO <span>Same browser · no public messages</span></div>
    <div className="chat-scroll" ref={list} onScroll={()=>{const el=list.current;nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<70;setAtBottom(nearBottom.current);}} role="log" aria-live="polite" aria-relevant="additions">
      <div className="chat-welcome"><div className="welcome-mark"><Sparkles size={21}/></div><h3>Good to have you here.</h3><p>Make yourself at home.<br/>Be kind. Stay curious.</p><span>THIS IS THE BEGINNING OF CHAT</span></div>
      {messages.map(m=><div className={`chat-message ${m.role==='creator'?'creator-message':''}`} key={m.id}><div><time dateTime={new Date(m.at).toISOString()}>{new Date(m.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time><strong className={m.role==='creator'?'creator-name':''}>{m.username}</strong>{m.sample&&<small>sample</small>}</div><p>{m.text}</p></div>)}
    </div>
    {!atBottom&&<button className="jump-chat" onClick={scrollBottom}><ArrowDown size={14}/> Latest messages</button>}
    <form className="chat-compose" onSubmit={send}>
      <label className="chat-name">CHATTING AS <input aria-label="Chat username" value={name} maxLength={24} onChange={e=>setName(e.target.value)}/><ChevronDown size={13}/></label>
      <div className="message-box"><label className="sr-only" htmlFor="chat-message">Your message</label><textarea id="chat-message" ref={input} value={text} maxLength={MAX_MESSAGE_LENGTH} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(e);}}} placeholder="Say something nice…" rows={2}/><div><button type="button" className="icon-button" onClick={()=>setEmojis(!emojis)} aria-label="Choose emoji" aria-expanded={emojis}><Smile size={18}/></button><span>{text.length}/{MAX_MESSAGE_LENGTH}</span></div></div>
      {emojis&&<div className="emoji-picker">{['👋','💚','🔥','✨','🙌','😂','🎨','☕'].map(emoji=><button key={emoji} type="button" aria-label={`Add ${emoji}`} onClick={()=>{setText(t=>(t+emoji).slice(0,MAX_MESSAGE_LENGTH));input.current?.focus();}}>{emoji}</button>)}</div>}
      {error&&<p className="chat-error" role="alert">{error}</p>}
      <div className="chat-compose-bottom"><span><span className="tiny-dot"/> Local chat ready</span><button type="submit" className="send-button" disabled={!text.trim()} aria-label="Send message"><ArrowUp size={16}/> Send</button></div>
    </form>
  </aside>;
}

import React, { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, Pause, PictureInPicture2, Play, Radio, RefreshCw, Volume2, VolumeX } from 'lucide-react';
export default function Player({ stream, loading, theater, setTheater, onRemind }) {
  const video=useRef(null), container=useRef(null); const [playing,setPlaying]=useState(false),[muted,setMuted]=useState(true),[volume,setVolume]=useState(.8),[buffering,setBuffering]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const available=stream.status==='live'&&!!stream.playbackUrl;
  useEffect(()=>{
    const el=video.current; if(!el||!available)return;
    let hls,cancelled=false;setError('');setBuffering(true);
    const connect=async()=>{
    if(el.canPlayType('application/vnd.apple.mpegurl'))el.src=stream.playbackUrl;
    else {
      const {default:Hls}=await import('hls.js');
      if(cancelled)return;
      if(Hls.isSupported()){
      hls=new Hls({ lowLatencyMode:true, maxBufferLength:30 });hls.loadSource(stream.playbackUrl);hls.attachMedia(el);
      let mediaRecovery=0;
      hls.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal){setBuffering(false);if(data.type===Hls.ErrorTypes.MEDIA_ERROR&&mediaRecovery++<1)hls.recoverMediaError();else{setError(data.type===Hls.ErrorTypes.NETWORK_ERROR?'The stream could not be reached. It may have ended, or the playback link may have expired.':'Playback was interrupted. Try reconnecting.');hls.destroy();}}});
      }else{setError('This browser does not support HLS video. Try a current version of Safari, Chrome, Firefox, or Edge.');setBuffering(false);return;}
    }
    el.play().catch(()=>{setBuffering(false);setPlaying(false);});
    };
    connect().catch(()=>{if(!cancelled){setError('The video player could not connect. Check your connection and try again.');setBuffering(false);}});
    return()=>{cancelled=true;hls?.destroy();el.pause();el.removeAttribute('src');el.load();};
  },[available,stream.playbackUrl,retry]);
  const fullscreen=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(container.current?.requestFullscreen)await container.current.requestFullscreen();else if(video.current?.webkitEnterFullscreen&&available)video.current.webkitEnterFullscreen();else setError('Fullscreen is unavailable in this browser.');}catch{setError('Fullscreen could not be opened.');}};
  const pip=async()=>{try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else if(video.current?.requestPictureInPicture)await video.current.requestPictureInPicture();else setError('Picture-in-picture is unavailable in this browser.');}catch{setError('Start playback before opening picture-in-picture.');}};
  const status=stream.status==='preparing'?'GETTING READY':stream.status==='live'?'LIVE':stream.status==='ended'?'STREAM ENDED':'CURRENTLY OFFLINE';
  return <section className={`player ${available?'has-video':''}`} ref={container} aria-label="Livestream player">
    {available?<video ref={video} autoPlay playsInline muted={muted} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onWaiting={()=>setBuffering(true)} onPlaying={()=>setBuffering(false)} onCanPlay={()=>setBuffering(false)} onError={()=>{setBuffering(false);setError('The video could not be loaded. Check your connection and try again.');}} aria-label={stream.title}/>:<div className="offline-art"><img src="/images/offline-scene.svg" alt="An abstract green planet suspended over a glowing horizon"/><div className="player-kicker"><span className="signal-glyph">ııı</span> STAY ON THE SAME WAVELENGTH</div><div className="offline-copy"><span className="offline-label"><span className="tiny-dot"/>{stream.status==='preparing'?'THE ROOM IS WARMING UP':'A LITTLE INTERMISSION'}</span><h1>OFF THE CLOCK.<br/><em>STILL IN ORBIT.</em></h1><p>{stream.status==='preparing'?'The broadcast is getting ready. Settle in.':'Good things are worth tuning in for.'}</p><button className="hero-remind" onClick={onRemind}><Radio size={15}/> Get a heads-up <span>↗</span></button></div><span className="art-coordinate">SIGNAL / FREQUENCY 001</span></div>}
    <div className="player-top"><span className={`status-pill ${stream.status==='live'?'is-live':''}`}><span/>{status}</span><span className="player-resolution">{available?'HLS · AUTO':'BACK SOON'}</span></div>
    {loading&&<div className="player-loader" aria-label="Checking broadcast status"><span className="spinner"/></div>}
    {available&&buffering&&!error&&<div className="player-buffering" role="status"><span className="spinner"/>Connecting to the stream…</div>}
    {error&&<div className="player-error" role="alert"><p>{error}</p><button onClick={()=>{setError('');setRetry(r=>r+1);}}><RefreshCw size={15}/> Reconnect</button></div>}
    <div className="player-controls"><div><button onClick={()=>{if(available){if(playing)video.current.pause();else video.current.play().catch(()=>setError('Tap play to begin playback.'));}}} disabled={!available} className="icon-button" aria-label={playing?'Pause stream':'Play stream'}>{playing?<Pause size={18} fill="currentColor"/>:<Play size={18} fill="currentColor"/>}</button><button className="icon-button" onClick={()=>setMuted(m=>{if(video.current)video.current.muted=!m;return !m;})} aria-label={muted?'Unmute stream':'Mute stream'}>{muted?<VolumeX size={19}/>:<Volume2 size={19}/>}</button><input className="volume-slider" type="range" min="0" max="1" step="0.05" value={volume} aria-label="Volume" onChange={e=>{const value=Number(e.target.value);setVolume(value);if(video.current){video.current.volume=value;video.current.muted=value===0;}setMuted(value===0);}}/><span className="control-status"><span className={available?'live-dot':''}/>{available?'LIVE':status}</span></div><div><button className="icon-button pip-button" onClick={pip} disabled={!available} aria-label="Picture in picture"><PictureInPicture2 size={18}/></button><button className="icon-button" onClick={()=>setTheater(!theater)} aria-label={theater?'Exit theater mode':'Enter theater mode'}>{theater?<Minimize size={18}/>:<span className="theater-icon"/>}</button><button className="icon-button" onClick={fullscreen} aria-label="Toggle fullscreen"><Maximize size={18}/></button></div></div>
  </section>;
}

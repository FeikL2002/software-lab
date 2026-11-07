import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ChevronDown, Mic, MicOff, Play, ShieldCheck, Square, Volume2 } from 'lucide-react';

const deviceError = (error) => {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') return 'Camera or microphone access was blocked. Allow access in your browser’s site settings, then try again.';
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return 'No camera or microphone was found. Connect a device, then try again.';
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') return 'Your camera or microphone is busy. Close other apps using it, then try again.';
  if (error?.name === 'OverconstrainedError') return 'The selected device is no longer available. Choose another device and try again.';
  if (error?.name === 'SecurityError') return 'Device access requires a secure connection. Open this site over HTTPS or localhost.';
  return 'The preview could not start. Check that your devices are connected and allowed in your browser.';
};

export default function CameraPreview({ compact = false, onStateChange }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const audioRef = useRef(null);
  const animationRef = useRef(null);
  const meterRef = useRef(null);
  const mountedRef = useRef(true);
  const changeRef = useRef(onStateChange);
  const [devices, setDevices] = useState([]);
  const [cameraId, setCameraId] = useState('');
  const [microphoneId, setMicrophoneId] = useState('');
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [hasCamera, setHasCamera] = useState(false);
  const [hasMicrophone, setHasMicrophone] = useState(false);
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  changeRef.current = onStateChange;

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      if (mountedRef.current) setDevices(list.filter((device) => ['videoinput', 'audioinput'].includes(device.kind)));
    } catch { /* Device labels become available after permission is granted. */ }
  }, []);

  const release = useCallback(() => {
    cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioRef.current) audioRef.current.close().catch(() => {});
    audioRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (meterRef.current) meterRef.current.style.setProperty('--audio-level', '0%');
  }, []);

  const stop = useCallback(() => {
    release();
    setActive(false);
    setLevel(0);
    setHasCamera(false);
    setHasMicrophone(false);
    setMuted(false);
    setCameraEnabled(true);
    changeRef.current?.({ active: false, hasCamera: false, hasMicrophone: false });
  }, [release]);

  useEffect(() => {
    mountedRef.current = true;
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => {
      mountedRef.current = false;
      release();
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
    };
  }, [refreshDevices, release]);

  async function start() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot access camera and microphone devices. Use a current browser over HTTPS or localhost.');
      return;
    }
    setStarting(true);
    release();
    try {
      const video = cameraId ? { deviceId: { exact: cameraId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } };
      const audio = microphoneId ? { deviceId: { exact: microphoneId }, echoCancellation: true } : { echoCancellation: true };
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio });
      } catch (firstError) {
        if (firstError.name !== 'NotFoundError') throw firstError;
        // A missing webcam must not prevent checking an available microphone (and vice versa).
        const attempts = await Promise.allSettled([
          navigator.mediaDevices.getUserMedia({ video, audio: false }),
          navigator.mediaDevices.getUserMedia({ video: false, audio }),
        ]);
        const tracks = attempts.flatMap((result) => result.status === 'fulfilled' ? result.value.getTracks() : []);
        if (!tracks.length) throw firstError;
        stream = new MediaStream(tracks);
      }
      if (!mountedRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const videoAvailable = stream.getVideoTracks().length > 0;
      const audioAvailable = stream.getAudioTracks().length > 0;
      setHasCamera(videoAvailable);
      setHasMicrophone(audioAvailable);
      setActive(true);
      setMuted(false);
      setCameraEnabled(true);
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); }
      await refreshDevices();
      changeRef.current?.({ active: true, hasCamera: videoAvailable, hasMicrophone: audioAvailable });
      if (!videoAvailable || !audioAvailable) setError(`${!videoAvailable ? 'Camera' : 'Microphone'} not found. You can still check your available device.`);
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (audioAvailable && AudioContext) {
        try {
          const context = new AudioContext();
          audioRef.current = context;
          await context.resume();
          if (!mountedRef.current || streamRef.current !== stream) { context.close().catch(() => {}); return; }
          const analyser = context.createAnalyser();
          analyser.fftSize = 256;
          context.createMediaStreamSource(stream).connect(analyser);
          const values = new Uint8Array(analyser.frequencyBinCount);
          let frame = 0;
          const tick = () => {
            analyser.getByteFrequencyData(values);
            const strength = Math.min(100, Math.round(values.reduce((sum, value) => sum + value, 0) / values.length / 160 * 100));
            meterRef.current?.style.setProperty('--audio-level', `${strength}%`);
            if (frame++ % 15 === 0) setLevel(strength);
            animationRef.current = requestAnimationFrame(tick);
          };
          tick();
        } catch { setError('Preview is active. This browser could not open the audio meter; microphone recording is still local.'); }
      }
    } catch (failure) {
      release();
      if (mountedRef.current) { setActive(false); setError(deviceError(failure)); }
    } finally { if (mountedRef.current) setStarting(false); }
  }

  function toggleMute() {
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }

  function toggleCamera() {
    const next = !cameraEnabled;
    streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCameraEnabled(next);
  }

  const cameraDevices = devices.filter((device) => device.kind === 'videoinput');
  const microphoneDevices = devices.filter((device) => device.kind === 'audioinput');

  return (
    <section className={`studio-camera-card ${compact ? 'studio-camera-compact' : ''}`} aria-label="Local camera and microphone preview">
      <div className="studio-card-heading"><div><span className="studio-eyebrow">YOUR FRAME</span><h2>Camera preview</h2></div><span className={`studio-local-tag ${active ? 'is-active' : ''}`}><span />{active ? 'Preview active' : 'Local only'}</span></div>
      <div className={`studio-preview ${active && hasCamera && cameraEnabled ? 'has-video' : ''}`}>
        <video ref={videoRef} muted autoPlay playsInline aria-label="Your local camera preview" />
        {(!active || !hasCamera || !cameraEnabled) && <div className="studio-preview-idle"><div className="studio-preview-orbit" /><div className="studio-preview-camera-icon">{active && !cameraEnabled ? <CameraOff size={29} /> : <Camera size={29} />}</div><h3>{active ? (cameraEnabled ? 'Audio preview is running' : 'Camera is off') : 'Make yourself at home.'}</h3><p>{active ? 'Your devices stay on this device.' : 'Check your frame and sound before the show.'}</p></div>}
        <div className="studio-preview-top"><span><span className={`studio-dot ${active ? 'green' : ''}`} />{active ? 'LOCAL PREVIEW' : 'CAMERA STANDBY'}</span><span>16:9</span></div>
        <div className="studio-preview-bottom"><span><ShieldCheck size={13} /> Private device check</span><span>Not broadcasting</span></div>
      </div>
      <div className="studio-preview-actions">
        <button className={`studio-button ${active ? 'studio-button-subtle' : 'studio-button-lime'}`} onClick={active ? stop : start} disabled={starting} type="button">{active ? <Square size={15} /> : <Play size={15} fill="currentColor" />}{starting ? 'Connecting…' : active ? 'Stop preview' : 'Start camera'}</button>
        <div className="studio-preview-toggles"><button className={`studio-icon-button ${muted ? 'is-off' : ''}`} disabled={!active || !hasMicrophone} onClick={toggleMute} type="button" aria-label={muted ? 'Unmute local microphone' : 'Mute local microphone'} aria-pressed={muted}>{muted ? <MicOff size={18} /> : <Mic size={18} />}</button><button className={`studio-icon-button ${!cameraEnabled ? 'is-off' : ''}`} disabled={!active || !hasCamera} onClick={toggleCamera} type="button" aria-label={cameraEnabled ? 'Turn local camera off' : 'Turn local camera on'} aria-pressed={!cameraEnabled}>{cameraEnabled ? <Camera size={18} /> : <CameraOff size={18} />}</button></div>
      </div>
      <div className="studio-device-fields"><label><span><Camera size={14} /> Camera</span><div className="studio-select"><select value={cameraId} onChange={(event) => setCameraId(event.target.value)} disabled={active || starting} aria-label="Select camera"><option value="">Default camera</option>{cameraDevices.map((device, index) => <option key={device.deviceId || `camera-${index}`} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select><ChevronDown size={14} /></div></label><label><span><Mic size={14} /> Microphone</span><div className="studio-select"><select value={microphoneId} onChange={(event) => setMicrophoneId(event.target.value)} disabled={active || starting} aria-label="Select microphone"><option value="">Default microphone</option>{microphoneDevices.map((device, index) => <option key={device.deviceId || `microphone-${index}`} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select><ChevronDown size={14} /></div></label></div>
      <div className="studio-audio-row"><Volume2 size={15} /><span>{muted ? 'Microphone muted' : 'Microphone level'}</span><div className={`studio-audio-meter ${muted ? 'is-muted' : ''}`} ref={meterRef} role="meter" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={muted ? 0 : level}><div /></div><span className="studio-audio-value">{active && hasMicrophone ? (muted ? 'MUTED' : `${level}%`) : '—'}</span></div>
      {error && <p className="studio-device-error" role="alert">{error}</p>}
      <p className="studio-preview-note">{compact ? 'This check stays on your device. Sign in to configure your provider and broadcast with OBS.' : 'This preview checks your equipment locally. Broadcast with OBS using your secure provider connection below.'}{active ? ' Stop preview to change devices.' : ''}</p>
    </section>
  );
}

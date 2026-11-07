import { CameraSession } from './camera-session.js';
import { makeLut } from './palettes.js';

const $ = id => document.getElementById(id);
const canvas = $('output');
const ctx = canvas.getContext('2d', { alpha: false });
const video = $('video');
const raw = document.createElement('canvas');
const rawCtx = raw.getContext('2d', { willReadFrequently: true, alpha: false });
const held = document.createElement('canvas');
const heldCtx = held.getContext('2d', { alpha: false });
const sample = new Image();
const state = { source: null, mode: 'sample', label: 'Illustrated sample', palette: 'ember', compare: false, mirror: false, facing: 'environment', busy: false, fps: 0, frames: 0, fpsSince: 0, lastFrame: 0, cameraAction: 0, sourceAction: 0 };
let lut = makeLut('ember');
let frameId = 0;
let noticeTimer;
let activeFileUrl;
const session = new CameraSession({ onEnded: () => { if (state.mode === 'camera' || state.busy) stopCamera('Camera disconnected. Reconnect it, then choose Start camera.'); } });

function notify(message, error = false) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = !message;
  if (!error) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500);
}

function updateControls() {
  const live = state.mode === 'camera' && !!session.stream;
  $('startCamera').disabled = state.busy || live;
  $('startCamera').setAttribute('aria-busy', String(state.busy));
  $('stopCamera').disabled = !live && !state.busy;
  $('switchCamera').disabled = !live || state.busy;
  $('freezeFrame').disabled = !live;
  $('saveSnapshot').disabled = !state.source;
  $('statusText').textContent = state.busy ? 'Connecting…' : live ? 'Camera live' : state.mode === 'sample' ? 'Sample ready' : state.mode === 'image' ? 'Photo ready' : state.mode === 'frozen' ? 'Frame frozen · camera off' : 'Camera off';
  $('statusDot').classList.toggle('live', live);
  $('sourceLabel').textContent = state.label;
  $('stageBadge').textContent = state.busy ? 'CONNECTING' : live ? 'LIVE CAMERA' : state.mode === 'sample' ? 'ILLUSTRATED SAMPLE' : state.mode === 'image' ? 'UPLOADED PHOTO' : state.mode === 'frozen' ? 'FROZEN FRAME' : 'CAMERA OFF';
  $('fpsLabel').textContent = live ? `${state.fps} fps` : 'Still image';
}

function dimensions(source) {
  return [source.videoWidth || source.naturalWidth || source.width, source.videoHeight || source.naturalHeight || source.height];
}

function render() {
  if (!state.source) return;
  const [sw, sh] = dimensions(state.source);
  if (!sw || !sh) return;
  const scale = Math.min(1, 800 / sw, 800 / sh);
  const width = Math.max(1, Math.round(sw * scale)), height = Math.max(1, Math.round(sh * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = raw.width = width;
    canvas.height = raw.height = height;
  }
  rawCtx.save();
  rawCtx.fillStyle = '#111'; rawCtx.fillRect(0, 0, width, height);
  if (state.mirror) { rawCtx.translate(width, 0); rawCtx.scale(-1, 1); }
  rawCtx.filter = `blur(${Number($('smoothing').value) * 2.4}px)`;
  rawCtx.drawImage(state.source, 0, 0, width, height);
  rawCtx.restore();
  const pixels = rawCtx.getImageData(0, 0, width, height);
  const data = pixels.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (state.compare && x < width / 2) continue;
      const i = (y * width + x) * 4;
      const index = Math.round(data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722) * 3;
      data[i] = lut[index]; data[i + 1] = lut[index + 1]; data[i + 2] = lut[index + 2];
    }
  }
  ctx.putImageData(pixels, 0, 0);
  if (state.compare) {
    ctx.fillStyle = '#fff'; ctx.fillRect(Math.floor(width / 2), 0, 2, height);
    const size = Math.max(11, Math.round(width / 65));
    ctx.font = `600 ${size}px system-ui`;
    const drawTag = (text, x) => { ctx.fillStyle = 'rgba(7,9,15,.75)'; ctx.fillRect(x - 7, 11, ctx.measureText(text).width + 14, size + 14); ctx.fillStyle = '#fff'; ctx.fillText(text, x, size + 17); };
    drawTag('ORIGINAL', 20); drawTag('COLOR EFFECT', width / 2 + 20);
  }
  $('resolutionLabel').textContent = `${width} × ${height}`;
}

function runFrames(time) {
  frameId = 0;
  if (state.mode !== 'camera') return;
  if (time - state.lastFrame >= 1000 / 24) {
    render(); state.lastFrame = time; state.frames++;
    if (time - state.fpsSince > 1000) {
      state.fps = Math.round(state.frames * 1000 / (time - state.fpsSince));
      state.frames = 0; state.fpsSince = time;
      $('fpsLabel').textContent = `${state.fps} fps`;
    }
  }
  frameId = requestAnimationFrame(runFrames);
}

function captureRaw() {
  if (!state.source) return;
  const [w, h] = dimensions(state.source);
  if (!w || !h) return;
  const scale = Math.min(1, 1200 / w, 1200 / h);
  held.width = Math.round(w * scale); held.height = Math.round(h * scale);
  heldCtx.drawImage(state.source, 0, 0, held.width, held.height);
  state.source = held;
}

function haltStream() {
  state.cameraAction++;
  state.busy = false;
  session.stop();
  video.pause(); video.srcObject = null;
  cancelAnimationFrame(frameId); frameId = 0;
}

function stopCamera(message = '') {
  state.sourceAction++;
  if (state.mode === 'camera') { captureRaw(); state.mode = 'stopped'; state.label = 'Last frame · camera off'; }
  haltStream();
  updateControls(); render();
  if (message) notify(message);
}

async function refreshCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
    const current = session.stream?.getVideoTracks()[0]?.getSettings().deviceId;
    const select = $('sourceSelect');
    select.replaceChildren(new Option('Auto camera', ''));
    devices.forEach((device, i) => select.add(new Option(device.label || `Camera ${i + 1}`, device.deviceId)));
    select.value = current || '';
  } catch { /* The browser may keep device names private until permission. */ }
}

function cameraError(error) {
  return ({ NotAllowedError: 'Camera access was blocked. Allow camera access in your browser’s site settings, then try again. You can also upload a photo.', NotFoundError: 'No camera was found. Connect a webcam or upload a photo.', NotReadableError: 'The camera is busy or unavailable. Close other apps using it, then try again.', OverconstrainedError: 'That camera setting is unavailable. Choose Auto camera and try again.', SecurityError: 'Your browser blocked camera access. Open this app directly in a browser with camera permission.' })[error?.name] || 'The camera could not start. Try opening the app directly in Safari or Chrome, or upload a photo.';
}

async function startCamera(deviceId = '') {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    notify('Camera access needs HTTPS or localhost. Open the published link directly in Safari or Chrome, or upload a photo.', true); return;
  }
  if (state.mode === 'camera') { captureRaw(); state.mode = 'stopped'; state.label = 'Last frame · camera off'; }
  haltStream();
  state.sourceAction++;
  const action = state.cameraAction;
  state.busy = true; updateControls(); notify('Requesting camera access. Audio is never requested.');
  try {
    const stream = await session.start({ audio: false, video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: state.facing } }), width: { ideal: 1280 }, height: { ideal: 720 } } });
    if (!stream || action !== state.cameraAction) return;
    video.srcObject = stream;
    await video.play();
    if (action !== state.cameraAction || stream !== session.stream) return;
    state.mode = 'camera'; state.source = video;
    state.label = stream.getVideoTracks()[0]?.label || 'Device camera';
    state.busy = false; state.frames = 0; state.fps = 0; state.fpsSince = performance.now();
    updateControls(); render();
    frameId = requestAnimationFrame(runFrames);
    void refreshCameras();
    notify('Camera is on. This is a brightness-based color effect, not a heat reading.');
  } catch (error) {
    if (action !== state.cameraAction) return;
    haltStream();
    if (state.mode === 'camera') { state.mode = 'stopped'; state.label = 'Last frame · camera off'; }
    updateControls(); render(); notify(cameraError(error), true);
  }
}

function rebuildLut() {
  lut = makeLut(state.palette, Number($('contrast').value), Number($('exposure').value), $('invert').checked);
  $('stage').dataset.inverted = String($('invert').checked);
  $('contrastValue').textContent = `${Number($('contrast').value).toFixed(2)}×`;
  const exposure = Math.round(Number($('exposure').value) * 100);
  $('exposureValue').textContent = `${exposure > 0 ? '+' : ''}${exposure}%`;
  $('smoothingValue').textContent = `${Math.round(Number($('smoothing').value) * 100)}%`;
  if (state.mode !== 'camera') render();
}

function useSample() {
  state.sourceAction++;
  haltStream();
  if (!sample.complete || !sample.naturalWidth) return;
  state.mode = 'sample'; state.source = sample; state.label = 'Illustrated sample';
  updateControls(); render();
  notify('Illustrated sample selected. Try a palette, open a photo, or choose Start camera.');
}

$('startCamera').addEventListener('click', () => void startCamera($('sourceSelect').value));
$('stopCamera').addEventListener('click', () => stopCamera('Camera stopped. The last frame stays on your screen.'));
$('switchCamera').addEventListener('click', () => {
  const select = $('sourceSelect'), options = Array.from(select.options).filter(option => option.value);
  if (options.length > 1) {
    const current = session.stream?.getVideoTracks()[0]?.getSettings().deviceId;
    const index = options.findIndex(option => option.value === current);
    select.value = options[(index + 1) % options.length].value;
    void startCamera(select.value);
  } else {
    state.facing = state.facing === 'environment' ? 'user' : 'environment';
    void startCamera();
  }
});
$('sourceSelect').addEventListener('change', () => { if (state.mode === 'camera') void startCamera($('sourceSelect').value); });
$('freezeFrame').addEventListener('click', () => {
  if (state.mode !== 'camera') return;
  captureRaw(); haltStream(); state.mode = 'frozen'; state.label = 'Frozen frame · camera off';
  updateControls(); render(); notify('Frame frozen and camera turned off. Choose Start camera to resume.');
});
$('paletteButtons').addEventListener('click', event => {
  const button = event.target.closest('button[data-palette]');
  if (!button) return;
  state.palette = button.dataset.palette;
  $('paletteButtons').querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  $('stage').dataset.palette = state.palette;
  rebuildLut();
});
for (const id of ['contrast', 'exposure', 'smoothing', 'invert']) $(id).addEventListener('input', rebuildLut);
$('comparison').addEventListener('click', () => { state.compare = !state.compare; $('comparison').setAttribute('aria-pressed', String(state.compare)); if (state.mode !== 'camera') render(); });
$('mirror').addEventListener('click', () => { state.mirror = !state.mirror; $('mirror').setAttribute('aria-pressed', String(state.mirror)); if (state.mode !== 'camera') render(); });
$('resetControls').addEventListener('click', () => {
  $('contrast').value = 1.15; $('exposure').value = 0; $('smoothing').value = .15; $('invert').checked = false;
  state.mirror = false; state.compare = false; state.palette = 'ember';
  $('mirror').setAttribute('aria-pressed', 'false'); $('comparison').setAttribute('aria-pressed', 'false');
  $('paletteButtons').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.palette === 'ember')));
  $('stage').dataset.palette = 'ember'; rebuildLut();
});
$('uploadImage').addEventListener('click', () => $('imageInput').click());
$('imageInput').addEventListener('change', async () => {
  const file = $('imageInput').files[0]; $('imageInput').value = '';
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { notify('Choose a PNG, JPEG, or WebP image.', true); return; }
  if (file.size > 25 * 1024 * 1024) { notify('Choose an image smaller than 25 MB.', true); return; }
  const action = ++state.sourceAction;
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url; await image.decode();
    if (action !== state.sourceAction) { URL.revokeObjectURL(url); return; }
    haltStream();
    if (activeFileUrl) URL.revokeObjectURL(activeFileUrl);
    activeFileUrl = url; state.source = image; state.mode = 'image'; state.label = file.name;
    updateControls(); render(); notify('Photo opened locally. No image has been uploaded to a server.');
  } catch { URL.revokeObjectURL(url); if (action === state.sourceAction) notify('That image could not be opened. Try another PNG, JPEG, or WebP.', true); }
});
$('sampleButton').addEventListener('click', useSample);
$('saveSnapshot').addEventListener('click', () => {
  if (!state.source) return;
  render();
  const exported = document.createElement('canvas');
  exported.width = canvas.width; exported.height = canvas.height + 72;
  const ex = exported.getContext('2d');
  ex.fillStyle = '#101115'; ex.fillRect(0, 0, exported.width, exported.height); ex.drawImage(canvas, 0, 0);
  const size = Math.max(10, Math.min(13, exported.width / 45));
  ex.fillStyle = '#ff9a5c'; ex.font = `700 ${size}px system-ui`;
  ex.fillText('HEATWAVE · SIMULATED COLOR EFFECT', 16, canvas.height + 25);
  ex.fillStyle = '#c4c4c9'; ex.font = `${size}px system-ui`;
  ex.fillText('No temperature data · No through-wall viewing', 16, canvas.height + 47);
  exported.toBlob(blob => {
    if (!blob) { notify('Snapshot could not be saved. Try again.', true); return; }
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `heatwave-${state.palette}-${Date.now()}.png`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    notify('Snapshot download requested. It includes the simulated-effect label.');
  }, 'image/png');
});
$('fullscreen').addEventListener('click', async () => {
  const stage = $('stage');
  if (!stage.requestFullscreen) { notify('Fullscreen is unavailable in this browser. Rotate your phone for a larger view.'); return; }
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.requestFullscreen(); }
  catch { notify('Fullscreen is unavailable here. Open the app directly in your browser for a larger view.'); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (session.stream || state.busy)) stopCamera('Camera stopped because this tab was hidden. Choose Start camera to resume.');
});
window.addEventListener('pagehide', () => { if (session.stream || state.busy) stopCamera(); });
navigator.mediaDevices?.addEventListener?.('devicechange', refreshCameras);
sample.addEventListener('load', () => { if (!state.source && !state.busy && state.mode === 'sample') useSample(); });
sample.addEventListener('error', () => notify('The sample could not load. Choose Start camera or upload a photo.', true));
sample.src = './sample.svg';
rebuildLut(); updateControls();

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownLeft, ArrowLeft, ArrowRight, AudioLines, CalendarDays, Check, CheckCircle2, ChevronRight, CircleHelp, Clock3, Copy, ExternalLink, Eye, EyeOff, ImagePlus, LayoutDashboard, LockKeyhole, LogOut, Radio, RefreshCw, Save, Settings2, ShieldCheck, Signal, Square, Users, Video, X } from 'lucide-react';
import CameraPreview from '../components/CameraPreview';
import { adminRequest } from '../services/admin-api';
import { siteConfig as defaultSiteConfig } from '../config/site';
import '../styles/admin.css';

const INITIAL_FORM = { title: '', category: '', description: '', nextTitle: '', nextDate: '' };
const STATUS_LABELS = { offline: 'Offline', preparing: 'Preparing', live: 'Live', ended: 'Ended' };

function localDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function formFromSettings(settings = {}) {
  return { title: settings.title || '', category: settings.category || '', description: settings.description || '', nextTitle: settings.nextStream?.title || '', nextDate: localDateTime(settings.nextStream?.startsAt) };
}

function elapsed(startedAt, now) {
  if (!startedAt) return '00:00:00';
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return '00:00:00';
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((number) => String(number).padStart(2, '0')).join(':');
}

function StudioLogo({ light = false }) {
  return <a href="/" className={`studio-logo ${light ? 'studio-logo-light' : ''}`} aria-label="Signal Studio home"><span className="studio-logo-mark"><AudioLines size={21} strokeWidth={2.8} /></span><span>SIGNAL<span className="studio-logo-suffix">STUDIO</span></span></a>;
}

function Toast({ message, onClose }) {
  if (!message) return null;
  return <div className={`studio-toast ${message.type === 'error' ? 'is-error' : ''}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.type === 'error' ? <CircleHelp size={18} /> : <CheckCircle2 size={18} />}<span>{message.text}</span><button type="button" onClick={onClose} aria-label="Dismiss notification"><X size={16} /></button></div>;
}

export default function AdminPage({ config = {}, siteConfig = {} }) {
  const creatorName = config.streamerName || siteConfig.streamerName || config.streamer?.name || siteConfig.streamer?.name || defaultSiteConfig.streamer.name;
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [showEquipment, setShowEquipment] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [saving, setSaving] = useState(false);
  const [streamAction, setStreamAction] = useState('');
  const [ingest, setIngest] = useState(null);
  const [revealing, setRevealing] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [thumbnail, setThumbnail] = useState(null);
  const [previewState, setPreviewState] = useState({ active: false });
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [activeTab, setActiveTab] = useState('overview');
  const toastTimer = useRef(null);
  const initialized = useRef(false);
  const thumbnailUrl = useRef(null);
  const viewerUrl = `${window.location.origin}/`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const notify = useCallback((text, type = 'success') => {
    clearTimeout(toastTimer.current);
    setToast({ text, type });
    toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 9000 : 5000);
  }, []);

  const checkSession = useCallback(async () => {
    setChecking(true);
    setSessionError('');
    try { setSession(await adminRequest('session')); }
    catch (error) { setSession({ authenticated: false, configured: false, unavailable: true }); setSessionError(error.message); }
    finally { setChecking(false); }
  }, []);

  useEffect(() => {
    document.title = 'Studio · SIGNAL';
    checkSession();
    return () => { clearTimeout(toastTimer.current); if (thumbnailUrl.current) URL.revokeObjectURL(thumbnailUrl.current); };
  }, [checkSession]);

  const loadDashboard = useCallback(async (foreground = false) => {
    if (foreground) setLoadingDashboard(true);
    try {
      const result = await adminRequest('admin');
      setSnapshot(result);
      setDashboardError('');
      if (!initialized.current) { setForm(formFromSettings(result.settings)); initialized.current = true; }
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        setSession((current) => ({ ...current, authenticated: false }));
        setSnapshot(null); setIngest(null); setKeyVisible(false); initialized.current = false;
        setSessionError('Your session has expired. Sign in again to continue.');
      } else setDashboardError(error.message);
    } finally { if (foreground) setLoadingDashboard(false); }
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return;
    loadDashboard(true);
    const refresh = setInterval(() => loadDashboard(), 12000);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(refresh); clearInterval(timer); };
  }, [session?.authenticated, loadDashboard]);

  async function login(event) {
    event.preventDefault();
    setLoggingIn(true); setSessionError('');
    try {
      const result = await adminRequest('login', { method: 'POST', body: { password } });
      setPassword(''); setShowEquipment(false); setSession(result);
    } catch (error) { setSessionError(error.message); }
    finally { setLoggingIn(false); }
  }

  async function logout() {
    try {
      await adminRequest('logout', { method: 'POST', body: {} });
      setSession((current) => ({ ...current, authenticated: false }));
      setSnapshot(null); setIngest(null); setKeyVisible(false); setPreviewState({ active: false }); initialized.current = false;
    } catch (error) { notify(error.message, 'error'); }
  }

  const updateField = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  async function saveSettings(event) {
    event?.preventDefault();
    if (!form.title.trim()) { notify('Give your stream a title before saving.', 'error'); return; }
    if (form.nextDate && new Date(form.nextDate).getTime() <= Date.now()) { notify('Choose a future date for your upcoming stream.', 'error'); return; }
    setSaving(true);
    try {
      const settings = { title: form.title.trim(), category: form.category.trim(), description: form.description.trim(), nextStream: form.nextDate ? { title: form.nextTitle.trim() || form.title.trim().slice(0, 120), startsAt: new Date(form.nextDate).toISOString() } : null };
      const result = await adminRequest('settings', { method: 'PUT', body: settings });
      setSnapshot((current) => ({ ...current, settings: result.settings }));
      setForm(formFromSettings(result.settings));
      notify('Channel details saved. Your viewer page will update automatically.');
    } catch (error) { notify(error.message, 'error'); }
    finally { setSaving(false); }
  }

  async function handleStream(action) {
    if (action === 'end' && !window.confirm('End this broadcast? The provider will disconnect the active stream. You can prepare a new broadcast afterward.')) return;
    setStreamAction(action);
    try {
      const result = await adminRequest('stream', { method: 'POST', body: { action } });
      setSnapshot((current) => ({ ...current, stream: result.stream }));
      if (action === 'end') { setIngest(null); setKeyVisible(false); }
      notify(result.message || (action === 'prepare' ? 'Broadcast prepared. Connect OBS to your provider to go live.' : 'Broadcast ended.'));
      await loadDashboard();
    } catch (error) { notify(error.message, 'error'); }
    finally { setStreamAction(''); }
  }

  async function revealIngest() {
    if (ingest) { setIngest(null); setKeyVisible(false); return; }
    setRevealing(true);
    try { setIngest(await adminRequest('ingest')); }
    catch (error) { notify(error.message, 'error'); }
    finally { setRevealing(false); }
  }

  async function copy(value, label = 'Link') {
    try { await navigator.clipboard.writeText(value); notify(`${label} copied to clipboard.`); }
    catch { notify('Clipboard access is unavailable. Select and copy the value directly.', 'error'); }
  }

  function chooseThumbnail(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) { notify('Choose a JPG, PNG, WebP, or AVIF image.', 'error'); event.target.value = ''; return; }
    if (file.size > 8 * 1024 * 1024) { notify('Choose an image smaller than 8 MB.', 'error'); event.target.value = ''; return; }
    if (thumbnailUrl.current) URL.revokeObjectURL(thumbnailUrl.current);
    thumbnailUrl.current = URL.createObjectURL(file);
    setThumbnail({ name: file.name, url: thumbnailUrl.current });
  }

  const status = snapshot?.stream?.status || 'offline';
  const providerReady = Boolean(snapshot?.provider?.configured);
  const isLive = status === 'live';
  const isPreparing = status === 'preparing';
  const viewerCount = snapshot?.stream?.viewerCount;

  if (!session?.authenticated) {
    return <div className="signal-studio studio-auth-page">
      <header className="studio-auth-header"><StudioLogo /><a href="/" className="studio-back-link"><ArrowLeft size={15} /> Back to channel</a></header>
      <main className="studio-auth-layout">
        <section className="studio-auth-intro"><div className="studio-auth-kicker"><span /> YOUR SPACE TO GO LIVE</div><h1>A little preparation.<br />A <em>better broadcast.</em></h1><p>Your channel’s control room. Set the scene, check your sound, and put something good into the world.</p><div className="studio-auth-visual" aria-hidden="true"><div className="studio-auth-grid" /><div className="studio-auth-wave">{Array.from({ length: 41 }, (_, index) => <span key={index} style={{ '--bar-height': `${15 + Math.sin(index * .48) * 23 + Math.cos(index * .21) * 18 + (index > 12 && index < 29 ? 40 : 10)}%`, '--delay': `${index * .06}s` }} />)}</div><span className="studio-auth-frequency">TRANSMIT SOMETHING REAL.</span><span className="studio-auth-coordinate">SIGNAL / 001</span></div><div className="studio-auth-promises"><span><ShieldCheck size={15} /> Secure studio access</span><span><Radio size={15} /> Powered by your provider</span></div></section>
        <section className="studio-login-panel" aria-labelledby="studio-login-title"><div className="studio-login-icon"><LockKeyhole size={23} /></div><span className="studio-eyebrow">CREATOR ACCESS</span><h2 id="studio-login-title">Welcome to your studio.</h2><p>Sign in to manage your channel and prepare your next livestream.</p>
          {checking ? <div className="studio-session-check" role="status"><RefreshCw className="studio-spinning" size={19} /> Checking your secure session…</div> : <>
            {!session?.configured && <div className="studio-setup-note"><ShieldCheck size={18} /><div><strong>{session?.unavailable ? 'Connect the studio server' : 'Your secure studio needs setup'}</strong><p>{session?.unavailable ? 'Run the full project with Netlify Functions to enable sign-in.' : 'Add ADMIN_SECRET (at least 16 characters) and SESSION_SECRET (at least 32 characters) to your Netlify environment, then redeploy.'}</p><span>See the included README for the complete setup.</span></div></div>}
            <form onSubmit={login} className="studio-login-form"><label htmlFor="studio-password">Admin password</label><div className="studio-password-field"><LockKeyhole size={17} /><input id="studio-password" type={passwordVisible ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your admin password" required disabled={!session?.configured || loggingIn} /><button type="button" aria-label={passwordVisible ? 'Hide password' : 'Show password'} onClick={() => setPasswordVisible(!passwordVisible)}>{passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><button className="studio-button studio-button-lime studio-login-button" type="submit" disabled={!session?.configured || loggingIn}>{loggingIn ? 'Signing in…' : 'Enter studio'}<ArrowRight size={17} /></button></form>
            {sessionError && <p className="studio-login-error" role="alert">{sessionError}</p>}
            {session?.unavailable && <button type="button" className="studio-text-button" onClick={checkSession}><RefreshCw size={14} /> Retry connection</button>}
          </>}
          <div className="studio-login-divider"><span>GET CAMERA READY</span></div><button className="studio-equipment-button" onClick={() => setShowEquipment(!showEquipment)} type="button"><span><Video size={18} /><span><strong>Check your equipment</strong><small>Private camera & microphone preview</small></span></span>{showEquipment ? <X size={17} /> : <ChevronRight size={17} />}</button><p className="studio-auth-safety"><ShieldCheck size={13} /> Your stream key is only available after sign-in.</p>
        </section>
      </main>
      {showEquipment && <div className="studio-auth-equipment"><CameraPreview compact /></div>}
      <footer className="studio-auth-footer"><span>SIGNAL STUDIO</span><span>Good things start with a signal.</span><a href="/">Visit the channel <ArrowDownLeft size={13} /></a></footer>
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>;
  }

  return <div className="signal-studio studio-dashboard">
    <aside className="studio-sidebar"><StudioLogo /><div className="studio-workspace-label">CREATOR WORKSPACE</div><nav aria-label="Studio navigation"><a href="#overview" className={activeTab === 'overview' ? 'is-selected' : ''} onClick={() => setActiveTab('overview')}><LayoutDashboard size={18} /> Overview<span className="studio-nav-dot" /></a><a href="#broadcast" className={activeTab === 'broadcast' ? 'is-selected' : ''} onClick={() => setActiveTab('broadcast')}><Radio size={18} /> Broadcast</a><a href="#schedule" className={activeTab === 'schedule' ? 'is-selected' : ''} onClick={() => setActiveTab('schedule')}><CalendarDays size={18} /> Schedule</a><a href="#channel-settings" className={activeTab === 'settings' ? 'is-selected' : ''} onClick={() => setActiveTab('settings')}><Settings2 size={18} /> Channel details</a></nav><div className="studio-sidebar-bottom"><div className="studio-provider-mini"><span className={`studio-dot ${providerReady ? 'green' : ''}`} /><span>{providerReady ? (snapshot?.provider?.health === 'error' ? 'Check provider' : 'Provider configured') : 'Provider setup needed'}<small>{providerReady ? 'Server-side credentials configured' : 'Add credentials to connect'}</small></span></div><a className="studio-sidebar-view" href="/" target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> View your channel<ArrowRight size={15} /></a><div className="studio-account"><div className="studio-account-avatar">{String(creatorName).slice(0, 1).toUpperCase()}</div><span><strong>{creatorName}</strong><small>Channel owner</small></span><button type="button" aria-label="Sign out of studio" title="Sign out" onClick={logout}><LogOut size={17} /></button></div></div></aside>
    <div className="studio-main"><header className="studio-topbar"><div><span className="studio-breadcrumb">Your studio</span><ChevronRight size={13} /><span>Overview</span></div><div><span className="studio-secure-label"><ShieldCheck size={14} /> Secure session</span><button type="button" className="studio-icon-button studio-mobile-logout" onClick={logout} aria-label="Sign out"><LogOut size={17} /></button><a href="/" target="_blank" rel="noopener noreferrer" className="studio-button studio-button-subtle studio-top-channel">View channel<ExternalLink size={14} /></a></div></header>
      <main className="studio-main-content" id="overview"><div className="studio-page-heading"><div><span className="studio-eyebrow">THE CONTROL ROOM</span><h1>Let’s make a little noise<span>.</span></h1><p>Everything you need for your next great broadcast.</p></div><div className="studio-heading-actions"><button type="button" className="studio-button studio-button-subtle" onClick={() => copy(viewerUrl, 'Viewer link')}><Copy size={15} /> Copy channel link</button><button type="button" className="studio-button studio-button-lime" disabled={!providerReady || !!streamAction || isLive || isPreparing} onClick={() => handleStream('prepare')}><Radio size={16} />{streamAction === 'prepare' ? 'Preparing…' : isLive ? 'You’re live' : isPreparing ? 'Awaiting broadcast' : 'Prepare stream'}</button></div></div>
        {dashboardError && <div className="studio-banner studio-banner-error" role="alert"><CircleHelp size={18} /><p>{dashboardError}</p><button type="button" onClick={() => loadDashboard(true)}><RefreshCw size={15} /> Retry</button></div>}
        {!providerReady && snapshot && <div className="studio-banner"><Signal size={19} /><p><strong>One more connection before you go live.</strong> Add your Mux credentials and prepare a broadcast. Your local equipment preview works now.</p><a href="#broadcast">View setup<ArrowRight size={15} /></a></div>}
        {loadingDashboard && !snapshot ? <div className="studio-dashboard-loading" role="status"><RefreshCw size={24} className="studio-spinning" /><span>Opening your control room…</span></div> : <>
          <div className="studio-stat-grid"><div className="studio-stat"><div className="studio-stat-top"><span>Stream status</span><Radio size={16} /></div><strong className={`studio-status-word ${isLive ? 'studio-live-state' : ''}`}><span className={`studio-dot ${isLive ? 'red' : isPreparing ? 'green' : ''}`} />{STATUS_LABELS[status] || 'Unavailable'}</strong><small>{isLive ? 'Your provider is receiving video' : isPreparing ? 'Waiting for OBS to connect' : 'Your channel is ready when you are'}</small></div><div className="studio-stat"><div className="studio-stat-top"><span>Stream duration</span><Clock3 size={16} /></div><strong className="studio-duration">{elapsed(isLive ? snapshot?.stream?.startedAt : null, now)}</strong><small>{isLive ? 'Time since provider went live' : 'Starts when your broadcast is live'}</small></div><div className="studio-stat"><div className="studio-stat-top"><span>Watching now</span><Users size={16} /></div><strong>{Number.isFinite(viewerCount) ? viewerCount.toLocaleString() : '—'}{Number.isFinite(viewerCount) && <span className="studio-stat-approx">approx.</span>}</strong><small>{Number.isFinite(viewerCount) ? 'Based on recent viewer presence' : 'Presence becomes available on your channel'}</small></div><div className="studio-stat"><div className="studio-stat-top"><span>Stream health</span><Activity size={16} /></div><strong className="studio-health-value"><span className={`studio-dot ${providerReady ? 'green' : ''}`} />{snapshot?.provider?.health === 'error' ? 'Check provider' : providerReady ? 'Ready' : 'Not configured'}</strong><small>{isLive ? 'Provider stream is active' : providerReady ? (snapshot?.provider?.health === 'error' ? 'Review your provider configuration' : 'Mux credentials are configured') : 'Connect Mux to monitor your stream'}</small></div></div>
          <div className="studio-work-grid"><div className="studio-preview-column"><CameraPreview onStateChange={setPreviewState} /><div className="studio-checklist"><div><ShieldCheck size={17} /><strong>A quick preflight</strong><span>{previewState.active ? 'Preview running' : 'Before you press play'}</span></div><p><Check size={14} /> Check your frame and microphone levels.</p><p><Check size={14} /> Save your stream title and category.</p><p><Check size={14} /> Start streaming in OBS. We’ll detect when you’re live.</p></div></div>
            <form className="studio-details-card" id="channel-settings" onSubmit={saveSettings}><div className="studio-card-heading"><div><span className="studio-eyebrow">SET THE SCENE</span><h2>Stream details</h2></div><Settings2 size={18} /></div><label className="studio-field"><span>Stream title<span className="studio-required">*</span><small>{form.title.length}/140</small></span><input name="title" value={form.title} onChange={updateField} maxLength={140} required placeholder="What’s the signal today?" /></label><label className="studio-field"><span>Category<span className="studio-required">*</span></span><input name="category" value={form.category} onChange={updateField} maxLength={64} required placeholder="e.g. Just chatting, Music, Gaming" list="studio-categories" /><datalist id="studio-categories"><option value="Just Chatting" /><option value="Music" /><option value="Gaming" /><option value="Art & Design" /><option value="Technology" /><option value="Community" /></datalist></label><label className="studio-field"><span>Description<small>{form.description.length}/2000</small></span><textarea name="description" value={form.description} onChange={updateField} maxLength={2000} rows={4} placeholder="Tell your audience what’s happening." /></label><div className="studio-thumbnail-label"><span>Thumbnail check</span><span>LOCAL PREVIEW</span></div><label className={`studio-thumbnail-upload ${thumbnail ? 'has-thumbnail' : ''}`} htmlFor="studio-thumbnail">{thumbnail ? <><img src={thumbnail.url} alt="Local thumbnail preview" /><div><strong>{thumbnail.name}</strong><span>Choose a different image</span></div></> : <><div className="studio-upload-icon"><ImagePlus size={20} /></div><div><strong>Try a thumbnail</strong><span>JPG, PNG, WebP or AVIF · Up to 8 MB</span></div></>}<input id="studio-thumbnail" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={chooseThumbnail} /></label><p className="studio-thumbnail-note">Image stays in this browser for review. It is not uploaded or published to your channel.</p><div className="studio-form-bottom"><span><ShieldCheck size={13} /> Public channel metadata</span><button type="submit" className="studio-button studio-button-lime" disabled={saving || !snapshot}>{saving ? <RefreshCw size={15} className="studio-spinning" /> : <Save size={15} />}{saving ? 'Saving…' : 'Save details'}</button></div></form>
          </div>
          <div className="studio-bottom-grid"><section className="studio-broadcast-card" id="broadcast"><div className="studio-card-heading"><div><span className="studio-eyebrow">TAKE IT LIVE</span><h2>Your broadcast connection</h2></div><span className="studio-provider-badge"><span /> MUX</span></div><p className="studio-section-intro">Your website is the stage. Mux delivers the video. Connect OBS to Mux, then your channel automatically goes live when video arrives.</p><div className="studio-broadcast-flow"><span><Video size={16} /> OBS<span>Capture & encode</span></span><ChevronRight size={16} /><span><Radio size={16} /> Mux<span>Secure video delivery</span></span><ChevronRight size={16} /><span><Eye size={16} /> Your channel<span>Ready to watch</span></span></div>
            <div className="studio-provider-status"><span className={`studio-dot ${providerReady ? 'green' : ''}`} /><div><strong>{providerReady ? (isLive ? 'Receiving your broadcast' : snapshot?.provider?.health === 'error' ? 'Connection needs attention' : 'Provider configured') : 'Connect your provider'}</strong><p>{snapshot?.provider?.message || (providerReady ? 'Prepare a stream, then use your private ingest credentials in OBS.' : 'Add MUX_TOKEN_ID and MUX_TOKEN_SECRET to Netlify, then redeploy. See README for the full setup.')}</p></div></div>
            {ingest && <div className="studio-ingest-details"><div className="studio-ingest-warning"><LockKeyhole size={14} /><span>These credentials grant broadcast access. Keep them private.</span></div><label className="studio-field"><span>OBS server URL</span><div className="studio-copy-field"><input value={ingest.serverUrl || ''} readOnly aria-label="Private OBS server URL" onFocus={(event) => event.target.select()} /><button type="button" aria-label="Copy OBS server URL" onClick={() => copy(ingest.serverUrl, 'Server URL')}><Copy size={15} /></button></div></label><label className="studio-field"><span>Stream key</span><div className="studio-copy-field"><input type={keyVisible ? 'text' : 'password'} value={ingest.streamKey || ''} readOnly autoComplete="off" aria-label="Private OBS stream key" onFocus={(event) => event.target.select()} /><button type="button" aria-label={keyVisible ? 'Hide stream key' : 'Show stream key'} onClick={() => setKeyVisible(!keyVisible)}>{keyVisible ? <EyeOff size={15} /> : <Eye size={15} />}</button><button type="button" aria-label="Copy private stream key" onClick={() => copy(ingest.streamKey, 'Stream key')}><Copy size={15} /></button></div></label><p>In OBS, open <strong>Settings → Stream → Service: Custom</strong>. Paste the server URL and stream key, click Apply, then Start Streaming.</p></div>}
            <div className="studio-broadcast-actions"><button type="button" className="studio-button studio-button-subtle" disabled={!providerReady || revealing || (!snapshot?.ingest?.available && !isPreparing && !isLive)} onClick={revealIngest}>{ingest ? <EyeOff size={15} /> : <LockKeyhole size={15} />}{revealing ? 'Opening…' : ingest ? 'Hide connection' : 'Show OBS connection'}</button>{(isLive || isPreparing) && <button type="button" className="studio-button studio-button-danger" disabled={!!streamAction} onClick={() => handleStream('end')}><Square size={14} />{streamAction === 'end' ? 'Ending…' : 'End stream'}</button>}</div><p className="studio-broadcast-footnote"><CircleHelp size={13} /> Preparing a stream does not transmit your camera. The local preview and OBS are separate.</p>
          </section>
          <section className="studio-schedule-card" id="schedule"><div className="studio-card-heading"><div><span className="studio-eyebrow">GIVE THEM A HEADS-UP</span><h2>Next on your channel</h2></div><CalendarDays size={19} /></div><p className="studio-section-intro">Put the next one on the calendar. Your audience will see it on the channel while you’re offline.</p><label className="studio-field"><span>Upcoming stream title</span><input name="nextTitle" value={form.nextTitle} onChange={updateField} maxLength={120} placeholder="Something worth coming back for" /></label><label className="studio-field"><span>Date & time</span><input type="datetime-local" name="nextDate" value={form.nextDate} onChange={updateField} min={localDateTime(new Date(now + 60000).toISOString())} /></label><div className="studio-timezone"><Clock3 size={13} /><span>Displayed in {timezone}</span></div><div className="studio-schedule-actions">{form.nextDate && <button type="button" className="studio-text-button" onClick={() => setForm((current) => ({ ...current, nextDate: '', nextTitle: '' }))}>Clear schedule</button>}<button type="button" className="studio-button studio-button-subtle" disabled={saving || !snapshot} onClick={saveSettings}><CalendarDays size={15} />{saving ? 'Saving…' : 'Save schedule'}</button></div><div className="studio-schedule-note"><span className="studio-schedule-note-icon"><Radio size={18} /></span><div><strong>Build a little anticipation.</strong><p>A consistent schedule gives your community a reason to return.</p></div></div></section></div>
        </>}
        <footer className="studio-dashboard-footer"><span><AudioLines size={14} /> SIGNAL STUDIO<span className="studio-footer-slash">/</span>Made for your next great thing.</span><a href="/">Back to the channel <ArrowRight size={14} /></a></footer>
      </main>
    </div><Toast message={toast} onClose={() => setToast(null)} />
  </div>;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { siteConfig } from '../config/site';
export const demoStream = { ...siteConfig.defaultStream, status: 'offline', mode: 'demo', provider: siteConfig.provider, playbackUrl: null, viewerCount: null, nextStream: null, startedAt: null };
export function useStream() {
  const [stream, setStream] = useState(demoStream);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  const active = useRef(true);
  const previous = useRef('offline');
  const refresh = useCallback(async () => {
    try {
      const data = await api('status');
      if (!active.current) return;
      try { if (data.status === 'live' && previous.current !== 'live' && localStorage.getItem('signal-reminders') === 'yes' && 'Notification' in window && Notification.permission === 'granted') new Notification(`${siteConfig.name} is live`, { body: data.title, icon: siteConfig.logo }); } catch { /* Mobile browsers may require a service-worker push subscription; status must still update. */ }
      previous.current = data.status;
      setStream({ ...demoStream, ...data }); setConnectionError(false);
    } catch { if (active.current) setConnectionError(true); }
    finally { if (active.current) setLoading(false); }
  }, []);
  useEffect(() => {
    active.current = true; refresh();
    const interval = setInterval(() => { if (!document.hidden) refresh(); }, 12000);
    const visible = () => { if (!document.hidden) refresh(); };
    window.addEventListener('online', refresh); document.addEventListener('visibilitychange', visible);
    return () => { active.current = false; clearInterval(interval); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  useEffect(() => {
    if (stream.mode !== 'configured') return;
    let viewerId = sessionStorage.getItem('signal-viewer');
    if (!viewerId) { viewerId = crypto.randomUUID(); sessionStorage.setItem('signal-viewer', viewerId); }
    const heartbeat = () => { if (!document.hidden) api('presence', { method: 'POST', body: JSON.stringify({ viewerId }) }).catch(() => {}); };
    heartbeat(); const interval = setInterval(heartbeat, 25000);
    return () => clearInterval(interval);
  }, [stream.mode]);
  return { stream, loading, connectionError, refresh };
}

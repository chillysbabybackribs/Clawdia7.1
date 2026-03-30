import React, { useState, useEffect } from 'react';

function useClock() {
  const [label, setLabel] = useState('');
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const day = now.toLocaleDateString('en-US', { weekday: 'short' });
      const month = now.toLocaleDateString('en-US', { month: 'short' });
      const date = now.getDate();
      const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      setLabel(`${day} ${month} ${date}  ${time}`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return label;
}

function useVpn(api: any) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api?.vpn?.status().then((s: boolean) => setConnected(s)).catch(() => setConnected(false));
    const id = setInterval(() => {
      api?.vpn?.status().then((s: boolean) => setConnected(s)).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [api]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await api?.vpn?.toggle();
      setConnected(next);
    } catch {
      // refresh actual state on error
      api?.vpn?.status().then((s: boolean) => setConnected(s)).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  return { connected, busy, toggle };
}

export default function AppChrome() {
  const api = (window as any).clawdia;
  const clock = useClock();
  const vpn = useVpn(api);

  return (
    <header
      className="drag-region flex h-[36px] flex-shrink-0 items-center px-3 relative"
      style={{
        background: '#09090c',
        borderBottom: '2px solid rgba(255,255,255,0.10)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.6), inset 0 -1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <div className="flex items-baseline gap-1.5" style={{ color: '#ffffff' }}>
        <span className="text-[11px] font-medium uppercase tracking-[0.16em]">Clawdia</span>
        <span className="text-[9.5px] font-medium uppercase tracking-[0.16em] opacity-70">Workspace</span>
      </div>

      <div className="flex-1" />

      <div
        className="absolute left-1/2 -translate-x-1/2 text-[10px] font-medium tracking-[0.10em] uppercase opacity-50 pointer-events-none select-none"
        style={{ color: '#e0e0e4' }}
      >
        {clock}
      </div>

      <div className="flex-1" />

      <div className="no-drag flex items-center gap-2 mr-2">
        <button
          onClick={vpn.toggle}
          disabled={vpn.busy}
          title={vpn.connected ? 'VPN connected — click to disconnect' : 'VPN disconnected — click to connect'}
          className="flex items-center gap-1.5 px-2 h-[22px] rounded text-[10px] font-medium uppercase tracking-[0.10em] transition-all"
          style={{
            background: vpn.connected ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${vpn.connected ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.12)'}`,
            color: vpn.connected ? '#4ade80' : 'rgba(255,255,255,0.35)',
            opacity: vpn.busy ? 0.5 : 1,
            cursor: vpn.busy ? 'wait' : 'pointer',
          }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8">
            <circle cx="4" cy="4" r="3.5"
              fill={vpn.connected ? '#4ade80' : 'transparent'}
              stroke={vpn.connected ? '#4ade80' : 'rgba(255,255,255,0.3)'}
              strokeWidth="1"
            />
          </svg>
          {vpn.busy ? '···' : (vpn.connected ? 'VPN' : 'VPN')}
        </button>
      </div>

      <div className="no-drag flex items-center gap-0.5">
        <button
          onClick={() => api?.window.minimize()}
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-secondary"
          title="Minimize"
        >
          <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="2" y1="5" x2="8" y2="5" />
          </svg>
        </button>
        <button
          onClick={() => api?.window.maximize()}
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-secondary"
          title="Maximize"
        >
          <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="6" height="6" />
          </svg>
        </button>
        <button
          onClick={() => api?.window.close()}
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-red-500/80 hover:text-white"
          title="Close"
        >
          <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="2" y1="2" x2="8" y2="8" />
            <line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        </button>
      </div>
    </header>
  );
}

import React, { useState, useEffect } from 'react';

interface AppChromeProps {
  showChatControls?: boolean;
  historyOpen?: boolean;
  terminalOpen?: boolean;
  settingsOpen?: boolean;
  filesOpen?: boolean;
  onToggleHistory?: () => void;
  onToggleTerminal?: () => void;
  onOpenSettings?: () => void;
  onToggleFiles?: () => void;
}

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

export default function AppChrome({
  showChatControls = false,
  historyOpen = false,
  terminalOpen = false,
  settingsOpen = false,
  filesOpen = false,
  onToggleHistory,
  onToggleTerminal,
  onOpenSettings,
  onToggleFiles,
}: AppChromeProps) {
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

      {showChatControls && (
        <div className="no-drag ml-4 flex items-center gap-3">
          <div className="h-4 w-px bg-white/[0.10]" aria-hidden />
          <button
            onClick={onToggleHistory}
            title={historyOpen ? 'Close history' : 'Chat history'}
            className={`flex items-center justify-center px-3 h-7 rounded-lg text-[11px] font-medium uppercase tracking-[0.12em] transition-all cursor-pointer ${
              historyOpen
                ? 'bg-white/[0.08] text-text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.06]'
            }`}
          >
            History
          </button>
          <button
            onClick={onToggleTerminal}
            title={terminalOpen ? 'Close terminal' : 'Open terminal'}
            className={`flex items-center justify-center px-3 h-7 rounded-lg text-[11px] font-medium uppercase tracking-[0.12em] transition-all cursor-pointer ${
              terminalOpen
                ? 'bg-white/[0.08] text-text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.06]'
            }`}
          >
            Terminal
          </button>
          <button
            onClick={onOpenSettings}
            title="Settings"
            className={`flex items-center justify-center px-3 h-7 rounded-lg text-[11px] font-medium uppercase tracking-[0.12em] transition-all cursor-pointer ${
              settingsOpen
                ? 'bg-white/[0.08] text-text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.06]'
            }`}
          >
            Settings
          </button>
          <button
            onClick={vpn.toggle}
            disabled={vpn.busy}
            title={vpn.connected ? 'VPN connected — click to disconnect' : 'VPN disconnected — click to connect'}
            className={`flex items-center justify-center px-3 h-7 rounded-lg text-[11px] font-medium uppercase tracking-[0.12em] transition-all ${
              vpn.connected
                ? 'text-status-success hover:bg-white/[0.06]'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.06]'
            }`}
          >
            VPN
          </button>
          <div className="h-4 w-px bg-white/[0.10]" aria-hidden />
          <button
            onClick={onToggleFiles}
            title={filesOpen ? 'Close files' : 'Open files'}
            className={`flex items-center justify-center px-3 h-7 rounded-lg text-[11px] font-medium uppercase tracking-[0.12em] transition-all cursor-pointer ${
              filesOpen
                ? 'bg-white/[0.08] text-text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.06]'
            }`}
          >
            Files
          </button>
        </div>
      )}

      <div className="flex-1" />

      <div
        className="absolute left-1/2 -translate-x-1/2 text-[10px] font-medium tracking-[0.10em] uppercase opacity-50 pointer-events-none select-none"
        style={{ color: '#e0e0e4' }}
      >
        {clock}
      </div>

      <div className="flex-1" />

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

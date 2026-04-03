import React, { useState, useEffect } from 'react';

interface AppChromeProps {}

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


export default function AppChrome({}: AppChromeProps) {
  const api = (window as any).clawdia;
  const clock = useClock();

  return (
    <header
      className="drag-region flex h-[22px] flex-shrink-0 items-center px-3 relative"
      style={{
        background: 'linear-gradient(180deg, #1c1c1c 0%, #171717 100%)',
        borderBottom: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 2px 14px rgba(0,0,0,0.9)',
      }}
    >
      <div className="flex items-baseline gap-1.5" style={{ color: '#ffffff' }}>
        <span className="text-[11px] font-medium uppercase tracking-[0.16em]">Clawdia</span>
        <span className="text-[9.5px] font-medium uppercase tracking-[0.16em] opacity-70">Workspace</span>
      </div>

      <div className="flex-1" />

      <div
        className="absolute left-1/2 -translate-x-1/2 text-[10px] font-medium tracking-[0.10em] uppercase opacity-50 pointer-events-none select-none"
        style={{ color: '#a0a0a0' }}
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

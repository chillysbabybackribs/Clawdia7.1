import React from 'react';

export default function AppChrome() {
  const api = (window as any).clawdia;

  return (
    <header
      className="drag-region flex h-[36px] flex-shrink-0 items-center px-3 relative"
      style={{
        background: '#09090c',
        borderBottom: '2px solid rgba(255,255,255,0.10)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.6), inset 0 -1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <div
        className="text-[11px] font-medium uppercase tracking-[0.16em]"
        style={{ color: '#e8d98a' }}
      >
        Clawdia Workspace
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

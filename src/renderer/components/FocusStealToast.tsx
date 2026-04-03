import React, { useEffect, useState, useCallback } from 'react';

interface FocusStealEntry {
  id: string;
  targetWindow: string;
}

const DISMISS_MS = 4000;

function SingleFocusStealToast({
  entry,
  onDismiss,
}: {
  entry: FocusStealEntry;
  onDismiss: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 10);
    const hide = setTimeout(() => onDismiss(entry.id), DISMISS_MS);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [entry.id, onDismiss]);

  return (
    <div
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(6px)',
        transition: 'opacity 0.18s ease, transform 0.18s ease',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 12px',
        borderRadius: 8,
        background: 'rgba(20,20,20,0.96)',
        border: '1px solid rgba(230,160,20,0.35)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.7)',
        maxWidth: 340,
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* amber dot */}
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: '#d4922a',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.4 }}>
        Agent taking focus:{' '}
        <span style={{ color: 'rgba(255,255,255,0.92)', fontWeight: 500 }}>
          {entry.targetWindow}
        </span>
      </span>
      <button
        onClick={() => onDismiss(entry.id)}
        style={{
          marginLeft: 'auto',
          padding: '2px 4px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'rgba(255,255,255,0.35)',
          lineHeight: 1,
        }}
        aria-label="Dismiss"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Listens for desktop:focus-steal-warning IPC events and renders a brief
 * amber toast in the bottom-left corner. Placed outside the main layout
 * so it always renders on top regardless of active view.
 */
export default function FocusStealToast() {
  const [entries, setEntries] = useState<FocusStealEntry[]>([]);

  const dismiss = useCallback((id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api?.desktop?.onFocusStealWarning) return;
    return api.desktop.onFocusStealWarning((payload: { targetWindow: string }) => {
      setEntries(prev => [
        ...prev,
        { id: `${Date.now()}-${Math.random()}`, targetWindow: payload.targetWindow },
      ]);
    });
  }, []);

  if (entries.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        left: 20,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'flex-start',
        pointerEvents: 'auto',
      }}
    >
      {entries.map(e => (
        <SingleFocusStealToast key={e.id} entry={e} onDismiss={dismiss} />
      ))}
    </div>
  );
}

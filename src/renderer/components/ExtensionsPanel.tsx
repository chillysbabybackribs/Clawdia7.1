import React, { useState, useEffect, useCallback, useRef } from 'react';

interface Extension {
  id: string;
  name: string;
  version: string;
  dirPath: string;
  description?: string;
  iconUrl?: string;
}

function ExtensionIcon({ ext }: { ext: Extension }) {
  const [imgFailed, setImgFailed] = useState(false);
  if (ext.iconUrl && !imgFailed) {
    return (
      <img
        src={ext.iconUrl}
        alt=""
        className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
        onError={() => setImgFailed(true)}
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0 text-white/30">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
        <line x1="16" y1="8" x2="2" y2="22" />
        <line x1="17.5" y1="15" x2="9" y2="15" />
      </svg>
    </div>
  );
}

interface ExtensionsPanelProps {
  /** Called when user clicks outside or presses Escape */
  onClose: () => void;
}

export default function ExtensionsPanel({ onClose }: ExtensionsPanelProps) {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const api = (window as any).clawdia?.browser?.extensions;

  const refresh = useCallback(async () => {
    if (!api) {
      setError('Extensions API not available');
      setLoading(false);
      return;
    }
    try {
      const list = await api.list();
      setExtensions(list ?? []);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Close on Escape or click outside
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    // Use capture so we catch the event before bubbling consumers
    document.addEventListener('mousedown', onClickOutside, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside, true);
    };
  }, [onClose]);

  const handleInstall = async () => {
    if (!api) return;
    setInstalling(true);
    setError(null);
    try {
      const result = await api.install();
      if (result) await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setInstalling(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!api) return;
    setRemovingId(id);
    setError(null);
    try {
      await api.remove(id);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    // Backdrop
    <div className="fixed inset-0 z-[200]" style={{ pointerEvents: 'none' }}>
      {/* Floating panel — anchored top-right under the chrome bar */}
      <div
        ref={panelRef}
        className="absolute right-3 top-[44px] w-[340px] rounded-xl border border-white/[0.10] shadow-[0_8px_32px_rgba(0,0,0,0.7),0_2px_8px_rgba(0,0,0,0.5)] overflow-hidden"
        style={{
          background: '#000000',
          pointerEvents: 'auto',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.07]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-white/50 flex-shrink-0">
            <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
            <line x1="16" y1="8" x2="2" y2="22" />
            <line x1="17.5" y1="15" x2="9" y2="15" />
          </svg>
          <span className="text-[12px] font-medium text-white/80 uppercase tracking-[0.10em]">Extensions</span>
          <div className="flex-1" />
          <button
            onClick={() => void handleInstall()}
            disabled={installing}
            className="flex items-center gap-1.5 px-2.5 h-6 rounded-md text-[11px] font-medium bg-white/[0.07] hover:bg-white/[0.11] text-white/60 hover:text-white/90 border border-white/[0.08] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {installing ? (
              <>
                <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Loading…
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Load unpacked
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded-md text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors cursor-pointer ml-1"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Extension list */}
        <div className="max-h-[360px] overflow-y-auto">
          {error && (
            <div className="mx-3 mt-3 text-[11px] text-red-400/80 bg-red-400/[0.08] border border-red-400/[0.15] rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-20 text-white/30 text-[12px]">
              Loading…
            </div>
          ) : extensions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
              <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-white/20">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
                  <line x1="16" y1="8" x2="2" y2="22" />
                  <line x1="17.5" y1="15" x2="9" y2="15" />
                </svg>
              </div>
              <div>
                <p className="text-[12px] text-white/40">No extensions loaded</p>
                <p className="text-[11px] text-white/25 mt-0.5">Click "Load unpacked" to add a Chrome extension folder</p>
              </div>
            </div>
          ) : (
            <div className="p-2 flex flex-col gap-1">
              {extensions.map((ext) => (
                <div
                  key={ext.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.09] transition-colors group"
                >
                  <ExtensionIcon ext={ext} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-white/75 truncate">{ext.name}</span>
                      <span className="text-[9px] text-white/25 bg-white/[0.05] px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                        {ext.version}
                      </span>
                    </div>
                    {ext.description && (
                      <p className="text-[11px] text-white/35 mt-0.5 line-clamp-1">{ext.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => void handleRemove(ext.id)}
                    disabled={removingId === ext.id}
                    className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-white/20 hover:text-red-400/70 hover:bg-red-400/[0.08] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed opacity-0 group-hover:opacity-100"
                    title="Remove"
                  >
                    {removingId === ext.id ? (
                      <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                    ) : (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-white/[0.05]">
          <p className="text-[10px] text-white/20">
            Unpacked MV2/MV3 only · persists across restarts
          </p>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';

interface Extension {
  id: string;
  name: string;
  version: string;
  dirPath: string;
  description?: string;
  iconUrl?: string;
}

interface ExtensionsPanelProps {
  onBack: () => void;
}

function ExtensionIcon({ ext }: { ext: Extension }) {
  const [imgFailed, setImgFailed] = useState(false);
  if (ext.iconUrl && !imgFailed) {
    return (
      <img
        src={ext.iconUrl}
        alt=""
        className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
        onError={() => setImgFailed(true)}
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0 text-text-tertiary">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
        <line x1="16" y1="8" x2="2" y2="22" />
        <line x1="17.5" y1="15" x2="9" y2="15" />
      </svg>
    </div>
  );
}

export default function ExtensionsPanel({ onBack }: ExtensionsPanelProps) {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const api = (window as any).clawdia?.browser?.extensions;

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const list = await api.list();
      setExtensions(list ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
    <div className="flex flex-col h-full bg-surface-0">
      {/* Header */}
      <header className="drag-region flex items-center gap-3 px-4 h-[44px] flex-shrink-0 border-b border-border-subtle">
        <button
          onClick={onBack}
          className="no-drag flex items-center justify-center w-7 h-7 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-white/[0.04] transition-colors cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <span className="text-sm font-medium text-text-primary">Extensions</span>
        <div className="flex-1" />
        <button
          onClick={handleInstall}
          disabled={installing}
          className="no-drag flex items-center gap-1.5 px-3 h-7 rounded-lg text-xs font-medium bg-white/[0.06] hover:bg-white/[0.09] text-text-secondary hover:text-text-primary border border-white/[0.08] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {installing ? (
            <>
              <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Installing…
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Load unpacked
            </>
          )}
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {error && (
          <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-24 text-text-tertiary text-sm">
            Loading…
          </div>
        ) : extensions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 h-40 text-center">
            <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-text-tertiary">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
                <line x1="16" y1="8" x2="2" y2="22" />
                <line x1="17.5" y1="15" x2="9" y2="15" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-text-secondary">No extensions installed</p>
              <p className="text-xs text-text-tertiary mt-0.5">Load an unpacked Chrome extension folder</p>
            </div>
          </div>
        ) : (
          extensions.map((ext) => (
            <div
              key={ext.id}
              className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.10] transition-colors"
            >
              <ExtensionIcon ext={ext} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary truncate">{ext.name}</span>
                  <span className="text-[10px] text-text-tertiary bg-white/[0.06] px-1.5 py-0.5 rounded-md flex-shrink-0">
                    v{ext.version}
                  </span>
                </div>
                {ext.description && (
                  <p className="text-xs text-text-tertiary mt-0.5 line-clamp-2">{ext.description}</p>
                )}
                <p className="text-[10px] text-text-tertiary/60 mt-1 truncate font-mono">{ext.dirPath}</p>
              </div>
              <button
                onClick={() => handleRemove(ext.id)}
                disabled={removingId === ext.id}
                className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg text-text-tertiary hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title="Remove extension"
              >
                {removingId === ext.id ? (
                  <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                )}
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer note */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-border-subtle">
        <p className="text-[11px] text-text-tertiary">
          Supports unpacked Chrome extensions (MV2/MV3). Extensions are loaded into the browser session and persist across restarts.
        </p>
      </div>
    </div>
  );
}

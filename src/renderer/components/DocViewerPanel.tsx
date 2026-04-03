import React, { useState, useRef, useCallback, useEffect } from 'react';

interface DocViewerPanelProps {
  visible: boolean;
}

type DocEntry = {
  id: string;
  name: string;
  url: string;
};

const PLACEHOLDER_BG = '#0a0a0a';

export default function DocViewerPanel({ visible }: DocViewerPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [urlInput, setUrlInput] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [bookmarks, setBookmarks] = useState<DocEntry[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);

  const navigate = useCallback((url: string) => {
    let target = url.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) {
      target = 'https://' + target;
    }
    setCurrentUrl(target);
    setUrlInput(target);
    setIsLoading(true);
    setShowBookmarks(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') navigate(urlInput);
    },
    [urlInput, navigate],
  );

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  const addBookmark = useCallback(() => {
    if (!currentUrl) return;
    setBookmarks((prev) => {
      if (prev.some((b) => b.url === currentUrl)) return prev;
      const name = currentUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return [
        ...prev,
        { id: `bm-${Date.now()}`, name, url: currentUrl },
      ];
    });
  }, [currentUrl]);

  const removeBookmark = useCallback((id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // Focus URL bar when panel becomes visible
  const urlInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (visible) {
      setTimeout(() => urlInputRef.current?.focus(), 80);
    }
  }, [visible]);

  return (
    <div className="flex h-full min-w-0 flex-col" style={{ background: PLACEHOLDER_BG }}>
      {/* Toolbar */}
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/[0.07] flex-shrink-0"
        style={{ background: '#111111' }}
      >
        {/* Back / Forward / Reload */}
        <button
          title="Back"
          onClick={() => iframeRef.current?.contentWindow?.history.back()}
          className="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-secondary hover:bg-white/[0.06] transition-all cursor-pointer flex-shrink-0"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          title="Forward"
          onClick={() => iframeRef.current?.contentWindow?.history.forward()}
          className="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-secondary hover:bg-white/[0.06] transition-all cursor-pointer flex-shrink-0"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button
          title="Reload"
          onClick={() => {
            if (currentUrl) {
              setIsLoading(true);
              if (iframeRef.current) iframeRef.current.src = currentUrl;
            }
          }}
          className="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-secondary hover:bg-white/[0.06] transition-all cursor-pointer flex-shrink-0"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>

        {/* URL bar */}
        <div className="relative flex-1 min-w-0">
          <input
            ref={urlInputRef}
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL or search..."
            className="w-full rounded-md px-2.5 py-1 text-[11px] text-text-primary placeholder:text-text-muted outline-none transition-all"
            style={{
              background: '#1a1a1a',
              border: '1px solid rgba(255,255,255,0.09)',
              fontFamily: 'inherit',
            }}
            spellCheck={false}
          />
          {isLoading && (
            <div
              className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white/20 border-t-white/60 animate-spin"
            />
          )}
        </div>

        {/* Bookmark toggle */}
        <button
          title="Add bookmark"
          onClick={addBookmark}
          disabled={!currentUrl}
          className="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-secondary hover:bg-white/[0.06] transition-all cursor-pointer flex-shrink-0 disabled:opacity-30"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
        <button
          title="Bookmarks"
          onClick={() => setShowBookmarks((v) => !v)}
          className={`flex items-center justify-center w-6 h-6 rounded transition-all cursor-pointer flex-shrink-0 ${
            showBookmarks ? 'text-text-primary bg-white/[0.08]' : 'text-text-muted hover:text-text-secondary hover:bg-white/[0.06]'
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </button>
      </div>

      {/* Bookmarks tray */}
      {showBookmarks && (
        <div
          className="flex-shrink-0 border-b border-white/[0.07] overflow-y-auto"
          style={{ maxHeight: 180, background: '#0d0d0d' }}
        >
          {bookmarks.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-text-muted">No bookmarks yet. Navigate to a page and click the bookmark icon.</p>
          ) : (
            <ul>
              {bookmarks.map((bm) => (
                <li
                  key={bm.id}
                  className="flex items-center gap-2 px-3 py-1.5 group hover:bg-white/[0.04] cursor-pointer"
                  onClick={() => navigate(bm.url)}
                >
                  <span className="flex-1 text-[11px] text-text-secondary truncate">{bm.name}</span>
                  <button
                    title="Remove bookmark"
                    onClick={(e) => { e.stopPropagation(); removeBookmark(bm.id); }}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Content area */}
      <div className="relative flex-1 min-h-0">
        {!currentUrl ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <p className="text-[11px] text-text-muted text-center leading-relaxed">
              Enter a URL above to load docs, MDN, GitHub, or any web page.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-1">
              {[
                { label: 'MDN', url: 'https://developer.mozilla.org' },
                { label: 'Node.js', url: 'https://nodejs.org/docs/latest/api/' },
                { label: 'React', url: 'https://react.dev' },
                { label: 'caniuse', url: 'https://caniuse.com' },
              ].map((q) => (
                <button
                  key={q.label}
                  onClick={() => navigate(q.url)}
                  className="px-2.5 py-1 rounded-md text-[10px] font-medium text-text-muted hover:text-text-secondary hover:bg-white/[0.06] border border-white/[0.07] transition-all cursor-pointer"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={currentUrl}
            onLoad={handleIframeLoad}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            title="Document viewer"
          />
        )}
      </div>
    </div>
  );
}

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { BrowserExecutionMode } from '../../shared/types';
import ExtensionsPanel from './ExtensionsPanel';

interface TabInfo {
  id: string;
  url: string;
  title: string;
  isLoading: boolean;
  isActive: boolean;
  faviconUrl?: string;
  isNewTab: boolean;
}

/** Strip protocol + www for clean URL bar display */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '');
}

function resolveUrl(raw: string): string {
  const s = raw.trim();
  if (/^https?:\/\//i.test(s) || /^file:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) {
    return 'http://' + s;
  }
  if (/\s/.test(s)) return 'https://www.google.com/search?q=' + encodeURIComponent(s);
  if (s.includes('.')) return 'https://' + s;
  return 'https://' + s + '.com';
}

function TabIcon({ tab }: { tab: TabInfo }) {
  if (tab.faviconUrl) {
    return (
      <>
        <img
          src={tab.faviconUrl}
          alt=""
          className="w-4 h-4 rounded-[4px] object-cover flex-shrink-0"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
            const next = e.currentTarget.nextElementSibling as HTMLElement | null;
            if (next) next.style.display = 'flex';
          }}
        />
        <div className="hidden">
          <TabIconFallback />
        </div>
      </>
    );
  }

  return <TabIconFallback />;
}

function TabIconFallback() {
  return (
    <div className="w-4 h-4 rounded-[4px] border border-white/[0.10] bg-white/[0.04] text-text-secondary/80 flex items-center justify-center flex-shrink-0">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    </div>
  );
}

export default function BrowserPanel() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [ghostText, setGhostText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [executionMode, setExecutionMode] = useState<BrowserExecutionMode>('headed');
  const [showExtensions, setShowExtensions] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const matchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUrlRef = useRef<string | null>(null);

  const activeTab = tabs.find(t => t.isActive);
  const isNewTab = activeTab?.isNewTab ?? false;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const updateBounds = () => {
      const rect = el.getBoundingClientRect();
      (window as any).clawdia?.browser.setBounds({
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height),
      });
    };
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(el);
    window.addEventListener('resize', updateBounds);
    return () => { observer.disconnect(); window.removeEventListener('resize', updateBounds); };
  }, []);

  useEffect(() => {
    const api = (window as any).clawdia?.browser;
    if (!api) return;
    // listTabs() guarantees at least one tab exists (creates one if needed),
    // so no separate newTab() fallback is required here.
    api.listTabs().then((list: TabInfo[]) => {
      if (list?.length) setTabs(list);
    }).catch(() => {});
    api.getExecutionMode?.().then((mode: BrowserExecutionMode) => {
      if (mode) setExecutionMode(mode);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const api = (window as any).clawdia?.browser;
    if (!api) return;
    const cleanups: (() => void)[] = [];
    cleanups.push(api.onUrlChanged((url: string) => {
      pendingUrlRef.current = null;
      if (!isFocused) setUrlInput(displayUrl(url));
    }));
    cleanups.push(api.onLoading((loading: boolean) => setIsLoading(loading)));
    cleanups.push(api.onTabsChanged((newTabs: TabInfo[]) => {
      setTabs(prev => {
        const prevActiveId = prev.find(t => t.isActive)?.id;
        const nextActive = newTabs.find(t => t.isActive);
        if (nextActive && nextActive.id !== prevActiveId) {
          // Tab switched — clear pending URL so the new tab's URL bar is accurate
          pendingUrlRef.current = null;
        }
        return newTabs;
      });
      const active = newTabs.find(t => t.isActive);
      if (active) {
        if (!isFocused && !pendingUrlRef.current) {
          setUrlInput(active.isNewTab ? '' : displayUrl(active.url));
        }
        setIsLoading(active.isLoading);
      }
    }));
    if (api.onModeChanged) {
      cleanups.push(api.onModeChanged((payload: { mode: BrowserExecutionMode }) => {
        setExecutionMode(payload.mode);
      }));
    }
    return () => cleanups.forEach(fn => fn());
  }, [isFocused]);

  // Auto-focus URL bar when a new tab becomes active
  useEffect(() => {
    if (isNewTab) {
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [isNewTab, activeTab?.id]);

  // URL autocomplete
  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setUrlInput(val);

    if (!val.trim() || val.length < 2) {
      setGhostText('');
      return;
    }

    if (matchTimerRef.current) clearTimeout(matchTimerRef.current);
    matchTimerRef.current = setTimeout(async () => {
      try {
        const match = await (window as any).clawdia?.browser.matchHistory(val);
        if (match) {
          const cleanMatch = displayUrl(match);
          if (cleanMatch.toLowerCase().startsWith(val.toLowerCase())) {
            setGhostText(cleanMatch);
          } else {
            setGhostText('');
          }
        } else {
          setGhostText('');
        }
      } catch {
        setGhostText('');
      }
    }, 30);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Tab' || e.key === 'ArrowRight') && ghostText) {
      const input = inputRef.current;
      if (input && input.selectionStart === urlInput.length) {
        e.preventDefault();
        setUrlInput(ghostText);
        setGhostText('');
      }
    }
  }, [ghostText, urlInput]);

  const handleNavigate = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    let url = ghostText && ghostText.toLowerCase().startsWith(urlInput.toLowerCase())
      ? ghostText
      : urlInput.trim();
    if (!url) return;

    url = resolveUrl(url);

    setGhostText('');
    const displayedUrl = displayUrl(url);
    setUrlInput(displayedUrl);
    pendingUrlRef.current = displayedUrl;
    (window as any).clawdia?.browser.navigate(url);
    inputRef.current?.blur();
  }, [urlInput, ghostText]);

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    e.target.select();
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    setGhostText('');
  }, []);

  const handleBack = useCallback(() => (window as any).clawdia?.browser.back(), []);
  const handleForward = useCallback(() => (window as any).clawdia?.browser.forward(), []);
  const handleRefresh = useCallback(() => (window as any).clawdia?.browser.refresh(), []);
  const handleNewTab = useCallback(() => (window as any).clawdia?.browser.newTab(), []);
  const handleSwitchTab = useCallback((id: string) => (window as any).clawdia?.browser.switchTab(id), []);
  const handleCloseTab = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    (window as any).clawdia?.browser.closeTab(id);
  }, []);

  const ghostSuffix = ghostText && isFocused && ghostText.toLowerCase().startsWith(urlInput.toLowerCase())
    ? ghostText.slice(urlInput.length)
    : '';
  const modeLabel = executionMode === 'headless'
    ? 'Headless'
    : executionMode === 'persistent_session'
      ? 'Session-bound'
      : 'Visible';

  return (
    <div className="relative flex flex-col h-full bg-surface-0">
      <div className="drag-region flex items-center h-[46px] bg-surface-1 border-b border-border-subtle px-2 gap-1 flex-shrink-0 overflow-hidden">
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar">
          {tabs.map(tab => (
            <div
              key={tab.id}
              onClick={() => handleSwitchTab(tab.id)}
              className={`no-drag group flex items-center gap-2 my-[8px] h-[30px] px-[14px] rounded-lg cursor-pointer transition-all duration-100 max-w-[210px] min-w-[120px] flex-shrink-0 text-[13px] border-[1.5px] ${tab.isActive ? 'text-text-primary border-white/[0.12] bg-white/[0.04] shadow-[inset_0_1px_4px_rgba(0,0,0,0.2)]' : 'text-text-tertiary border-white/[0.05] hover:border-white/[0.09] hover:text-text-secondary'}`}
            >
              <TabIcon tab={tab} />
              <span className="text-[12px] font-medium truncate flex-1 min-w-0">{tab.title || 'New Tab'}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="flex-shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded-md opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-white/[0.1] transition-all cursor-pointer"
                >
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <line x1="2" y1="2" x2="8" y2="8" />
                    <line x1="8" y1="2" x2="2" y2="8" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
        <button onClick={handleNewTab} className="no-drag flex items-center justify-center h-full px-[10px] text-text-muted hover:text-text-secondary hover:bg-white/[0.04] transition-colors cursor-pointer flex-shrink-0" title="New tab">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <div className="flex-1 drag-region" />
      </div>

      <div className="flex items-center gap-1.5 px-2 h-[40px] bg-surface-1 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center gap-0.5">
          <button onClick={handleBack} className="flex items-center justify-center w-7 h-7 rounded-lg text-text-muted hover:text-text-secondary hover:bg-white/[0.04] transition-colors cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button onClick={handleForward} className="flex items-center justify-center w-7 h-7 rounded-lg text-text-muted hover:text-text-secondary hover:bg-white/[0.04] transition-colors cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button onClick={handleRefresh} className="flex items-center justify-center w-7 h-7 rounded-lg text-text-muted hover:text-text-secondary hover:bg-white/[0.04] transition-colors cursor-pointer">
            {isLoading ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            )}
          </button>
        </div>

        <form onSubmit={handleNavigate} className="flex-1">
          <div className="relative">
            {isLoading && (
              <div className="absolute bottom-0 left-0 h-[2px] bg-accent/60 rounded-full animate-pulse-soft" style={{ width: '60%' }} />
            )}

            {ghostSuffix && (
              <div className="absolute inset-0 flex items-center px-3 pointer-events-none font-mono text-xs">
                <span className="invisible whitespace-pre">{urlInput}</span>
                <span className="text-text-tertiary whitespace-pre">{ghostSuffix}</span>
              </div>
            )}

            <input
              ref={inputRef}
              type="text"
              value={urlInput}
              onChange={handleUrlChange}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              onBlur={handleBlur}
              className={`w-full h-[30px] bg-surface-0/60 text-text-secondary text-xs px-3 rounded-lg border border-transparent hover:border-border focus:border-accent/30 focus:text-text-primary outline-none transition-all font-mono${isNewTab ? ' shadow-[0_0_0_2px_rgba(99,179,237,0.4)]' : ''}`}
              placeholder="Enter URL or search..."
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </form>

        {ghostSuffix && isFocused && (
          <div className="flex items-center gap-1 flex-shrink-0 pr-1">
            <kbd className="text-[9px] text-text-muted/50 bg-white/[0.05] px-1.5 py-0.5 rounded border border-white/[0.08] font-mono">Tab</kbd>
          </div>
        )}

        <div className="flex-shrink-0 pr-1 flex items-center gap-1.5">
          <span className="inline-flex items-center h-[22px] px-2 rounded-md border border-white/[0.08] bg-white/[0.04] text-[10px] uppercase tracking-[0.12em] text-text-secondary/80">
            {modeLabel}
          </span>
          <button
            onClick={() => setShowExtensions(true)}
            title="Extensions"
            className="flex items-center justify-center w-7 h-7 rounded-lg text-text-muted hover:text-text-secondary hover:bg-white/[0.04] transition-colors cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
              <line x1="16" y1="8" x2="2" y2="22" />
              <line x1="17.5" y1="15" x2="9" y2="15" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={viewportRef} className="relative flex-1 bg-surface-0">
        {!activeTab && executionMode !== 'headless' && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-0 text-text-secondary/70">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="text-[11px] uppercase tracking-[0.18em] text-text-secondary/50">Browser</div>
              <div className="text-[13px] text-text-secondary">Open a tab or enter a URL to start browsing.</div>
            </div>
          </div>
        )}
        {executionMode === 'headless' && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-0 text-text-secondary/70 pointer-events-none">
            <div className="flex flex-col items-center gap-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-text-secondary/50">Headless Browser</div>
              <div className="text-[13px] text-text-secondary">This run detached and the browser is now running in the background.</div>
            </div>
          </div>
        )}
        {isNewTab && executionMode !== 'headless' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
            <span className="text-[22px] font-semibold tracking-[0.3em] uppercase text-text-primary/[0.15]">
              CLAWDIA BROWSER
            </span>
          </div>
        )}
      </div>

      {/* Extensions overlay */}
      {showExtensions && (
        <div className="absolute inset-0 z-50 bg-surface-0">
          <ExtensionsPanel onBack={() => setShowExtensions(false)} />
        </div>
      )}
    </div>
  );
}

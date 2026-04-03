import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { BrowserExecutionMode } from '../../shared/types';

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

/* ── Chrome tab SVG geometry ──
   Based on adamschwartz/chrome-tabs.
   The path draws the rounded top + inverse-curved bottom corners. */
const BTAB_LEFT_ID = 'browser-tab-left';
const BTAB_RIGHT_ID = 'browser-tab-right';

function BrowserTabSvgDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        <symbol id={BTAB_LEFT_ID} viewBox="0 0 214 36">
          <path d="M17 0h197v36H0v-2c4.5 0 9-3.5 9-8V8c0-4.5 3.5-8 8-8z" />
        </symbol>
        <symbol id={BTAB_RIGHT_ID} viewBox="0 0 214 36">
          <use xlinkHref={`#${BTAB_LEFT_ID}`} />
        </symbol>
      </defs>
    </svg>
  );
}

function BrowserTabBg({ active, hovered }: { active: boolean; hovered: boolean }) {
  const fill = active
    ? '#1a1a1a'
    : hovered
      ? '#141414'
      : '#0c0c0c';
  const stroke = active
    ? 'rgba(255,255,255,0.16)'
    : hovered
      ? 'rgba(255,255,255,0.10)'
      : 'rgba(255,255,255,0.12)';

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
      <svg width="52%" height="100%">
        <use xlinkHref={`#${BTAB_LEFT_ID}`} width="214" height="36" fill={fill} stroke={stroke} strokeWidth="0.8" />
      </svg>
      <g transform="scale(-1, 1)">
        <svg width="52%" height="100%" x="-100%" y="0">
          <use xlinkHref={`#${BTAB_RIGHT_ID}`} width="214" height="36" fill={fill} stroke={stroke} strokeWidth="0.8" />
        </svg>
      </g>
    </svg>
  );
}

export default function BrowserPanel({ reservedRight = 0, hideNativeView = false }: { reservedRight?: number; hideNativeView?: boolean }) {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [ghostText, setGhostText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [executionMode, setExecutionMode] = useState<BrowserExecutionMode>('headed');
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
      if (hideNativeView) {
        // Collapse native BrowserView so it doesn't sit on top of overlays
        (window as any).clawdia?.browser.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        return;
      }
      const rect = el.getBoundingClientRect();
      (window as any).clawdia?.browser.setBounds({
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.max(0, Math.round(rect.width) - reservedRight),
        height: Math.round(rect.height),
      });
    };
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(el);
    window.addEventListener('resize', updateBounds);
    return () => { observer.disconnect(); window.removeEventListener('resize', updateBounds); };
  }, [reservedRight, hideNativeView]);

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

  const [btabHoveredId, setBtabHoveredId] = useState<string | null>(null);

  return (
    <div className="relative flex flex-col h-full bg-surface-0">
      <BrowserTabSvgDefs />
      {/* Chrome-style browser tab strip */}
      <div
        className="drag-region flex items-end px-1 pt-[6px] flex-shrink-0 overflow-hidden"
        style={{ background: '#101010', height: 42, position: 'relative' }}
      >
        <div className="flex items-end min-w-0 overflow-x-auto no-scrollbar">
          {tabs.map((tab, index) => {
            const isHovered = btabHoveredId === tab.id;
            return (
              <div
                key={tab.id}
                onClick={() => handleSwitchTab(tab.id)}
                onMouseEnter={() => { if (!tab.isActive) setBtabHoveredId(tab.id); }}
                onMouseLeave={() => setBtabHoveredId(null)}
                className="no-drag relative flex items-center select-none min-w-[100px] max-w-[210px] flex-shrink-0 group cursor-pointer"
                style={{
                  height: 36,
                  marginLeft: index === 0 ? 4 : -8,
                  zIndex: tab.isActive ? 3 : 1,
                }}
              >
                <BrowserTabBg active={tab.isActive} hovered={isHovered} />
                <div
                  className="relative flex items-center gap-2 w-full h-full pointer-events-auto"
                  style={{
                    padding: '0 16px',
                    color: tab.isActive ? '#f0f0f0' : isHovered ? 'rgba(255,255,255,0.70)' : 'rgba(255,255,255,0.40)',
                    transition: 'color 0.15s',
                  }}
                >
                  <TabIcon tab={tab} />
                  <span
                    className="text-[12px] font-medium truncate flex-1 min-w-0"
                    style={{
                      maskImage: 'linear-gradient(90deg, #000 0%, #000 calc(100% - 20px), transparent)',
                      WebkitMaskImage: 'linear-gradient(90deg, #000 0%, #000 calc(100% - 20px), transparent)',
                    }}
                  >
                    {tab.title || 'New Tab'}
                  </span>
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => handleCloseTab(tab.id, e)}
                      className="flex-shrink-0 flex items-center justify-center w-[16px] h-[16px] rounded-full transition-all cursor-pointer hover:bg-white/[0.10]"
                      style={{
                        color: tab.isActive || isHovered ? 'rgba(255,255,255,0.4)' : 'transparent',
                      }}
                    >
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <line x1="2" y1="2" x2="8" y2="8" />
                        <line x1="8" y1="2" x2="2" y2="8" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <button
          onClick={handleNewTab}
          className="no-drag flex items-center justify-center w-[28px] h-[28px] mb-[2px] ml-1 rounded-full text-text-muted hover:text-text-primary hover:bg-white/[0.06] transition-all cursor-pointer flex-shrink-0"
          title="New tab"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <div className="flex-1 drag-region" />
        {/* Bottom line */}
        <div className="absolute bottom-0 left-0 right-0 h-[1px]" style={{ background: 'rgba(255,255,255,0.08)' }} />
      </div>

      <div className="flex items-center gap-1.5 px-2 h-[40px] bg-[#111111] border-b border-border-subtle flex-shrink-0">
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
              className={`w-full h-[30px] bg-[#1a1a1a] text-text-secondary text-xs px-3 rounded-lg border border-white/[0.06] hover:border-white/[0.12] focus:border-white/[0.20] focus:text-text-primary outline-none transition-all font-mono${isNewTab ? ' shadow-[0_0_0_2px_rgba(255,255,255,0.08)]' : ''}`}
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

    </div>
  );
}

import React, { useCallback, useEffect, useRef, useState } from 'react';

interface FsEntry {
  name: string;
  type: 'file' | 'dir';
  path: string;
}

interface RightFilesDrawerProps {
  open: boolean;
  onClose: () => void;
  conversationId?: string | null;
}

// ── Sorting ───────────────────────────────────────────────────────────────────

function sortEntries(items: FsEntry[]): FsEntry[] {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function FileTreeChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      className={`flex-shrink-0 text-[#4b5563] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 2L7 5L3.5 8" />
    </svg>
  );
}

function FolderGlyph({ open }: { open: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" className="flex-shrink-0" aria-hidden="true">
      <path
        d="M1.75 3.25h4.1l1.2 1.5h7.2v1.1H1.75z"
        fill={open ? '#fbbf24' : '#f59e0b'}
        opacity={open ? 0.95 : 0.82}
      />
      <path
        d="M1.5 5.35C1.5 4.95 1.82 4.63 2.22 4.63h11.56c.4 0 .72.32.72.72v6.2c0 .66-.54 1.2-1.2 1.2H2.7c-.66 0-1.2-.54-1.2-1.2z"
        fill={open ? '#fcd34d' : '#fbbf24'}
      />
      <path
        d="M1.5 5.45h13"
        stroke={open ? '#fde68a' : '#fcd34d'}
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FileBase({ accent, detail }: { accent: string; detail?: React.ReactNode }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.25 1.75h5.2l3.05 3.05v8.45a1 1 0 0 1-1 1H3.25a1 1 0 0 1-1-1v-10.5a1 1 0 0 1 1-1z" fill="#0d1117" />
      <path d="M8.45 1.75V4.8h3.05" fill={accent} fillOpacity="0.9" />
      <path d="M8.45 1.75V4.8h3.05" stroke={accent} strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M3.25 1.75h5.2l3.05 3.05v8.45a1 1 0 0 1-1 1H3.25a1 1 0 0 1-1-1v-10.5a1 1 0 0 1 1-1z" stroke="#374151" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M4.2 11.85h5.85" stroke={accent} strokeWidth="1" strokeLinecap="round" />
      <path d="M4.2 9.9h5.85" stroke="#4b5563" strokeWidth="0.8" strokeLinecap="round" />
      {detail}
    </svg>
  );
}

function fileTypeIcon(ext: string): React.ReactNode {
  switch (ext) {
    case 'ts':
    case 'tsx':
      return <FileBase accent="#38bdf8" detail={<text x="4.15" y="8.1" fontSize="3.2" fontWeight="700" fill="#38bdf8">TS</text>} />;
    case 'js':
    case 'jsx':
      return <FileBase accent="#facc15" detail={<text x="4.15" y="8.1" fontSize="3.2" fontWeight="700" fill="#facc15">JS</text>} />;
    case 'json':
      return <FileBase accent="#34d399" detail={<text x="4.15" y="8.1" fontSize="3.2" fontWeight="700" fill="#34d399">{'{ }'}</text>} />;
    case 'md':
    case 'markdown':
      return (
        <FileBase
          accent="#a78bfa"
          detail={<path d="M4.1 7.2h1.25l.9 1.15.9-1.15h1.25v2.5H7.5V8.35L6.3 9.82 5.1 8.35V9.7H4.1z" fill="#c4b5fd" />}
        />
      );
    case 'py':
      return (
        <FileBase
          accent="#60a5fa"
          detail={
            <>
              <path d="M4.45 7.15a1.05 1.05 0 0 1 1.05-1.05h1.55a.7.7 0 0 1 .7.7v.7a.7.7 0 0 1-.7.7H5.4a.95.95 0 0 0-.95.95v.2H6.8a1.05 1.05 0 0 1 1.05 1.05" stroke="#93c5fd" strokeWidth="0.8" strokeLinecap="round" />
              <circle cx="6.55" cy="6.8" r="0.4" fill="#93c5fd" />
              <circle cx="5.55" cy="10.1" r="0.4" fill="#93c5fd" />
            </>
          }
        />
      );
    case 'sh':
    case 'bash':
    case 'zsh':
      return (
        <FileBase
          accent="#84cc16"
          detail={
            <>
              <path d="M4.25 7.15 5.6 8.2 4.25 9.25" stroke="#bef264" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6.35 9.3h2.05" stroke="#bef264" strokeWidth="0.9" strokeLinecap="round" />
            </>
          }
        />
      );
    case 'css':
    case 'scss':
    case 'sass':
      return <FileBase accent="#22d3ee" detail={<text x="3.75" y="8.1" fontSize="3.1" fontWeight="700" fill="#67e8f9">CSS</text>} />;
    case 'html':
    case 'htm':
      return (
        <FileBase
          accent="#fb923c"
          detail={
            <path d="M4.2 8.05 5.3 7.1M4.2 8.05 5.3 9M7.9 7.05 6.95 9.1M9.55 8.05 8.45 7.1M9.55 8.05 8.45 9" stroke="#fdba74" strokeWidth="0.85" strokeLinecap="round" strokeLinejoin="round" />
          }
        />
      );
    case 'pdf':
      return <FileBase accent="#f87171" detail={<text x="3.95" y="8.1" fontSize="3.1" fontWeight="700" fill="#fca5a5">PDF</text>} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return (
        <FileBase
          accent="#f472b6"
          detail={
            <>
              <circle cx="5.15" cy="7.05" r="0.75" fill="#f9a8d4" />
              <path d="M4.2 10.05 5.7 8.65l1.2 1.05 1.35-1.55 1.55 1.9" stroke="#f9a8d4" strokeWidth="0.85" strokeLinecap="round" strokeLinejoin="round" />
            </>
          }
        />
      );
    case 'csv':
      return (
        <FileBase
          accent="#6ee7b7"
          detail={
            <>
              <path d="M4.2 7.4h6M4.2 8.8h6M6.2 6.4v4" stroke="#6ee7b7" strokeWidth="0.75" strokeLinecap="round" />
            </>
          }
        />
      );
    case 'zip':
    case 'tar':
    case 'gz':
      return (
        <FileBase
          accent="#a8a29e"
          detail={
            <>
              <path d="M6.4 6.2v3.25" stroke="#d6d3d1" strokeWidth="0.85" strokeLinecap="round" />
              <path d="M5.6 6.65h1.6M5.6 7.6h1.6M5.6 8.55h1.6" stroke="#d6d3d1" strokeWidth="0.8" strokeLinecap="round" />
            </>
          }
        />
      );
    default:
      return (
        <FileBase
          accent="#6b7280"
          detail={<path d="M4.35 7.15h4.55M4.35 8.2h4.55" stroke="#9ca3af" strokeWidth="0.85" strokeLinecap="round" />}
        />
      );
  }
}

function FileGlyph({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return (
    <span className="inline-flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center" aria-hidden="true">
      {fileTypeIcon(ext)}
    </span>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-4 pb-1 pt-3">
      <span
        className="text-[9px] font-semibold uppercase tracking-[0.10em]"
        style={{ color: '#4b5563' }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Tree node ─────────────────────────────────────────────────────────────────

interface TreeNodeProps {
  entry: FsEntry;
  depth: number;
  expandedPaths: Record<string, boolean>;
  childrenByPath: Record<string, FsEntry[]>;
  loadingPaths: Record<string, boolean>;
  selectedPath: string | null;
  onToggleDir: (entry: FsEntry) => void;
  onClickFile: (entry: FsEntry) => void;
}

function TreeNode({
  entry,
  depth,
  expandedPaths,
  childrenByPath,
  loadingPaths,
  selectedPath,
  onToggleDir,
  onClickFile,
}: TreeNodeProps) {
  const isDir = entry.type === 'dir';
  const isExpanded = !!expandedPaths[entry.path];
  const isLoading = !!loadingPaths[entry.path];
  const isSelected = selectedPath === entry.path;
  const children = childrenByPath[entry.path] || [];
  const indent = 12 + depth * 16;

  return (
    <>
      <button
        type="button"
        onClick={() => isDir ? onToggleDir(entry) : onClickFile(entry)}
        className="group flex w-full items-center gap-1.5 rounded-none py-[5px] pr-3 text-left transition-colors"
        style={{
          paddingLeft: `${indent}px`,
          background: isSelected
            ? 'rgba(99,102,241,0.12)'
            : undefined,
          borderLeft: isSelected ? '2px solid rgba(99,102,241,0.6)' : '2px solid transparent',
        }}
        onMouseEnter={(e) => {
          if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)';
        }}
        onMouseLeave={(e) => {
          if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = '';
        }}
      >
        <span className="flex w-[10px] flex-shrink-0 items-center justify-center">
          {isDir ? <FileTreeChevron expanded={isExpanded} /> : null}
        </span>
        {isDir ? <FolderGlyph open={isExpanded} /> : <FileGlyph name={entry.name} />}
        <span
          className="min-w-0 flex-1 truncate text-[11.5px] leading-none"
          style={{ color: isDir ? '#d1d5db' : '#9ca3af' }}
        >
          {entry.name}
        </span>
        {isLoading && (
          <span className="flex-shrink-0 text-[9px]" style={{ color: '#4b5563' }}>…</span>
        )}
      </button>
      {isDir && isExpanded && (
        <div className="relative">
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-px"
            style={{ left: `${indent + 6}px`, background: 'rgba(255,255,255,0.06)' }}
          />
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              childrenByPath={childrenByPath}
              loadingPaths={loadingPaths}
              selectedPath={selectedPath}
              onToggleDir={onToggleDir}
              onClickFile={onClickFile}
            />
          ))}
          {!isLoading && children.length === 0 && (
            <div
              className="py-1 text-[10px] italic"
              style={{ paddingLeft: `${indent + 22}px`, color: '#4b5563' }}
            >
              Empty
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── File tree section ─────────────────────────────────────────────────────────

interface FileSectionProps {
  label: string;
  rootPath: string;
  conversationId?: string | null;
  onFileOpened: (path: string) => void;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function FileSection({ label, rootPath, conversationId, onFileOpened, selectedPath, onSelect }: FileSectionProps) {
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FsEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});

  const readDir = async (dirPath: string): Promise<FsEntry[]> => {
    const api = (window as any).clawdia;
    if (!api) return [];
    try {
      const items: FsEntry[] = await api.fs.readDir(dirPath);
      return sortEntries(items);
    } catch {
      return [];
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    readDir(rootPath).then((items) => {
      if (!cancelled) {
        setEntries(items);
        setChildrenByPath({});
        setExpandedPaths({});
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath]);

  const handleToggleDir = useCallback(async (entry: FsEntry) => {
    if (expandedPaths[entry.path]) {
      setExpandedPaths((prev) => ({ ...prev, [entry.path]: false }));
      return;
    }
    if (!childrenByPath[entry.path]) {
      setLoadingPaths((prev) => ({ ...prev, [entry.path]: true }));
      const items = await readDir(entry.path);
      setChildrenByPath((prev) => ({ ...prev, [entry.path]: items }));
      setLoadingPaths((prev) => { const n = { ...prev }; delete n[entry.path]; return n; });
    }
    setExpandedPaths((prev) => ({ ...prev, [entry.path]: true }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childrenByPath, expandedPaths]);

  const handleClickFile = useCallback((entry: FsEntry) => {
    onSelect(entry.path);
    onFileOpened(entry.path);
  }, [onFileOpened, onSelect]);

  return (
    <>
      <SectionHeader label={label} />
      {loading && (
        <div className="px-4 py-1 text-[10px]" style={{ color: '#4b5563' }}>Loading…</div>
      )}
      {!loading && entries.length === 0 && (
        <div className="px-4 py-1 text-[10px] italic" style={{ color: '#4b5563' }}>Empty</div>
      )}
      {entries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          expandedPaths={expandedPaths}
          childrenByPath={childrenByPath}
          loadingPaths={loadingPaths}
          selectedPath={selectedPath}
          onToggleDir={handleToggleDir}
          onClickFile={handleClickFile}
        />
      ))}
    </>
  );
}

// ── Search results ────────────────────────────────────────────────────────────

interface SearchResult {
  path: string;
  name: string;
  parentPath: string;
}

async function searchFiles(rootPath: string, query: string, api: any, results: SearchResult[], limit = 80): Promise<void> {
  if (results.length >= limit) return;
  try {
    const items: FsEntry[] = await api.fs.readDir(rootPath);
    for (const item of items) {
      if (results.length >= limit) return;
      if (item.name.toLowerCase().includes(query)) {
        results.push({ path: item.path, name: item.name, parentPath: rootPath });
      }
      if (item.type === 'dir' && !item.name.startsWith('.') && item.name !== 'node_modules') {
        await searchFiles(item.path, query, api, results, limit);
      }
    }
  } catch { /* skip unreadable dirs */ }
}

// ── Quick-access dir buttons ─────────────────────────────────────────────────

const QUICK_DIRS = [
  { label: 'Desktop', path: '~/Desktop' },
  { label: 'Home', path: '~' },
  { label: 'Documents', path: '~/Documents' },
  { label: 'Downloads', path: '~/Downloads' },
];

// ── Main drawer ───────────────────────────────────────────────────────────────

export default function RightFilesDrawer({ open, onClose, conversationId }: RightFilesDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeRoot, setActiveRoot] = useState<string>('~/Desktop');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const api = (window as any).clawdia;

  // ESC to close (but clear search first if active)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchQuery) { setSearchQuery(''); setSearchResults(null); }
        else onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, searchQuery]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const t = setTimeout(() => window.addEventListener('mousedown', handler), 100);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', handler); };
  }, [open, onClose]);

  // Focus search on open
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 220);
    else { setSearchQuery(''); setSearchResults(null); }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const q = searchQuery.trim().toLowerCase();
    if (!q) { setSearchResults(null); setSearching(false); return; }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      const results: SearchResult[] = [];
      await searchFiles(activeRoot, q, api, results);
      setSearchResults(results);
      setSearching(false);
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, activeRoot, refreshKey]);

  const handleOpenFile = useCallback(async (filePath: string) => {
    if (!api?.browser?.openFile) return;
    try {
      await api.browser.openFile(filePath, { conversationId: conversationId ?? undefined });
    } catch {
      try { await api.browser.openFile(filePath, {}); } catch { /* ignore */ }
    }
  }, [api, conversationId]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setSelectedPath(null);
    setSearchQuery('');
    setSearchResults(null);
  }, []);

  const handleClickSearchResult = useCallback((result: SearchResult) => {
    setSelectedPath(result.path);
    handleOpenFile(result.path);
  }, [handleOpenFile]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="pointer-events-none fixed inset-0 z-40 transition-opacity duration-200"
        style={{ background: 'rgba(0,0,0,0.35)', opacity: open ? 1 : 0 }}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className="no-drag fixed bottom-0 right-0 top-[36px] z-50 flex flex-col"
        style={{
          width: '280px',
          background: '#0d0d12',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          boxShadow: open ? '-8px 0 32px rgba(0,0,0,0.6), -2px 0 8px rgba(0,0,0,0.4)' : 'none',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'transform',
        }}
        aria-hidden={!open}
      >
        {/* Header */}
        <div
          className="flex flex-shrink-0 items-center gap-2 px-4 py-3"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: '#e5e7eb' }}>
            Files
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            title="Refresh"
            className="flex h-6 w-6 items-center justify-center rounded transition-colors"
            style={{ color: '#4b5563' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#4b5563'; (e.currentTarget as HTMLButtonElement).style.background = ''; }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 7A5.5 5.5 0 0 1 12 4.5M12.5 7A5.5 5.5 0 0 1 2 9.5" />
              <path d="M11.5 2v3h3" transform="translate(-2.5 0)" />
              <path d="M2.5 9v3h-3" transform="translate(3 0)" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close files"
            className="flex h-6 w-6 items-center justify-center rounded transition-colors"
            style={{ color: '#4b5563' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#4b5563'; (e.currentTarget as HTMLButtonElement).style.background = ''; }}
          >
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="2" y1="2" x2="8" y2="8" />
              <line x1="8" y1="2" x2="2" y2="8" />
            </svg>
          </button>
        </div>

        {/* Search box */}
        <div className="flex-shrink-0 px-3 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="relative flex items-center">
            <svg
              className="pointer-events-none absolute left-2.5 flex-shrink-0"
              width="11" height="11" viewBox="0 0 12 12" fill="none"
              stroke={searchQuery ? '#6b7280' : '#374151'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="5" cy="5" r="3.5" />
              <path d="M8 8L11 11" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files…"
              className="w-full rounded-md py-1.5 pl-7 pr-6 text-[11px] outline-none"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.07)',
                color: '#d1d5db',
                caretColor: '#6366f1',
              }}
              onFocus={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = 'rgba(99,102,241,0.4)'; }}
              onBlur={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.07)'; }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setSearchResults(null); searchRef.current?.focus(); }}
                className="absolute right-2 flex h-4 w-4 items-center justify-center rounded"
                style={{ color: '#4b5563' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#4b5563'; }}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Quick-access directory pills */}
        {!searchQuery && (
          <div
            className="flex flex-shrink-0 flex-wrap gap-1.5 px-3 py-2.5"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            {QUICK_DIRS.map((dir) => {
              const isActive = activeRoot === dir.path;
              return (
                <button
                  key={dir.path}
                  type="button"
                  onClick={() => { setActiveRoot(dir.path); setSelectedPath(null); }}
                  className="rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
                  style={{
                    background: isActive ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isActive ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.07)'}`,
                    color: isActive ? '#a5b4fc' : '#6b7280',
                  }}
                  onMouseEnter={(e) => { if (!isActive) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; } }}
                  onMouseLeave={(e) => { if (!isActive) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLButtonElement).style.color = '#6b7280'; } }}
                >
                  {dir.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Body: search results OR file tree */}
        <div className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}>
          {searchQuery ? (
            // ── Search results view ───────────────────────────────────────────
            <div>
              {searching && (
                <div className="px-4 py-2 text-[10px]" style={{ color: '#4b5563' }}>Searching…</div>
              )}
              {!searching && searchResults !== null && searchResults.length === 0 && (
                <div className="px-4 py-2 text-[10px] italic" style={{ color: '#4b5563' }}>No files found</div>
              )}
              {!searching && searchResults && searchResults.map((result) => (
                <button
                  key={result.path}
                  type="button"
                  onClick={() => handleClickSearchResult(result)}
                  className="group flex w-full flex-col rounded-none px-3 py-1.5 text-left transition-colors"
                  style={{
                    background: selectedPath === result.path ? 'rgba(99,102,241,0.12)' : undefined,
                    borderLeft: selectedPath === result.path ? '2px solid rgba(99,102,241,0.6)' : '2px solid transparent',
                  }}
                  onMouseEnter={(e) => { if (selectedPath !== result.path) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={(e) => { if (selectedPath !== result.path) (e.currentTarget as HTMLButtonElement).style.background = ''; }}
                >
                  <div className="flex items-center gap-1.5">
                    <FileGlyph name={result.name} />
                    <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: '#d1d5db' }}>{result.name}</span>
                  </div>
                  <span className="mt-0.5 truncate pl-5 text-[9.5px]" style={{ color: '#374151' }} title={result.parentPath}>
                    {result.parentPath.replace(/^\/home\/[^/]+/, '~')}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            // ── File tree view ────────────────────────────────────────────────
            <div key={`${activeRoot}-${refreshKey}`}>
              <FileSection
                label={QUICK_DIRS.find(d => d.path === activeRoot)?.label ?? activeRoot}
                rootPath={activeRoot}
                conversationId={conversationId}
                onFileOpened={handleOpenFile}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
              />
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div
          className="flex-shrink-0 px-4 py-2 text-[9.5px] leading-4"
          style={{ color: '#374151', borderTop: '1px solid rgba(255,255,255,0.05)' }}
        >
          Click a file to open it in the browser. ESC or click outside to close.
        </div>
      </div>
    </>
  );
}

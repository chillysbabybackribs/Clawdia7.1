// src/renderer/components/TabStrip.tsx
import React from 'react';
import type { ConversationTab } from '../tabLogic';
import ExecutorIdentity from './ExecutorIdentity';

interface TabStripProps {
  tabs: ConversationTab[];
  activeTabId: string;
  onSwitch: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

function TabStatusIcon({ status, title }: { status?: ConversationTab['status']; title?: string }) {
  if (status === 'running') {
    return (
      <span
        className="relative flex h-[12px] w-[12px] flex-shrink-0 items-center justify-center"
        title={title ?? 'Task running'}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          style={{ animation: 'tab-spin 0.75s linear infinite' }}
        >
          <circle cx="6" cy="6" r="4.5" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
          <path
            d="M6 1.5 A4.5 4.5 0 0 1 10.5 6"
            stroke="#e4e4e8"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <style>{`@keyframes tab-spin { to { transform: rotate(360deg); } }`}</style>
      </span>
    );
  }

  if (status === 'completed') {
    return (
      <span className="flex h-[12px] w-[12px] flex-shrink-0 items-center justify-center text-[#66d18f]" title={title ?? 'Task completed'}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.25 6.5 11 12.5 5" />
        </svg>
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span className="flex h-[12px] w-[12px] flex-shrink-0 items-center justify-center text-[#ff7d7d]" title={title ?? 'Task failed'}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 5 11 11" />
          <path d="M11 5 5 11" />
        </svg>
      </span>
    );
  }

  return null;
}

export default function TabStrip({ tabs, activeTabId, onSwitch, onClose, onNew, onReorder }: TabStripProps) {
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const [draggingIndex, setDraggingIndex] = React.useState<number | null>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const tabRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const currentIndexRef = React.useRef<number | null>(null);
  const startXRef = React.useRef<number>(0);
  const didSwapRef = React.useRef(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, index: number) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingIndex(index);
    currentIndexRef.current = index;
    startXRef.current = e.clientX;
    didSwapRef.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (currentIndexRef.current === null) return;
    const cur = currentIndexRef.current;

    if (cur > 0) {
      const leftEl = tabRefs.current[cur - 1];
      if (leftEl) {
        const rect = leftEl.getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) {
          onReorder(cur, cur - 1);
          currentIndexRef.current = cur - 1;
          setDraggingIndex(cur - 1);
          didSwapRef.current = true;
          return;
        }
      }
    }

    if (cur < tabs.length - 1) {
      const rightEl = tabRefs.current[cur + 1];
      if (rightEl) {
        const rect = rightEl.getBoundingClientRect();
        if (e.clientX > rect.left + rect.width / 2) {
          onReorder(cur, cur + 1);
          currentIndexRef.current = cur + 1;
          setDraggingIndex(cur + 1);
          didSwapRef.current = true;
          return;
        }
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>, index: number) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!didSwapRef.current) {
      const finalIndex = currentIndexRef.current ?? index;
      const tab = tabs[finalIndex];
      if (tab && tab.id !== activeTabId) onSwitch(tab.id);
    }
    setDraggingIndex(null);
    currentIndexRef.current = null;
    didSwapRef.current = false;
  };

  return (
    <div
      ref={stripRef}
      className="flex items-end px-2 flex-shrink-0 gap-[3px]"
      style={{
        background: 'transparent',
        height: 48,
        position: 'relative',
        zIndex: 10,
        borderTop: 'none',
        borderBottom: '1px solid rgba(255,255,255,0.12)',
      }}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const isOnly = tabs.length === 1;
        const isHovered = hoveredId === tab.id;
        const isDragging = draggingIndex === index;
        const title = tab.title?.trim() || 'New conversation';

        return (
          <div
            key={tab.id}
            ref={el => { tabRefs.current[index] = el; }}
            onPointerDown={(e) => handlePointerDown(e, index)}
            onPointerMove={handlePointerMove}
            onPointerUp={(e) => handlePointerUp(e, index)}
            onMouseEnter={() => { if (!isActive && draggingIndex === null) setHoveredId(tab.id); }}
            onMouseLeave={() => setHoveredId(null)}
            title={title}
            className="relative flex items-center select-none min-w-0 flex-1 max-w-[200px]"
            style={{
              height: isActive ? 36 : 28,
              alignSelf: 'flex-end',
              cursor: isDragging ? 'grabbing' : 'pointer',
              zIndex: isDragging ? 5 : isActive ? 3 : 1,
              transition: 'height 0.18s ease-out',
              borderRadius: '6px 6px 0 0',
              background: isActive
                ? 'linear-gradient(180deg, #2e2e2e 0%, #232323 100%)'
                : isDragging
                  ? 'rgba(255,255,255,0.07)'
                  : isHovered
                    ? 'rgba(255,255,255,0.05)'
                    : 'rgba(255,255,255,0.03)',
              borderTop: isActive ? '1px solid rgba(255,255,255,0.16)' : `1px solid ${isHovered ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.07)'}`,
              borderLeft: isActive ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(255,255,255,0.05)',
              borderRight: isActive ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(255,255,255,0.05)',
              borderBottom: 'none',
              boxShadow: isActive
                ? '0 -2px 14px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)'
                : 'none',
            }}
          >
            {/* Top accent highlight on active */}
            {isActive && (
              <div
                className="absolute left-0 right-0 pointer-events-none"
                style={{
                  top: 0,
                  height: 1,
                  borderRadius: '6px 6px 0 0',
                  background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 25%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0.3) 75%, transparent 100%)',
                }}
              />
            )}

            <div
              className="relative flex items-center gap-[6px] w-full h-full pointer-events-auto"
              style={{
                padding: '0 12px',
                color: isActive
                  ? 'rgba(255,255,255,0.95)'
                  : isHovered
                    ? 'rgba(255,255,255,0.65)'
                    : 'rgba(255,255,255,0.38)',
                transition: 'color 0.15s',
              }}
            >
              <TabStatusIcon status={tab.status} />
              <ExecutorIdentity mode={tab.mode} isActive={isActive} />
              <span
                className={`truncate min-w-0 flex-1 ${isActive ? 'text-[12px] font-semibold tracking-[0.01em]' : 'text-[11.5px] font-medium'}`}
                style={{
                  maskImage: 'linear-gradient(90deg, #000 0%, #000 calc(100% - 18px), transparent)',
                  WebkitMaskImage: 'linear-gradient(90deg, #000 0%, #000 calc(100% - 18px), transparent)',
                }}
              >
                {title}
              </span>
              {!isOnly && (
                <span
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                  className="flex items-center justify-center w-[15px] h-[15px] rounded-full text-[13px] leading-none transition-all cursor-pointer flex-shrink-0 hover:bg-white/[0.12]"
                  style={{
                    color: isActive ? 'rgba(255,255,255,0.45)' : isHovered ? 'rgba(255,255,255,0.35)' : 'transparent',
                  }}
                  title="Close tab"
                >
                  ×
                </span>
              )}
            </div>
          </div>
        );
      })}

      <button
        onClick={onNew}
        className="flex items-center justify-center w-[26px] h-[26px] mb-[2px] ml-1 rounded-full text-[18px] text-text-muted hover:text-text-primary hover:bg-white/[0.06] leading-none cursor-pointer transition-all flex-shrink-0"
        title="New conversation"
      >
        +
      </button>
    </div>
  );
}

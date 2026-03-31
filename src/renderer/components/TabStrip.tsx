// src/renderer/components/TabStrip.tsx
import React from 'react';
import type { ConversationTab } from '../tabLogic';

interface TabStripProps {
  tabs: ConversationTab[];
  activeTabId: string;
  runningConvIds?: Set<string>;
  onSwitch: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

const STRIP_BG = '#131316';

const activeTabStyle: React.CSSProperties = {
  background: '#1e1e22',
  border: '1.5px solid rgba(255,255,255,0.22)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(0,0,0,0.3)',
};

const inactiveTabStyle: React.CSSProperties = {
  background: '#141419',
  border: '1.5px solid rgba(255,255,255,0.08)',
  boxShadow: [
    '0 7px 16px rgba(0,0,0,0.48)',
    '0 2px 5px rgba(0,0,0,0.34)',
    'inset 0 1px 0 rgba(255,255,255,0.04)',
    'inset 0 2px 5px rgba(255,255,255,0.025)',
    'inset 0 -4px 10px rgba(0,0,0,0.72)',
    'inset 0 0 0 1px rgba(0,0,0,0.22)',
  ].join(', '),
};

const inactiveTabHoverStyle: React.CSSProperties = {
  background: '#1a1a20',
  border: '1.5px solid rgba(255,255,255,0.13)',
  boxShadow: [
    '0 9px 20px rgba(0,0,0,0.52)',
    '0 3px 8px rgba(0,0,0,0.38)',
    'inset 0 1px 0 rgba(255,255,255,0.06)',
    'inset 0 2px 6px rgba(255,255,255,0.03)',
    'inset 0 -4px 10px rgba(0,0,0,0.68)',
    'inset 0 0 0 1px rgba(0,0,0,0.18)',
  ].join(', '),
};

const draggingTabStyle: React.CSSProperties = {
  background: '#24242a',
  border: '1.5px solid rgba(255,255,255,0.35)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)',
};

export default function TabStrip({ tabs, activeTabId, runningConvIds, onSwitch, onClose, onNew, onReorder }: TabStripProps) {
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const [draggingIndex, setDraggingIndex] = React.useState<number | null>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const tabRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  // Track current index during drag so swaps chain correctly
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

    // Check left neighbour
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

    // Check right neighbour
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
      // treat as click — use the tab at the current index (may differ after swaps)
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
      className="flex items-center px-2 h-[46px] flex-shrink-0"
      style={{
        background: STRIP_BG,
        borderTop: '1px solid rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.12)',
        boxShadow: [
          '0 6px 20px rgba(0,0,0,0.7)',
          '0 2px 6px rgba(0,0,0,0.5)',
          'inset 0 1px 0 rgba(255,255,255,0.07)',
          'inset 0 -2px 4px rgba(0,0,0,0.5)',
        ].join(', '),
        position: 'relative',
        zIndex: 10,
      }}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const isOnly = tabs.length === 1;
        const isRunning = !isActive && tab.conversationId != null && (runningConvIds?.has(tab.conversationId) ?? false);
        const isHovered = hoveredId === tab.id;
        const isDragging = draggingIndex === index;
        const title = tab.title ?? 'New Chat';

        const tabStyle = isDragging
          ? draggingTabStyle
          : isActive
            ? activeTabStyle
            : isHovered
              ? inactiveTabHoverStyle
              : inactiveTabStyle;

        return (
          <React.Fragment key={tab.id}>
            <div
              ref={el => { tabRefs.current[index] = el; }}
              onPointerDown={(e) => handlePointerDown(e, index)}
              onPointerMove={handlePointerMove}
              onPointerUp={(e) => handlePointerUp(e, index)}
              onMouseEnter={() => { if (!isActive && draggingIndex === null) setHoveredId(tab.id); }}
              onMouseLeave={() => setHoveredId(null)}
              title={title}
              className="relative flex items-center gap-[6px] px-[10px] my-[8px] h-[30px] rounded-lg select-none text-[13px] font-medium min-w-0 flex-1 max-w-[180px] group mr-[3px]"
              style={{
                ...tabStyle,
                color: isDragging ? '#e4e4e8' : isActive ? '#e4e4e8' : isHovered ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.45)',
                cursor: isDragging ? 'grabbing' : 'grab',
                transition: 'background 0.12s, border-color 0.12s, box-shadow 0.12s',
                zIndex: isDragging ? 2 : 1,
              }}
            >
              {isRunning && (
                <span className="w-[6px] h-[6px] rounded-full bg-accent/80 animate-pulse flex-shrink-0" title="Agent running" />
              )}
              <span className="truncate min-w-0 flex-1">{title}</span>
              {!isOnly && (
                <span
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                  className="text-[15px] leading-none transition-colors cursor-pointer flex-shrink-0"
                  style={{
                    color: isActive ? 'rgba(255,255,255,0.3)' : isHovered ? 'rgba(255,255,255,0.3)' : 'transparent',
                  }}
                  title="Close tab"
                >
                  ×
                </span>
              )}
            </div>
            <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />
          </React.Fragment>
        );
      })}

      <button
        onClick={onNew}
        className="flex items-center justify-center h-full px-[10px] text-[20px] text-text-muted hover:text-text-primary leading-none cursor-pointer transition-colors"
        title="New conversation"
      >
        +
      </button>
    </div>
  );
}

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
}

export default function TabStrip({ tabs, activeTabId, runningConvIds, onSwitch, onClose, onNew }: TabStripProps) {
  return (
    <div className="flex items-center px-2 h-[46px] flex-shrink-0 bg-surface-1 border-b border-white/[0.06] overflow-hidden">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isOnly = tabs.length === 1;
        const isRunning = !isActive && tab.conversationId != null && (runningConvIds?.has(tab.conversationId) ?? false);
        const title = tab.title ?? 'New Chat';

        return (
          <div
            key={tab.id}
            onClick={() => { if (!isActive) onSwitch(tab.id); }}
            title={title}
            className={[
              'relative flex items-center gap-[6px] px-[10px] my-[8px] h-[30px] rounded-lg cursor-pointer select-none text-[13px] font-medium transition-all border-[1.5px] min-w-0 flex-1 max-w-[180px]',
              isActive
                ? 'text-text-primary border-white/[0.12] bg-white/[0.04] shadow-[inset_0_1px_4px_rgba(0,0,0,0.2)]'
                : 'text-white/40 border-white/[0.05] hover:border-white/[0.09] hover:text-white/60 group',
            ].join(' ')}
          >
            {isRunning && (
              <span className="w-[6px] h-[6px] rounded-full bg-accent/80 animate-pulse flex-shrink-0" title="Agent running" />
            )}
            <span className="truncate min-w-0 flex-1">{title}</span>
            {!isOnly && (
              <span
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className={[
                  'text-[15px] leading-none transition-colors cursor-pointer flex-shrink-0',
                  isActive
                    ? 'text-white/25 hover:text-text-primary'
                    : 'text-transparent group-hover:text-white/25 hover:!text-text-primary',
                ].join(' ')}
                title="Close tab"
              >
                ×
              </span>
            )}
          </div>
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

// src/renderer/components/TabStrip.tsx
import React from 'react';
import type { ConversationTab } from '../tabLogic';

interface TabStripProps {
  tabs: ConversationTab[];
  activeTabId: string;
  onSwitch: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
}

export default function TabStrip({ tabs, activeTabId, onSwitch, onClose, onNew }: TabStripProps) {
  return (
    <div className="flex items-center px-2 h-[46px] flex-shrink-0 bg-surface-1 border-b border-white/[0.06]">
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const isOnly = tabs.length === 1;

        return (
          <div
            key={tab.id}
            onClick={() => { if (!isActive) onSwitch(tab.id); }}
            className={[
              'relative flex items-center gap-[7px] px-[14px] my-[8px] h-[30px] rounded-lg cursor-pointer select-none text-[13px] font-medium transition-all border-[1.5px]',
              isActive
                ? 'text-text-primary border-white/[0.12] bg-white/[0.04] shadow-[inset_0_1px_4px_rgba(0,0,0,0.2)]'
                : 'text-white/40 border-white/[0.05] hover:border-white/[0.09] hover:text-white/60 group',
            ].join(' ')}
          >
            <span>{tab.title ?? 'New Chat'}</span>
            {!isOnly && (
              <span
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className={[
                  'text-[15px] leading-none transition-colors cursor-pointer',
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

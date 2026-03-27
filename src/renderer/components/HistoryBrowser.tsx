import React, { useState, useEffect, useCallback } from 'react';
import type { ConversationTab } from '../tabLogic';

interface ConvItem {
  id: string;
  title: string;
  updatedAt: string;
}

interface HistoryBrowserProps {
  currentTabs: ConversationTab[];
  onSelectConversation: (id: string) => void;
  onClose: () => void;
}

type DateGroup = 'Today' | 'Yesterday' | 'Last 7 days' | 'Older';

function getDateGroup(isoDate: string): DateGroup {
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = diff / (1000 * 60 * 60 * 24);
  if (days < 1) return 'Today';
  if (days < 2) return 'Yesterday';
  if (days < 7) return 'Last 7 days';
  return 'Older';
}

function formatDate(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

const GROUP_ORDER: DateGroup[] = ['Today', 'Yesterday', 'Last 7 days', 'Older'];

export default function HistoryBrowser({ currentTabs, onSelectConversation, onClose }: HistoryBrowserProps) {
  const [conversations, setConversations] = useState<ConvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const api = (window as any).clawdia;
    try {
      const list = await api.chat.list();
      setConversations(list || []);
    } catch {
      setError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openTabIds = new Set(currentTabs.map(t => t.conversationId).filter(Boolean));

  const grouped = GROUP_ORDER.reduce<Record<DateGroup, ConvItem[]>>(
    (acc, g) => { acc[g] = []; return acc; },
    {} as Record<DateGroup, ConvItem[]>
  );
  for (const c of conversations) {
    grouped[getDateGroup(c.updatedAt)].push(c);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <span className="text-[13px] font-semibold text-text-primary tracking-wide">Chat History</span>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-7 h-7 rounded-md text-text-muted hover:text-text-primary hover:bg-white/[0.06] transition-all cursor-pointer text-[16px] leading-none"
          title="Close history"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading && (
          <div className="flex items-center justify-center h-24 text-[13px] text-text-muted">
            Loading…
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center h-24 gap-2">
            <span className="text-[13px] text-text-muted">Failed to load history.</span>
            <button
              onClick={load}
              className="text-[12px] text-text-secondary underline hover:text-text-primary cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && conversations.length === 0 && (
          <div className="flex items-center justify-center h-24 text-[13px] text-text-muted">
            No conversations yet.
          </div>
        )}

        {!loading && !error && GROUP_ORDER.map(group => {
          const items = grouped[group];
          if (items.length === 0) return null;
          return (
            <div key={group} className="mb-4">
              <div className="px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted opacity-60">
                {group}
              </div>
              {items.map(conv => {
                const isOpen = openTabIds.has(conv.id);
                return (
                  <button
                    key={conv.id}
                    onClick={() => { onSelectConversation(conv.id); onClose(); }}
                    className="w-full flex items-center justify-between px-3 py-[9px] rounded-lg text-left cursor-pointer transition-all hover:bg-white/[0.05] group"
                  >
                    <span
                      className="text-[13px] text-text-primary truncate flex-1 mr-3"
                      style={{ opacity: isOpen ? 0.5 : 1 }}
                    >
                      {conv.title || 'Untitled'}
                    </span>
                    <span className="text-[11px] text-text-muted flex-shrink-0 opacity-60">
                      {isOpen ? 'open' : formatDate(conv.updatedAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

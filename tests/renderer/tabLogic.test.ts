// tests/renderer/tabLogic.test.ts
import { describe, it, expect } from 'vitest';
import {
  makeTab,
  addTab,
  closeTab,
  switchTab,
  type ConversationTab,
} from '../../src/renderer/tabLogic';

describe('makeTab', () => {
  it('creates a tab with a unique id and given conversationId', () => {
    const tab = makeTab('conv-1');
    expect(tab.id).toMatch(/^tab-/);
    expect(tab.conversationId).toBe('conv-1');
  });

  it('creates a tab with null conversationId when none given', () => {
    const tab = makeTab(null);
    expect(tab.conversationId).toBeNull();
  });
});

describe('addTab', () => {
  it('appends a new tab and returns it as active', () => {
    const existing: ConversationTab[] = [makeTab('conv-1')];
    const newTab = makeTab('conv-2');
    const result = addTab(existing, newTab);
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[1].conversationId).toBe('conv-2');
    expect(result.activeTabId).toBe(newTab.id);
  });
});

describe('closeTab', () => {
  it('removes the tab by id', () => {
    const t1 = makeTab('conv-1');
    const t2 = makeTab('conv-2');
    const t3 = makeTab('conv-3');
    const result = closeTab([t1, t2, t3], t2.id, t2.id);
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs.find(t => t.id === t2.id)).toBeUndefined();
  });

  it('activates the previous tab when closing the active tab', () => {
    const t1 = makeTab('conv-1');
    const t2 = makeTab('conv-2');
    const result = closeTab([t1, t2], t2.id, t2.id);
    expect(result.activeTabId).toBe(t1.id);
  });

  it('activates the next tab when closing the first tab', () => {
    const t1 = makeTab('conv-1');
    const t2 = makeTab('conv-2');
    const result = closeTab([t1, t2], t1.id, t1.id);
    expect(result.activeTabId).toBe(t2.id);
  });

  it('does not change activeTabId when closing a non-active tab', () => {
    const t1 = makeTab('conv-1');
    const t2 = makeTab('conv-2');
    const result = closeTab([t1, t2], t2.id, t1.id);
    expect(result.activeTabId).toBe(t1.id);
  });

  it('refuses to close the last tab', () => {
    const t1 = makeTab('conv-1');
    const result = closeTab([t1], t1.id, t1.id);
    expect(result.tabs).toHaveLength(1);
    expect(result.activeTabId).toBe(t1.id);
  });
});

describe('switchTab', () => {
  it('returns the new activeTabId', () => {
    const t1 = makeTab('conv-1');
    const t2 = makeTab('conv-2');
    const result = switchTab([t1, t2], t2.id);
    expect(result.activeTabId).toBe(t2.id);
  });
});

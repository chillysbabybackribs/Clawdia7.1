import type { BrowserBudgetState, ToolUseBlock } from './types';

const MAX_SEARCH_ROUNDS = 2;
const MAX_INSPECTED_TARGETS = 6;
const MAX_BACKGROUND_TABS = 6;
const MAX_SCROLL_FALLBACKS = 2;

const SEARCH_ENGINES = ['google.com/search', 'bing.com/search', 'duckduckgo.com/?q', 'search.yahoo.com'];
const EXTRACT_TOOLS = new Set(['browser_extract_text', 'browser_get_page_state', 'browser_find_elements']);
const TAB_TOOLS = new Set(['browser_new_tab']);
const SCROLL_TOOLS = new Set(['browser_scroll']);

export function initBrowserBudget(): BrowserBudgetState {
  return {
    searchRounds: 0,
    inspectedTargets: new Set(),
    backgroundTabs: 0,
    scrollFallbacks: new Map(),
  };
}

export function checkBrowserBudget(
  toolBlocks: ToolUseBlock[],
  state: BrowserBudgetState,
): string | null {
  for (const block of toolBlocks) {
    const { name, input } = block;

    if (name === 'browser_navigate') {
      const url = (input.url as string) ?? '';
      if (SEARCH_ENGINES.some(e => url.includes(e)) && state.searchRounds >= MAX_SEARCH_ROUNDS) {
        return `Browser budget: search round limit (${MAX_SEARCH_ROUNDS}) reached. Stop searching and synthesize from what you have.`;
      }
    }

    if (EXTRACT_TOOLS.has(name) && state.inspectedTargets.size >= MAX_INSPECTED_TARGETS) {
      return `Browser budget: inspected target limit (${MAX_INSPECTED_TARGETS}) reached. Stop inspecting new pages and produce a final answer.`;
    }

    if (TAB_TOOLS.has(name) && state.backgroundTabs >= MAX_BACKGROUND_TABS) {
      return `Browser budget: background tab limit (${MAX_BACKGROUND_TABS}) reached. Close tabs before opening new ones.`;
    }

    if (SCROLL_TOOLS.has(name)) {
      const url = (input._currentUrl as string) ?? 'unknown';
      const scrollCount = state.scrollFallbacks.get(url) ?? 0;
      if (scrollCount >= MAX_SCROLL_FALLBACKS) {
        return `Browser budget: scroll fallback limit (${MAX_SCROLL_FALLBACKS}) reached for this page. Try a different approach.`;
      }
    }
  }
  return null;
}

export function updateBrowserBudget(
  toolBlocks: ToolUseBlock[],
  results: string[],
  state: BrowserBudgetState,
): void {
  for (let i = 0; i < toolBlocks.length; i++) {
    const block = toolBlocks[i];
    const { name, input } = block;

    if (name === 'browser_navigate') {
      const url = (input.url as string) ?? '';
      if (SEARCH_ENGINES.some(e => url.includes(e))) {
        state.searchRounds++;
      }
    }

    if (EXTRACT_TOOLS.has(name)) {
      const result = results[i] ?? '';
      try {
        const parsed = JSON.parse(result);
        const url = parsed.url as string | undefined;
        if (url) state.inspectedTargets.add(url);
      } catch { /* non-JSON result, skip */ }
    }

    if (TAB_TOOLS.has(name)) {
      state.backgroundTabs++;
    }

    if (SCROLL_TOOLS.has(name)) {
      const url = (input._currentUrl as string) ?? 'unknown';
      state.scrollFallbacks.set(url, (state.scrollFallbacks.get(url) ?? 0) + 1);
    }
  }
}

export function checkToolPolicy(toolBlocks: ToolUseBlock[]): string | null {
  for (const block of toolBlocks) {
    if ((block.name === 'file_edit' || block.name === 'str_replace_based_edit_tool')) {
      const path = block.input.path as string | undefined;
      const cmd = block.input.command as string | undefined;
      if (path && (cmd === 'create' || cmd === 'str_replace') && path.startsWith('/')) {
        const safe = ['/tmp/', '/home/', process.env.HOME ?? ''].some(p => path.startsWith(p));
        if (!safe) {
          return `Tool policy: absolute path "${path}" is not allowed in file_edit. Use a relative path or a path under /tmp or $HOME.`;
        }
      }
    }
  }
  return null;
}

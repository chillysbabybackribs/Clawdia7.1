// tests/main/core/cli/browserTools.test.ts
import { describe, it, expect, vi } from 'vitest';
import { executeBrowserTool, BROWSER_TOOLS } from '../../../../src/main/core/cli/browserTools';
import type { BrowserService } from '../../../../src/main/core/browser/BrowserService';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: (p: string) => {
      if (p === '/tmp/shot.png') return Buffer.from('fakepng');
      return actual.readFileSync(p);
    },
  };
});

function makeBrowser(overrides: Partial<BrowserService> = {}): BrowserService {
  return {
    navigate: vi.fn().mockResolvedValue({ tabId: 't1', url: 'https://example.com', title: 'Example' }),
    click: vi.fn().mockResolvedValue({ ok: true }),
    type: vi.fn().mockResolvedValue({ ok: true }),
    scroll: vi.fn().mockResolvedValue({ ok: true }),
    waitFor: vi.fn().mockResolvedValue({ ok: true }),
    evaluateJs: vi.fn().mockResolvedValue({ ok: true, data: 42 }),
    findElements: vi.fn().mockResolvedValue({ ok: true, data: [{ tag: 'a', text: 'Link', attrs: {} }] }),
    getPageState: vi.fn().mockResolvedValue({ url: 'https://example.com', title: 'Example', isLoading: false, canGoBack: false, canGoForward: false, textSample: 'Hello' }),
    screenshot: vi.fn().mockResolvedValue({ path: '/tmp/shot.png', mimeType: 'image/png', width: 1280, height: 800 }),
    extractText: vi.fn().mockResolvedValue({ url: 'https://example.com', title: 'Example', text: 'Page text', truncated: false }),
    newTab: vi.fn().mockResolvedValue({ id: 't2', title: 'New Tab', url: '', active: true, isLoading: false, isNewTab: true }),
    switchTab: vi.fn().mockResolvedValue(undefined),
    listTabs: vi.fn().mockResolvedValue([{ id: 't1', title: 'Example', url: 'https://example.com', active: true, isLoading: false, isNewTab: false }]),
    // New tool stubs
    select: vi.fn().mockResolvedValue({ ok: true }),
    hover: vi.fn().mockResolvedValue({ ok: true }),
    keyPress: vi.fn().mockResolvedValue({ ok: true }),
    getElementText: vi.fn().mockResolvedValue({ ok: true, data: 'element text' }),
    // Unused stubs
    setBounds: vi.fn(),
    getExecutionMode: vi.fn(),
    open: vi.fn(),
    back: vi.fn().mockResolvedValue(undefined),
    forward: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
    closeTab: vi.fn().mockResolvedValue(undefined),
    matchHistory: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    listSessions: vi.fn(),
    clearSession: vi.fn(),
    on: vi.fn(),
    getPageInfo: vi.fn(),
    ...overrides,
  } as unknown as BrowserService;
}

describe('BROWSER_TOOLS', () => {
  it('exports the expected number of tool definitions', () => {
    expect(BROWSER_TOOLS.length).toBeGreaterThan(20);
  });

  it('every tool has a name, description, and input_schema', () => {
    for (const tool of BROWSER_TOOLS) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.input_schema).toBeDefined();
    }
  });

  it('browser_screenshot description discourages routine confirmation use', () => {
    const screenshotTool = BROWSER_TOOLS.find((tool) => tool.name === 'browser_screenshot');
    expect(screenshotTool?.description).toContain('Use only when visual confirmation is required');
    expect(screenshotTool?.description).toContain('page-state/text checks are ambiguous');
  });
});

describe('executeBrowserTool', () => {
  it('browser_navigate calls browser.navigate, then returns lightweight page verification data', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_navigate', { url: 'https://example.com' }, browser);
    expect(browser.navigate).toHaveBeenCalledWith('https://example.com');
    expect(browser.getPageState).toHaveBeenCalled();
    expect(result).toEqual({
      tabId: 't1',
      url: 'https://example.com',
      title: 'Example',
      isLoading: false,
      textSample: 'Hello',
      canGoBack: false,
      canGoForward: false,
    });
  });

  it('browser_click calls browser.click with selector', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_click', { selector: '#btn' }, browser);
    expect(browser.click).toHaveBeenCalledWith('#btn');
    expect(result).toEqual({ ok: true });
  });

  it('browser_type passes clearFirst=true by default', async () => {
    const browser = makeBrowser();
    await executeBrowserTool('browser_type', { selector: 'input', text: 'hello' }, browser);
    expect(browser.type).toHaveBeenCalledWith('input', 'hello', true);
  });

  it('browser_type passes clearFirst=false when specified', async () => {
    const browser = makeBrowser();
    await executeBrowserTool('browser_type', { selector: 'input', text: 'hello', clearFirst: false }, browser);
    expect(browser.type).toHaveBeenCalledWith('input', 'hello', false);
  });

  it('browser_scroll passes null selector when omitted', async () => {
    const browser = makeBrowser();
    await executeBrowserTool('browser_scroll', { deltaY: 300 }, browser);
    expect(browser.scroll).toHaveBeenCalledWith(null, 300);
  });

  it('browser_wait_for passes timeoutMs', async () => {
    const browser = makeBrowser();
    await executeBrowserTool('browser_wait_for', { selector: '.loaded', timeoutMs: 5000 }, browser);
    expect(browser.waitFor).toHaveBeenCalledWith('.loaded', 5000);
  });

  it('browser_evaluate_js returns ok+data', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_evaluate_js', { expression: '1+1' }, browser);
    expect(result).toEqual({ ok: true, data: 42 });
  });

  it('browser_find_elements returns ok+data array', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_find_elements', { selector: 'a' }, browser);
    expect(result).toEqual({ ok: true, data: [{ tag: 'a', text: 'Link', attrs: {} }] });
  });

  it('browser_get_page_state returns full state', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_get_page_state', {}, browser) as { textSample: string };
    expect(result).toMatchObject({ url: 'https://example.com', title: 'Example', textSample: 'Hello' });
  });

  it('browser_screenshot returns base64 image data', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_screenshot', {}, browser) as Record<string, unknown>;
    expect(result).toMatchObject({ type: 'base64', mimeType: 'image/png', width: 1280, height: 800 });
    expect(typeof result.data).toBe('string');
  });

  it('browser_extract_text returns text content', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_extract_text', {}, browser);
    expect(result).toMatchObject({ text: 'Page text', truncated: false });
  });

  it('browser_new_tab returns id+url+title', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_new_tab', { url: 'https://example.com' }, browser);
    expect(result).toEqual({ id: 't2', url: '', title: 'New Tab' });
  });

  it('browser_switch_tab calls switchTab and returns ok', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_switch_tab', { id: 't1' }, browser);
    expect(browser.switchTab).toHaveBeenCalledWith('t1');
    expect(result).toEqual({ ok: true });
  });

  it('browser_list_tabs returns tab array', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_list_tabs', {}, browser) as unknown[];
    expect(Array.isArray(result)).toBe(true);
    expect((result as Array<{ id: string }>)[0].id).toBe('t1');
  });

  it('returns error for unknown tool name', async () => {
    const browser = makeBrowser();
    const result = await executeBrowserTool('browser_unknown', {}, browser);
    expect(result).toEqual({ ok: false, error: 'Unknown browser tool: browser_unknown' });
  });
});

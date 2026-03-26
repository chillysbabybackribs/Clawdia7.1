// tests/main/anthropicChat.tool-loop.test.ts
/**
 * Tests the agentic tool-use loop inside streamAnthropicChat.
 * Mocks the Anthropic SDK and BrowserService so no real network or Electron is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @anthropic-ai/sdk ──────────────────────────────────────────────────
const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  function AnthropicMock() {
    return {
      messages: {
        create: mockCreate,
        stream: mockStream,
      },
    };
  }
  return {
    default: AnthropicMock,
  };
});

// ── Import after mock ───────────────────────────────────────────────────────
import { streamAnthropicChat } from '../../src/main/anthropicChat';
import type { BrowserService } from '../../src/main/core/browser/BrowserService';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeWebContents() {
  const sent: Array<[string, unknown]> = [];
  return {
    isDestroyed: () => false,
    send: vi.fn((channel: string, payload: unknown) => { sent.push([channel, payload]); }),
    _sent: sent,
  };
}

function makeBrowser(): BrowserService {
  return {
    navigate: vi.fn().mockResolvedValue({ tabId: 't1', url: 'https://example.com', title: 'Example' }),
    getPageState: vi.fn().mockResolvedValue({
      url: 'https://example.com',
      title: 'Example',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      textSample: 'Hello world',
    }),
    click: vi.fn().mockResolvedValue({ ok: true }),
    type: vi.fn().mockResolvedValue({ ok: true }),
    scroll: vi.fn().mockResolvedValue({ ok: true }),
    waitFor: vi.fn().mockResolvedValue({ ok: true }),
    evaluateJs: vi.fn().mockResolvedValue({ ok: true, data: null }),
    findElements: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    screenshot: vi.fn().mockResolvedValue({ path: '/tmp/shot.png', mimeType: 'image/png', width: 800, height: 600 }),
    extractText: vi.fn().mockResolvedValue({ url: '', title: '', text: '', truncated: false }),
    newTab: vi.fn().mockResolvedValue({ id: 't2', title: 'New Tab', url: '', active: true, isLoading: false, isNewTab: true }),
    switchTab: vi.fn().mockResolvedValue(undefined),
    listTabs: vi.fn().mockResolvedValue([]),
    setBounds: vi.fn(),
    getExecutionMode: vi.fn(),
    open: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    closeTab: vi.fn(),
    matchHistory: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    listSessions: vi.fn(),
    clearSession: vi.fn(),
    on: vi.fn(),
    getPageInfo: vi.fn(),
  } as unknown as BrowserService;
}

const BASE_PARAMS = {
  apiKey: 'test-key',
  modelRegistryId: 'claude-haiku-4-5',
  userText: 'navigate to example.com',
  sessionMessages: [] as import('@anthropic-ai/sdk').MessageParam[],
  signal: new AbortController().signal,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('streamAnthropicChat — agentic tool loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default stream mock for non-tool path (returns empty)
    mockStream.mockReturnValue({
      on: vi.fn(),
      finalMessage: vi.fn().mockResolvedValue({}),
    });
  });

  it('calls browser.navigate when tool_use block is returned, then returns final text', async () => {
    const wc = makeWebContents();
    const browser = makeBrowser();

    // Turn 1: tool_use → navigate
    mockCreate
      .mockResolvedValueOnce({
        content: [
          { type: 'tool_use', id: 'tu1', name: 'browser_navigate', input: { url: 'https://example.com' } },
        ],
        stop_reason: 'tool_use',
      })
      // Turn 2: final text
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done! I navigated to Example.' }],
        stop_reason: 'end_turn',
      });

    const result = await streamAnthropicChat({
      ...BASE_PARAMS,
      webContents: wc as unknown as import('electron').WebContents,
      sessionMessages: [],
      browserService: browser,
    });

    expect(browser.navigate).toHaveBeenCalledWith('https://example.com');
    expect(result.response).toBe('Done! I navigated to Example.');
    expect(result.error).toBeUndefined();
  });

  it('runs multiple tool turns before producing final text', async () => {
    const wc = makeWebContents();
    const browser = makeBrowser();

    mockCreate
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tu1', name: 'browser_navigate', input: { url: 'https://a.com' } }],
        stop_reason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tu2', name: 'browser_get_page_state', input: {} }],
        stop_reason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'All done.' }],
        stop_reason: 'end_turn',
      });

    const result = await streamAnthropicChat({
      ...BASE_PARAMS,
      webContents: wc as unknown as import('electron').WebContents,
      sessionMessages: [],
      browserService: browser,
    });

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(browser.navigate).toHaveBeenCalledTimes(1);
    expect(browser.getPageState).toHaveBeenCalledTimes(1);
    expect(result.response).toBe('All done.');
  });

  it('appends tool turns to sessionMessages', async () => {
    const wc = makeWebContents();
    const browser = makeBrowser();
    const sessionMessages: import('@anthropic-ai/sdk').MessageParam[] = [];

    mockCreate
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tu1', name: 'browser_navigate', input: { url: 'https://b.com' } }],
        stop_reason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done.' }],
        stop_reason: 'end_turn',
      });

    await streamAnthropicChat({
      ...BASE_PARAMS,
      webContents: wc as unknown as import('electron').WebContents,
      sessionMessages,
      browserService: browser,
    });

    // user message + assistant tool_use + user tool_result + assistant final
    expect(sessionMessages.length).toBe(4);
    expect(sessionMessages[0].role).toBe('user');
    expect(sessionMessages[1].role).toBe('assistant');
    expect(sessionMessages[2].role).toBe('user');
    expect(sessionMessages[3].role).toBe('assistant');
  });

  it('uses streaming path (no create) when browserService is not provided', async () => {
    const wc = makeWebContents();

    const streamObj = {
      on: vi.fn((event: string, cb: (arg: string) => void) => {
        if (event === 'text') cb('Hello!');
      }),
      finalMessage: vi.fn().mockResolvedValue({}),
    };
    mockStream.mockReturnValue(streamObj);

    const result = await streamAnthropicChat({
      ...BASE_PARAMS,
      webContents: wc as unknown as import('electron').WebContents,
      sessionMessages: [],
      // No browserService
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockStream).toHaveBeenCalled();
    expect(result.response).toBe('Hello!');
  });
});

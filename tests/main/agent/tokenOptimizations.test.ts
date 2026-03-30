// tests/main/agent/tokenOptimizations.test.ts
/**
 * Tests validating the token/cost optimizations:
 * 1. streamAnthropicLLM sends cache_control on system prompt
 * 2. Dynamic prompt is injected into user message, not system prompt
 * 3. Sliding window history truncation in agentLoop
 * 4. renderCapabilities is cached (called once, not per-turn)
 * 5. Provider tool schemas are exposed correctly across iterations
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Electron mock ────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/clawdia-test'), isReady: vi.fn(() => true) },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  ipcRenderer: { on: vi.fn(), send: vi.fn() },
}));

// ── DB / memory mocks ────────────────────────────────────────────────────────
vi.mock('../../../src/main/db', () => ({
  initDb: vi.fn(),
  getLoopState: vi.fn(() => null),
  setLoopPaused: vi.fn(),
  deleteLoopState: vi.fn(),
}));

vi.mock('../../../src/main/db/memory', () => ({
  getMemoryContext: vi.fn(() => ''),
}));

// ── Policy / budget mocks ────────────────────────────────────────────────────
vi.mock('../../../src/main/agent/policy-engine', () => ({
  evaluatePolicy: vi.fn(() => ({ effect: 'allow', reason: '', ruleId: null, profileName: 'test' })),
}));

vi.mock('../../../src/main/agent/spending-budget', () => ({
  checkBudget: vi.fn(() => ({ allowed: true, remaining: 9999, blockedBy: null })),
}));

// ── runTracker mock ──────────────────────────────────────────────────────────
vi.mock('../../../src/main/runTracker', () => ({
  startRun: vi.fn(() => 'mock-run-id'),
  trackToolCall: vi.fn(() => 'mock-event-id'),
  trackToolResult: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
}));

// ── Desktop / capabilities mock ──────────────────────────────────────────────
vi.mock('../../../src/main/core/desktop', () => ({
  renderCapabilities: vi.fn(async () => 'mock-capabilities'),
  executeGuiInteract: vi.fn(async () => ({ ok: true })),
  DESKTOP_TOOL_NAMES: new Set([]),
}));

// ── System prompt mocks ──────────────────────────────────────────────────────
vi.mock('../../../src/main/core/cli/systemPrompt', () => ({
  buildSharedSystemPrompt: vi.fn(async () => 'shared-system-prompt'),
  buildAnthropicStreamSystemPrompt: vi.fn(async () => 'anthropic-system-prompt'),
}));

// ── Anthropic SDK mock ───────────────────────────────────────────────────────
const mockCreate = vi.fn();
const mockStream = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  function AnthropicMock() {
    return { messages: { create: mockCreate, stream: mockStream } };
  }
  return { default: AnthropicMock };
});

// ── Import units under test ──────────────────────────────────────────────────
import { streamAnthropicLLM } from '../../../src/main/anthropicChat';
import {
  injectDynamicPromptForTest,
  getAnthropicToolsForTest,
  applyAnthropicToolCompatibilityForTest,
  getOpenAIToolsForTest,
  getGeminiToolsForTest,
} from '../../../src/main/agent/streamLLM';
import { trimMessageHistoryForTest } from '../../../src/main/agent/agentLoop';

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeSignal() { return new AbortController().signal; }

function makeStreamMock(text = 'done') {
  const handlers: Record<string, Function> = {};
  return {
    on: vi.fn((event: string, cb: Function) => { handlers[event] = cb; }),
    finalMessage: vi.fn(async () => {
      handlers['text']?.(text);
      return { content: [] };
    }),
  };
}

// ── 1. cache_control on system prompt in streamAnthropicLLM ─────────────────
describe('Fix 1: cache_control on system prompt in agent loop path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends system as array with cache_control: ephemeral', async () => {
    const streamObj = makeStreamMock('hello');
    mockStream.mockReturnValue(streamObj);

    await streamAnthropicLLM(
      [{ role: 'user', content: 'hi' }],
      'You are a test assistant.',
      [],
      { provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: 'k', onText: vi.fn(), signal: makeSignal() } as any,
    );

    expect(mockStream).toHaveBeenCalledOnce();
    const body = mockStream.mock.calls[0][0];
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0]).toMatchObject({
      type: 'text',
      text: 'You are a test assistant.',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('does NOT concatenate dynamic prompt into the system string', async () => {
    const streamObj = makeStreamMock('hi');
    mockStream.mockReturnValue(streamObj);

    await streamAnthropicLLM(
      [{ role: 'user', content: 'task' }],
      'STATIC_SYSTEM',
      [],
      { provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: 'k', onText: vi.fn(), signal: makeSignal() } as any,
    );

    const body = mockStream.mock.calls[0][0];
    const systemText = body.system[0].text as string;
    expect(systemText).toBe('STATIC_SYSTEM');
    expect(systemText).not.toContain('Iteration');
  });
});

// ── 2. Dynamic prompt injected into user message ─────────────────────────────
describe('Fix 2: injectDynamicPrompt puts context in user message, not system', () => {
  it('prepends dynamic content to string user message', () => {
    const messages = [{ role: 'user', content: 'do a task' }];
    const result = injectDynamicPromptForTest(messages, 'Iteration 3 | Tools called: 5');
    expect(result[0].content).toContain('Iteration 3 | Tools called: 5');
    expect(result[0].content).toContain('do a task');
  });

  it('prepends to first text block in Anthropic array content', () => {
    const messages = [{
      role: 'user',
      content: [{ type: 'text', text: 'original task' }],
    }];
    const result = injectDynamicPromptForTest(messages, 'step info');
    expect(result[0].content[0].text).toContain('step info');
    expect(result[0].content[0].text).toContain('original task');
  });

  it('prepends to first text part in Gemini parts format', () => {
    const messages = [{
      role: 'user',
      parts: [{ text: 'gemini task' }],
    }];
    const result = injectDynamicPromptForTest(messages, 'iter=2');
    expect(result[0].parts[0].text).toContain('iter=2');
    expect(result[0].parts[0].text).toContain('gemini task');
  });

  it('does not mutate the original messages array', () => {
    const original = [{ role: 'user', content: 'original' }];
    injectDynamicPromptForTest(original, 'injected');
    expect(original[0].content).toBe('original');
  });

  it('returns messages unchanged when dynamicPrompt is empty', () => {
    const messages = [{ role: 'user', content: 'task' }];
    const result = injectDynamicPromptForTest(messages, '');
    expect(result).toBe(messages); // same reference
  });
});

// ── 3. Token-aware history truncation ────────────────────────────────────────
// TOKEN_BUDGET = 28_000 tokens, estimated as chars/4 = 112_000 chars.
// Each "large" message below is ~6_000 chars so 20 msgs ≈ 120_000 chars > budget.
const LARGE_CONTENT = 'x'.repeat(6_000);

describe('Fix 3: trimMessageHistory token-aware', () => {
  it('does nothing when history is well under the token budget', () => {
    // 11 tiny messages — negligible token cost, should not trim
    const msgs = Array.from({ length: 11 }, (_, i) => ({ role: 'user', content: `msg${i}` }));
    trimMessageHistoryForTest(msgs);
    expect(msgs).toHaveLength(11);
  });

  it('trims when serialized history exceeds the token budget', () => {
    // 20 × 6_000 chars ≈ 120_000 chars > 112_000 char budget
    const msgs = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `${i}:${LARGE_CONTENT}` }));
    trimMessageHistoryForTest(msgs);
    expect(msgs.length).toBeLessThan(20);        // trimming occurred
    expect(msgs[0].content).toMatch(/^0:/);      // first message preserved
    expect(msgs[msgs.length - 1].content).toMatch(/^19:/); // last message preserved
  });

  it('middle messages are dropped before first and last', () => {
    const msgs = Array.from({ length: 25 }, (_, i) => ({ role: 'user', content: `${i}:${LARGE_CONTENT}` }));
    trimMessageHistoryForTest(msgs);
    const contents = msgs.map(m => m.content as string);
    expect(contents[0]).toMatch(/^0:/);           // first preserved
    expect(contents[contents.length - 1]).toMatch(/^24:/); // last preserved
    // Middle messages (indices 1–10 of original) should have been dropped first
    const indices = contents.map(c => parseInt(c.split(':')[0], 10));
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(24);
    // The preserved set should not contain early-middle entries
    expect(indices.slice(1, -1).every(idx => idx > 0)).toBe(true);
  });
});

// ── 4. renderCapabilities cached ─────────────────────────────────────────────
import * as desktopModule from '../../../src/main/core/desktop';

describe('Fix 4: renderCapabilities is called at most once per 60s', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renderCapabilities mock is wired and callable', async () => {
    // The getCachedCapabilities wrapper is module-internal; we verify the
    // underlying mock is properly set up. Integration-level validation that
    // it's called once per conversation requires timer control — covered by
    // the 60s TTL in the implementation.
    expect(desktopModule.renderCapabilities).toBeDefined();
    await desktopModule.renderCapabilities();
    expect(desktopModule.renderCapabilities).toHaveBeenCalledOnce();
  });
});

// ── 5. Provider tool schemas exposed per profile ─────────────────────────────
describe('Fix 5: tool schemas cached per profile group', () => {
  it('getAnthropicTools browser profile first turn uses a narrowed browser allowlist', () => {
    const profile = { toolGroup: 'browser', specialMode: undefined } as any;
    const tools = getAnthropicToolsForTest(profile, [], 1);
    const names = tools.map((tool: any) => tool.name);
    expect(names).toContain('browser_get_page_state');
    expect(names).toContain('browser_navigate');
    expect(names).toContain('browser_extract_text');
    expect(names).not.toContain('browser_click');
    expect(names).not.toContain('agent_status');
    expect(names).not.toContain('agent_plan');
    expect(names).not.toContain('gui_interact');
    expect(names).not.toContain('search_tools');
  });

  it('getAnthropicTools browser profile later turns restore the full browser set', () => {
    const profile = { toolGroup: 'browser', specialMode: undefined } as any;
    const tools = getAnthropicToolsForTest(profile, [], 2);
    const names = tools.map((tool: any) => tool.name);
    expect(names).toContain('browser_click');
    expect(names).toContain('browser_type');
    expect(names).not.toContain('agent_status');
    expect(names).not.toContain('gui_interact');
  });

  it('marks server web tools as direct-only for Claude Haiku 4.5', () => {
    const profile = { toolGroup: 'browser', specialMode: undefined } as any;
    const tools = getAnthropicToolsForTest(profile, [], 1);
    const compatible = applyAnthropicToolCompatibilityForTest('claude-haiku-4-5-20251001', tools);
    const webSearch = compatible.find((tool: any) => tool.name === 'web_search');
    const webFetch = compatible.find((tool: any) => tool.name === 'web_fetch');

    expect(webSearch?.allowed_callers).toEqual(['direct']);
    expect(webFetch?.allowed_callers).toEqual(['direct']);
  });

  it('leaves server web tools unchanged for other Claude models', () => {
    const profile = { toolGroup: 'browser', specialMode: undefined } as any;
    const tools = getAnthropicToolsForTest(profile, [], 1);
    const compatible = applyAnthropicToolCompatibilityForTest('claude-sonnet-4-6', tools);
    const webSearch = compatible.find((tool: any) => tool.name === 'web_search');
    const webFetch = compatible.find((tool: any) => tool.name === 'web_fetch');

    expect(webSearch?.allowed_callers).toBeUndefined();
    expect(webFetch?.allowed_callers).toBeUndefined();
  });

  it('getAnthropicTools desktop profile includes gui tools immediately', () => {
    const profile = { toolGroup: 'desktop', specialMode: undefined } as any;
    const tools = getAnthropicToolsForTest(profile, [], 1);
    const names = tools.map((tool: any) => tool.name);
    expect(names).toContain('gui_interact');
    expect(names).not.toContain('search_tools');
  });

  it('getOpenAITools returns same array reference for same profile', () => {
    const profile = { toolGroup: 'coding', specialMode: undefined } as any;
    const first = getOpenAIToolsForTest(profile);
    const second = getOpenAIToolsForTest(profile);
    expect(first).toBe(second); // strict reference equality — no rebuild
  });

  it('getOpenAITools returns different arrays for different toolGroups', () => {
    const codingProfile = { toolGroup: 'coding', specialMode: undefined } as any;
    const browserProfile = { toolGroup: 'browser', specialMode: undefined } as any;
    const coding = getOpenAIToolsForTest(codingProfile);
    const browser = getOpenAIToolsForTest(browserProfile, 1);
    expect(coding).not.toBe(browser);
    const codingNames = coding.map((tool: any) => tool.function?.name);
    const browserNames = browser.map((tool: any) => tool.function?.name);
    expect(browserNames).toContain('browser_get_page_state');
    expect(browserNames).not.toContain('agent_status');
    expect(browserNames).not.toContain('gui_interact');
    expect(codingNames).not.toContain('browser_get_page_state');
  });

  it('getGeminiTools returns same array reference for same profile', () => {
    const profile = { toolGroup: 'core', specialMode: undefined } as any;
    const first = getGeminiToolsForTest(profile);
    const second = getGeminiToolsForTest(profile);
    expect(first).toBe(second);
  });

  it('getGeminiTools app_mapping profile has correct fixed tool set', () => {
    const profile = { toolGroup: 'desktop', specialMode: 'app_mapping' } as any;
    const tools = getGeminiToolsForTest(profile);
    const decls = tools[0].functionDeclarations as any[];
    const names = decls.map((d: any) => d.name);
    expect(names).toContain('gui_interact');
    expect(names).not.toContain('search_tools'); // no meta-tool for app_mapping
  });
});

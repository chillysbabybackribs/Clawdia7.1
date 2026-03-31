import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/main/db', () => ({
  setLoopPaused: vi.fn(),
  deleteLoopState: vi.fn(),
}));

vi.mock('../../../src/main/agent/streamLLM', () => ({
  streamLLM: vi.fn(),
}));

vi.mock('../../../src/main/agent/dispatch', () => ({
  dispatch: vi.fn(),
}));

vi.mock('../../../src/main/agent/recovery', () => ({
  verifyOutcomes: vi.fn(() => null),
}));

vi.mock('../../../src/main/agent/spending-budget', () => ({
  checkBudget: vi.fn(() => ({ allowed: true, remaining: 9999, blockedBy: null })),
}));

import { agentLoop } from '../../../src/main/agent/agentLoop';
import { streamLLM } from '../../../src/main/agent/streamLLM';
import { dispatch } from '../../../src/main/agent/dispatch';

const mockStreamLLM = vi.mocked(streamLLM);
const mockDispatch = vi.mocked(dispatch);

describe('browser completion heuristic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forces a no-tools final answer after enough visible page text is extracted', async () => {
    mockDispatch.mockImplementation(async (toolBlocks: any[], ctx: any) => {
      const results = toolBlocks.map((block) => {
        if (block.name === 'browser_get_page_state') {
          return JSON.stringify({
            url: 'https://example.com/research/browser-agents',
            title: 'Browser Agents Research',
            textSample: 'Research notes on browser agents and automation tools.',
          });
        }

        if (block.name === 'browser_extract_text') {
          return JSON.stringify({
            text: 'AI browser agents automate website navigation, clicking, typing, extraction, and summarization. '
              + 'Representative tools include Browser Use, Playwright-based agents, and operator-style assistants. '
              + 'They are commonly used for web research, QA, scraping with guardrails, and multi-step workflows that '
              + 'read visible page content before deciding what to do next. Strong systems combine planning, browser control, '
              + 'page-state inspection, and structured result synthesis so they can stop once the page already contains enough evidence.',
            truncated: false,
          });
        }

        return JSON.stringify({ ok: true });
      });

      for (let i = 0; i < toolBlocks.length; i++) {
        ctx.allToolCalls.push({
          id: toolBlocks[i].id,
          name: toolBlocks[i].name,
          input: toolBlocks[i].input,
          result: results[i],
        });
      }
      ctx.toolCallCount += toolBlocks.length;

      return { results, discoveredTools: [] };
    });

    mockStreamLLM
      .mockResolvedValueOnce({
        text: '',
        toolBlocks: [{ id: 'call-1', name: 'browser_get_page_state', input: {} }],
      })
      .mockResolvedValueOnce({
        text: '',
        toolBlocks: [{ id: 'call-2', name: 'browser_extract_text', input: {} }],
      })
      .mockImplementationOnce(async (...args: any[]) => (
        args[6] === 'none'
          ? {
              text: 'AI browser agents can navigate, extract, and summarize page data.',
              toolBlocks: [],
            }
          : {
              text: '',
              toolBlocks: [{ id: 'call-3', name: 'browser_get_page_state', input: {} }],
            }
      ));

    const result = await agentLoop(
      'research AI browser agents on a website',
      [],
      {
        provider: 'anthropic',
        apiKey: 'test-key',
        model: 'claude-haiku-4-5',
        runId: 'run-test-browser-complete',
        signal: new AbortController().signal,
        onText: vi.fn(),
        onThinking: vi.fn(),
        forcedProfile: {
          toolGroup: 'browser',
          modelTier: 'powerful',
          isGreeting: false,
        },
      },
    );

    expect(result).toContain('AI browser agents');
    expect(mockDispatch).toHaveBeenCalledTimes(2);
    expect(mockStreamLLM).toHaveBeenCalledTimes(3);
    expect(mockStreamLLM.mock.calls[2][6]).toBe('none');
  });
});

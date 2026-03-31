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

import { agentLoop } from '../../../src/main/agent/agentLoop';
import { streamLLM } from '../../../src/main/agent/streamLLM';
import { dispatch } from '../../../src/main/agent/dispatch';

const mockStreamLLM = vi.mocked(streamLLM);
const mockDispatch = vi.mocked(dispatch);

describe('unrestricted mode browser policy bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not block browser_screenshot in the same turn as browser_navigate when unrestricted mode is enabled', async () => {
    mockDispatch.mockImplementation(async (toolBlocks: any[], ctx: any) => {
      const results = toolBlocks.map((block) => {
        if (block.name === 'browser_navigate') {
          return JSON.stringify({
            tabId: 't1',
            url: 'https://example.com',
            title: 'Example',
            isLoading: false,
            textSample: 'Example page',
            canGoBack: false,
            canGoForward: false,
          });
        }

        if (block.name === 'browser_screenshot') {
          return JSON.stringify({
            type: 'base64',
            mimeType: 'image/png',
            data: 'ZmFrZQ==',
            width: 800,
            height: 600,
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
        toolBlocks: [
          { id: 'call-1', name: 'browser_navigate', input: { url: 'https://example.com' } },
          { id: 'call-2', name: 'browser_screenshot', input: {} },
        ],
      })
      .mockResolvedValueOnce({
        text: 'Navigation and screenshot both executed.',
        toolBlocks: [],
      });

    const result = await agentLoop(
      'open a page and grab a screenshot',
      [],
      {
        provider: 'anthropic',
        apiKey: 'test-key',
        model: 'claude-haiku-4-5',
        runId: 'run-test-unrestricted-browser-policy',
        signal: new AbortController().signal,
        unrestrictedMode: true,
        onText: vi.fn(),
        onThinking: vi.fn(),
        forcedProfile: {
          toolGroup: 'browser',
          modelTier: 'powerful',
          isGreeting: false,
        },
      },
    );

    expect(result).toContain('Navigation and screenshot both executed.');
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch.mock.calls[0][0]).toHaveLength(2);
  });
});

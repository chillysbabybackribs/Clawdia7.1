import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/clawdia-test'),
    isReady: vi.fn(() => true),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  ipcRenderer: { on: vi.fn(), send: vi.fn() },
}));

vi.mock('../../src/main/agent/spending-budget', () => ({
  checkBudget: vi.fn(() => ({ allowed: true, remaining: 9999, blockedBy: null })),
}));

vi.mock('../../src/main/core/desktop', () => ({
  renderCapabilities: vi.fn(async () => null),
  executeGuiInteract: vi.fn(async () => ({ ok: true })),
  DESKTOP_TOOL_NAMES: new Set([]),
}));

vi.mock('../../src/main/core/cli/systemPrompt', () => ({
  buildSharedSystemPrompt: vi.fn(async () => 'You are a helpful assistant.'),
}));

vi.mock('../../src/main/runTracker', () => ({
  startRun: vi.fn(() => 'mock-run-id'),
  trackToolCall: vi.fn(() => 'mock-event-id'),
  trackToolResult: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
}));

const mockCreate = vi.fn();

vi.mock('openai', () => {
  function OpenAIMock() {
    return {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    };
  }

  return { default: OpenAIMock };
});

import { streamOpenAIChat } from '../../src/main/openaiChat';

function makeWebContents() {
  return {
    isDestroyed: () => false,
    send: vi.fn(),
  };
}

function makeStream(chunks: any[] = []) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    },
  };
}

describe('streamOpenAIChat protocol repair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue(makeStream([
      { choices: [{ delta: { content: 'Recovered.' } }] },
    ]));
  });

  it('repairs stale tool history before sending OpenAI messages', async () => {
    const wc = makeWebContents();

    await streamOpenAIChat({
      webContents: wc as any,
      apiKey: 'test-key',
      modelRegistryId: 'gpt-4.1',
      userText: 'continue',
      sessionMessages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'shell_exec', arguments: '{}' } }],
        } as any,
      ],
      signal: new AbortController().signal,
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const body = mockCreate.mock.calls[0][0];
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a helpful assistant.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'shell_exec', arguments: '{}' } }],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: JSON.stringify({
          status: 'interrupted',
          reason: 'protocol_repair',
          message: 'Tool run was interrupted before completion.',
        }),
      },
      { role: 'user', content: 'continue' },
    ]);
  });
});

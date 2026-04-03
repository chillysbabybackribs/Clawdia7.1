import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runClaudeCodeMock,
  runCodexCliMock,
  agentLoopMock,
  getConversationMock,
} = vi.hoisted(() => ({
  runClaudeCodeMock: vi.fn(),
  runCodexCliMock: vi.fn(),
  agentLoopMock: vi.fn(),
  getConversationMock: vi.fn(),
}));

vi.mock('../../../../src/main/claudeCodeClient', () => ({
  runClaudeCode: runClaudeCodeMock,
}));

vi.mock('../../../../src/main/codexCliClient', () => ({
  runCodexCli: runCodexCliMock,
}));

vi.mock('../../../../src/main/agent/agentLoop', () => ({
  agentLoop: agentLoopMock,
}));

vi.mock('../../../../src/main/settingsStore', () => ({
  loadSettings: vi.fn(() => ({
    provider: 'openai',
    providerKeys: {
      openai: 'test-openai-key',
      anthropic: 'test-anthropic-key',
      gemini: '',
    },
    models: {
      openai: 'gpt-5.4',
      anthropic: 'claude-sonnet-4-6',
      gemini: 'gemini-2.5-flash',
    },
    unrestrictedMode: false,
  })),
}));

vi.mock('../../../../src/main/runTracker', () => ({
  registerRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
}));

vi.mock('../../../../src/main/taskTracker', () => ({
  linkRunToTask: vi.fn(),
}));

vi.mock('../../../../src/main/db', () => ({
  getConversation: getConversationMock,
  updateConversation: vi.fn(),
}));

import { runConcurrent } from '../../../../src/main/core/executors/ConcurrentExecutor';

describe('ConcurrentExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConversationMock.mockReturnValue({ claude_code_session_id: 'parent-claude-session' });
    runClaudeCodeMock.mockResolvedValue({ finalText: 'Claude output', sessionId: 'cc-session' });
    runCodexCliMock.mockResolvedValue({ finalText: 'Codex output', sessionId: 'cdx-session' });
    agentLoopMock.mockResolvedValue('Synthesized output');
  });

  it('implements claude_primary_codex_review as a real sequential strategy', async () => {
    const result = await runConcurrent({
      conversationId: 'conv-1',
      taskId: 'task-1',
      prompt: 'Audit the implementation and identify risks.',
      strategy: 'claude_primary_codex_review',
      synthesize: true,
      signal: new AbortController().signal,
      onText: () => {},
    });

    expect(runClaudeCodeMock).toHaveBeenCalledTimes(1);
    expect(runCodexCliMock).toHaveBeenCalledTimes(1);
    expect(agentLoopMock).toHaveBeenCalledTimes(1);

    expect(runClaudeCodeMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1-cc-t1',
      prompt: 'Audit the implementation and identify risks.',
      persistedSessionId: 'parent-claude-session',
    }));

    expect(runCodexCliMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1-cdx-t2',
      prompt: expect.stringContaining('[Dependency context]'),
    }));
    expect(runCodexCliMock.mock.calls[0][0].prompt).toContain('Claude output');

    expect(agentLoopMock.mock.calls[0][0]).toContain('Claude output');
    expect(agentLoopMock.mock.calls[0][0]).toContain('Codex output');
    expect(result.finalText).toBe('Synthesized output');
    expect(result.synthesized).toBe(true);
  });

  it('passes dependency outputs into downstream worker prompts in planner mode', async () => {
    const plan = {
      goal: 'Review a change',
      subtasks: [
        {
          id: 't1',
          executor: 'claudeCode',
          label: 'Primary pass',
          prompt: 'Do the primary pass.',
          dependsOn: [],
        },
        {
          id: 't2',
          executor: 'codex',
          label: 'Secondary review',
          prompt: 'Review the upstream result.',
          dependsOn: ['t1'],
        },
      ],
      synthesisHint: 'Merge the outputs.',
    };

    agentLoopMock
      .mockImplementationOnce(async (_prompt: string, _attachments: unknown[], opts: { onText: (delta: string) => void }) => {
        const json = JSON.stringify(plan);
        opts.onText(json);
        return json;
      })
      .mockResolvedValueOnce('Synthesized output');

    await runConcurrent({
      conversationId: 'conv-2',
      taskId: 'task-2',
      prompt: 'Please inspect this change carefully.',
      strategy: 'parallel',
      synthesize: true,
      signal: new AbortController().signal,
      onText: () => {},
    });

    expect(runClaudeCodeMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-2-cc-t1',
      prompt: 'Do the primary pass.',
    }));
    expect(runCodexCliMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-2-cdx-t2',
      prompt: expect.stringContaining('[Dependency context]'),
    }));
    expect(runCodexCliMock.mock.calls[0][0].prompt).toContain('Dependency: t1');
    expect(runCodexCliMock.mock.calls[0][0].prompt).toContain('Claude output');
  });
});

// tests/main/claudeCodeClient.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process.spawn
const mockStdout = new EventEmitter() as any;
const mockStderr = new EventEmitter() as any;
const mockChild = new EventEmitter() as any;
mockChild.stdout = mockStdout;
mockChild.stderr = mockStderr;
mockChild.stdin = { write: vi.fn(), end: vi.fn() };

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockChild),
}));

vi.mock('../../src/main/mcpBridge', () => ({
  getClaudeMcpConfigPath: vi.fn(async () => '/tmp/clawdia-claude-mcp-test.json'),
}));

import { spawn } from 'child_process';
import { buildClaudeCodePrompt, runClaudeCode, clearSessions } from '../../src/main/claudeCodeClient';

beforeEach(() => {
  clearSessions();
  vi.clearAllMocks();
  // Re-attach mocks after clear
  (spawn as any).mockReturnValue(mockChild);
  mockChild.stdin = { write: vi.fn(), end: vi.fn() };
});

describe('runClaudeCode', () => {
  it('buildClaudeCodePrompt injects runtime guidance for coding tasks', () => {
    const prompt = buildClaudeCodePrompt('audit the gemini implementation and fix the response path');
    expect(prompt).toContain('RUNTIME GUIDANCE');
    expect(prompt).toContain('Situational Context');
    expect(prompt).toContain('ACTIVE SKILLS');
    expect(prompt).toContain('[User task]');
  });

  it('spawns claude with required flags', async () => {
    const promise = runClaudeCode({ conversationId: 'conv-1', prompt: 'hello', onText: () => {} });
    await Promise.resolve();
    mockStdout.emit('data', Buffer.from(''));
    mockChild.emit('close', 0);
    await promise;

    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('claude'),
      expect.arrayContaining([
        '--print',
        '--output-format', 'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--input-format', 'text',
        '--mcp-config', '/tmp/clawdia-claude-mcp-test.json',
      ]),
      expect.any(Object),
    );
    // Prompt should NOT be in args
    const callArgs = (spawn as any).mock.calls[0][1] as string[];
    expect(callArgs).not.toContain('hello');
  });

  it('only passes --dangerously-skip-permissions when explicitly enabled', async () => {
    process.env.CLAUDE_SKIP_PERMISSIONS = '1';
    try {
      const promise = runClaudeCode({ conversationId: 'conv-1', prompt: 'hello', onText: () => {} });
      await Promise.resolve();
      mockStdout.emit('data', Buffer.from(''));
      mockChild.emit('close', 0);
      await promise;

      const callArgs = (spawn as any).mock.calls[0][1] as string[];
      expect(callArgs).toContain('--dangerously-skip-permissions');
    } finally {
      delete process.env.CLAUDE_SKIP_PERMISSIONS;
    }
  });

  it('calls onText for each assistant text chunk', async () => {
    const chunks: string[] = [];
    const promise = runClaudeCode({
      conversationId: 'conv-1',
      prompt: 'hello',
      onText: (t) => chunks.push(t),
    });
    await Promise.resolve();

    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hi there' }], stop_reason: 'end_turn' },
    });
    mockStdout.emit('data', Buffer.from(line + '\n'));
    mockChild.emit('close', 0);
    await promise;

    expect(chunks).toContain('Hi there');
  });

  it('writes the compiled runtime-guided prompt to stdin', async () => {
    const promise = runClaudeCode({
      conversationId: 'conv-1',
      prompt: 'audit the gemini implementation',
      onText: () => {},
    });
    await Promise.resolve();
    mockStdout.emit('data', Buffer.from(''));
    mockChild.emit('close', 0);
    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith(expect.stringContaining('RUNTIME GUIDANCE'));
    expect(mockChild.stdin.write).toHaveBeenCalledWith(expect.stringContaining('[User task]'));
  });

  it('stores session_id and passes --resume on second call', async () => {
    // First call — no resume
    const p1 = runClaudeCode({ conversationId: 'conv-1', prompt: 'first', onText: () => {} });
    await Promise.resolve();
    const resultLine = JSON.stringify({ type: 'result', session_id: 'sess-abc', result: 'done' });
    mockStdout.emit('data', Buffer.from(resultLine + '\n'));
    mockChild.emit('close', 0);
    await p1;

    // Second call — should resume
    const p2 = runClaudeCode({ conversationId: 'conv-1', prompt: 'second', onText: () => {} });
    await Promise.resolve();
    mockStdout.emit('data', Buffer.from(''));
    mockChild.emit('close', 0);
    await p2;

    const secondCallArgs = (spawn as any).mock.calls[1][1] as string[];
    expect(secondCallArgs).toContain('--resume');
    expect(secondCallArgs).toContain('sess-abc');
  });

  it('does not pass --resume for a new conversationId', async () => {
    const p1 = runClaudeCode({ conversationId: 'conv-1', prompt: 'first', onText: () => {} });
    await Promise.resolve();
    const resultLine = JSON.stringify({ type: 'result', session_id: 'sess-abc', result: 'done' });
    mockStdout.emit('data', Buffer.from(resultLine + '\n'));
    mockChild.emit('close', 0);
    await p1;

    const p2 = runClaudeCode({ conversationId: 'conv-NEW', prompt: 'hi', onText: () => {} });
    await Promise.resolve();
    mockStdout.emit('data', Buffer.from(''));
    mockChild.emit('close', 0);
    await p2;

    const secondCallArgs = (spawn as any).mock.calls[1][1] as string[];
    expect(secondCallArgs).not.toContain('--resume');
  });

  it('rejects when claude exits with non-zero code', async () => {
    const promise = runClaudeCode({ conversationId: 'conv-1', prompt: 'hello', onText: () => {} });
    await Promise.resolve();
    mockChild.emit('close', 1);
    await expect(promise).rejects.toThrow();
  });

  it('falls back to result text when no assistant message produced text', async () => {
    const chunks: string[] = [];
    const promise = runClaudeCode({
      conversationId: 'conv-1',
      prompt: 'hello',
      onText: (t) => chunks.push(t),
    });
    await Promise.resolve();

    const resultLine = JSON.stringify({
      type: 'result',
      session_id: 'sess-xyz',
      result: 'Fallback response text',
    });
    mockStdout.emit('data', Buffer.from(resultLine + '\n'));
    mockChild.emit('close', 0);
    const result = await promise;

    expect(result.finalText).toBe('Fallback response text');
  });

  it('returns finalText and sessionId in the result', async () => {
    const promise = runClaudeCode({ conversationId: 'conv-1', prompt: 'hello', onText: () => {} });
    await Promise.resolve();

    const assistantLine = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'The answer' }], stop_reason: 'end_turn' },
    });
    const resultLine = JSON.stringify({ type: 'result', session_id: 'sess-ret', result: '' });
    mockStdout.emit('data', Buffer.from(assistantLine + '\n' + resultLine + '\n'));
    mockChild.emit('close', 0);
    const result = await promise;

    expect(result.finalText).toBe('The answer');
    expect(result.sessionId).toBe('sess-ret');
  });
});

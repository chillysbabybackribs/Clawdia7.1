// tests/main/claudeCodeClient.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process.spawn
const mockStdout = new EventEmitter() as any;
const mockStderr = new EventEmitter() as any;
const mockChild = new EventEmitter() as any;
mockChild.stdout = mockStdout;
mockChild.stderr = mockStderr;

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockChild),
}));

import { spawn } from 'child_process';
import { runClaudeCode, clearSessions } from '../../src/main/claudeCodeClient';

beforeEach(() => {
  clearSessions();
  vi.clearAllMocks();
  // Re-attach mocks after clear
  (spawn as any).mockReturnValue(mockChild);
});

describe('runClaudeCode', () => {
  it('spawns claude with required flags', async () => {
    const promise = runClaudeCode({ conversationId: 'conv-1', prompt: 'hello', onText: () => {} });
    mockStdout.emit('data', Buffer.from(''));
    mockChild.emit('close', 0);
    await promise;

    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('claude'),
      expect.arrayContaining([
        '--print',
        '--dangerously-skip-permissions',
        '--output-format', 'stream-json',
        '--include-partial-messages',
        'hello',
      ]),
      expect.any(Object),
    );
  });

  it('calls onText for each assistant text chunk', async () => {
    const chunks: string[] = [];
    const promise = runClaudeCode({
      conversationId: 'conv-1',
      prompt: 'hello',
      onText: (t) => chunks.push(t),
    });

    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hi there' }], stop_reason: 'end_turn' },
    });
    mockStdout.emit('data', Buffer.from(line + '\n'));
    mockChild.emit('close', 0);
    await promise;

    expect(chunks).toContain('Hi there');
  });

  it('stores session_id and passes --resume on second call', async () => {
    // First call — no resume
    const p1 = runClaudeCode({ conversationId: 'conv-1', prompt: 'first', onText: () => {} });
    const resultLine = JSON.stringify({ type: 'result', session_id: 'sess-abc', result: 'done' });
    mockStdout.emit('data', Buffer.from(resultLine + '\n'));
    mockChild.emit('close', 0);
    await p1;

    // Second call — should resume
    const p2 = runClaudeCode({ conversationId: 'conv-1', prompt: 'second', onText: () => {} });
    mockStdout.emit('data', Buffer.from(''));
    mockChild.emit('close', 0);
    await p2;

    const secondCallArgs = (spawn as any).mock.calls[1][1] as string[];
    expect(secondCallArgs).toContain('--resume');
    expect(secondCallArgs).toContain('sess-abc');
  });

  it('does not pass --resume for a new conversationId', async () => {
    const p1 = runClaudeCode({ conversationId: 'conv-1', prompt: 'first', onText: () => {} });
    const resultLine = JSON.stringify({ type: 'result', session_id: 'sess-abc', result: 'done' });
    mockStdout.emit('data', Buffer.from(resultLine + '\n'));
    mockChild.emit('close', 0);
    await p1;

    const p2 = runClaudeCode({ conversationId: 'conv-NEW', prompt: 'hi', onText: () => {} });
    mockStdout.emit('data', Buffer.from(''));
    mockChild.emit('close', 0);
    await p2;

    const secondCallArgs = (spawn as any).mock.calls[1][1] as string[];
    expect(secondCallArgs).not.toContain('--resume');
  });

  it('rejects when claude exits with no output', async () => {
    const promise = runClaudeCode({ conversationId: 'conv-1', prompt: 'hello', onText: () => {} });
    mockChild.emit('close', 1);
    await expect(promise).rejects.toThrow();
  });
});

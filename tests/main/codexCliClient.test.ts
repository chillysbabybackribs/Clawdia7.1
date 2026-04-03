import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as os from 'os';

process.env.CLAWDIA_DB_PATH_OVERRIDE = path.join(os.tmpdir(), `clawdia-codex-test-${Date.now()}.sqlite`);

const mockStdout = new EventEmitter() as any;
const mockStderr = new EventEmitter() as any;
const mockChild = new EventEmitter() as any;
mockStdout.setMaxListeners(0);
mockStderr.setMaxListeners(0);
mockChild.setMaxListeners(0);
mockChild.stdout = mockStdout;
mockChild.stderr = mockStderr;
mockChild.stdin = { write: vi.fn(), end: vi.fn() };

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockChild),
}));

vi.mock('../../src/main/mcpBridge', () => ({
  getCodexMcpConfigArgs: vi.fn(async () => ['-c', 'mcp_servers.clawdia.url="http://127.0.0.1:9999/mcp/test"']),
}));

vi.mock('../../src/main/settingsStore', () => ({
  loadSettings: vi.fn(() => ({ providerKeys: { openai: 'test-key' } })),
}));

import { spawn } from 'child_process';
import { initDb } from '../../src/main/db';
import { buildCodexPrompt, clearCodexSessions, runCodexCli } from '../../src/main/codexCliClient';

beforeEach(() => {
  initDb();
  clearCodexSessions();
  vi.clearAllMocks();
  mockStdout.removeAllListeners();
  mockStderr.removeAllListeners();
  mockChild.removeAllListeners();
  (spawn as any).mockReturnValue(mockChild);
  mockChild.stdin = { write: vi.fn(), end: vi.fn() };
});

describe('runCodexCli', () => {
  it('buildCodexPrompt returns the original prompt when no runtime guidance is available', () => {
    const prompt = buildCodexPrompt('audit the codex implementation and improve performance');
    expect(prompt).toContain('audit the codex implementation');
  });

  it('spawns codex exec in json mode', async () => {
    const promise = runCodexCli({ conversationId: 'conv-1', prompt: 'hello', onText: () => {} });
    await Promise.resolve();
    mockStdout.emit('data', Buffer.from(''));
    mockChild.emit('close', 0);
    await promise;

    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('codex'),
      ['-c', 'mcp_servers.clawdia.url="http://127.0.0.1:9999/mcp/test"', 'exec', '--dangerously-bypass-approvals-and-sandbox', '--json', '-'],
      expect.any(Object),
    );
  });

  it('writes the prompt to stdin', async () => {
    const promise = runCodexCli({
      conversationId: 'conv-1',
      prompt: 'audit the codex implementation',
      onText: () => {},
    });
    await Promise.resolve();
    mockStdout.emit('data', Buffer.from(''));
    mockChild.emit('close', 0);
    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith(expect.stringContaining('audit the codex implementation'));
  });

  it('emits completed agent messages via onText', async () => {
    const chunks: string[] = [];
    const promise = runCodexCli({
      conversationId: 'conv-1',
      prompt: 'hello',
      onText: (text) => chunks.push(text),
    });
    await Promise.resolve();

    mockStdout.emit('data', Buffer.from(
      `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' })}\n`
      + `${JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'Hi there' } })}\n`,
    ));
    mockChild.emit('close', 0);

    const result = await promise;
    expect(chunks).toEqual(['Hi there']);
    expect(result.finalText).toBe('Hi there');
    expect(result.sessionId).toBe('thread-1');
  });

  it('emits non-message item lifecycle as tool activity', async () => {
    const activities: any[] = [];
    const promise = runCodexCli({
      conversationId: 'conv-1',
      prompt: 'hello',
      onText: () => {},
      onToolActivity: (activity) => activities.push(activity),
    });
    await Promise.resolve();

    mockStdout.emit('data', Buffer.from(
      `${JSON.stringify({ type: 'item.started', item: { id: 'item_tool_1', type: 'exec_command', command: 'npm test' } })}\n`
      + `${JSON.stringify({ type: 'item.completed', item: { id: 'item_tool_1', type: 'exec_command', command: 'npm test', output: 'ok' } })}\n`,
    ));
    mockChild.emit('close', 0);

    await promise;
    expect(activities).toHaveLength(2);
    expect(activities[0]).toMatchObject({
      id: 'item_tool_1',
      name: 'codex_exec_command',
      status: 'running',
      detail: 'npm test',
    });
    expect(activities[1]).toMatchObject({
      id: 'item_tool_1',
      name: 'codex_exec_command',
      status: 'success',
      detail: 'npm test',
      output: 'ok',
    });
  });

  it('streams updated agent_message text incrementally', async () => {
    const chunks: string[] = [];
    const promise = runCodexCli({
      conversationId: 'conv-1',
      prompt: 'hello',
      onText: (text) => chunks.push(text),
    });
    await Promise.resolve();

    mockStdout.emit('data', Buffer.from(
      `${JSON.stringify({ type: 'item.updated', item: { id: 'item_msg_1', type: 'agent_message', text: 'Planning' } })}\n`
      + `${JSON.stringify({ type: 'item.updated', item: { id: 'item_msg_1', type: 'agent_message', text: 'Planning changes' } })}\n`
      + `${JSON.stringify({ type: 'item.completed', item: { id: 'item_msg_1', type: 'agent_message', text: 'Planning changes' } })}\n`,
    ));
    mockChild.emit('close', 0);

    const result = await promise;
    expect(chunks).toEqual(['Planning', ' changes']);
    expect(result.finalText).toBe('Planning changes');
  });

  it('stores thread id and resumes on the next call', async () => {
    const p1 = runCodexCli({ conversationId: 'conv-1', prompt: 'first', onText: () => {} });
    await Promise.resolve();
    mockStdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'thread.started', thread_id: 'thread-abc' })}\n`));
    mockChild.emit('close', 0);
    await p1;

    const p2 = runCodexCli({ conversationId: 'conv-1', prompt: 'second', onText: () => {} });
    await Promise.resolve();
    mockStdout.emit('data', Buffer.from(''));
    mockChild.emit('close', 0);
    await p2;

    expect((spawn as any).mock.calls[1][1]).toEqual(['-c', 'mcp_servers.clawdia.url="http://127.0.0.1:9999/mcp/test"', 'exec', '--dangerously-bypass-approvals-and-sandbox', '--json', 'resume', 'thread-abc', '-']);
  });

  it('does not resume across different conversations', async () => {
    const p1 = runCodexCli({ conversationId: 'conv-1', prompt: 'first', onText: () => {} });
    await Promise.resolve();
    mockStdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'thread.started', thread_id: 'thread-abc' })}\n`));
    mockChild.emit('close', 0);
    await p1;

    const p2 = runCodexCli({ conversationId: 'conv-2', prompt: 'second', onText: () => {} });
    await Promise.resolve();
    mockStdout.emit('data', Buffer.from(''));
    mockChild.emit('close', 0);
    await p2;

    expect((spawn as any).mock.calls[1][1]).toEqual(['-c', 'mcp_servers.clawdia.url="http://127.0.0.1:9999/mcp/test"', 'exec', '--dangerously-bypass-approvals-and-sandbox', '--json', '-']);
  });

  it('rejects when codex exits with non-zero code', async () => {
    const promise = runCodexCli({ conversationId: 'conv-1', prompt: 'hello', onText: () => {} });
    await Promise.resolve();
    mockChild.emit('close', 1);
    await expect(promise).rejects.toThrow(/codex exited with code/);
  });
});

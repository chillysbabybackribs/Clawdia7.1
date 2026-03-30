import { describe, expect, it } from 'vitest';
import {
  findPendingAnthropicToolUseIds,
  normalizeAnthropicMessages,
  validateAnthropicMessages,
} from '../../../../src/main/core/providers/anthropicMessageProtocol';

describe('anthropicMessageProtocol', () => {
  it('keeps a valid assistant tool_use -> user tool_result pair intact', () => {
    const messages = [
      { role: 'user', content: 'task' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu-1', name: 'shell_exec', input: { command: 'pwd' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }] },
    ];

    const repair = normalizeAnthropicMessages(messages);
    expect(repair.messages).toEqual(messages);
    expect(repair.repaired).toBe(false);
    expect(validateAnthropicMessages(repair.messages)).toEqual([]);
  });

  it('drops orphaned tool_result blocks with no matching previous assistant tool_use', () => {
    const repair = normalizeAnthropicMessages([
      { role: 'user', content: 'task' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'stale-tu', content: 'stale' }] },
    ]);

    expect(repair.repaired).toBe(true);
    expect(repair.messages).toEqual([{ role: 'user', content: 'task' }]);
    expect(validateAnthropicMessages(repair.messages)).toEqual([]);
  });

  it('inserts synthetic tool_result blocks when a pending tool_use is followed by a normal user turn', () => {
    const repair = normalizeAnthropicMessages([
      { role: 'user', content: 'task' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu-1', name: 'shell_exec', input: { command: 'pwd' } }] },
      { role: 'user', content: 'next question' },
    ], {
      closePendingToolUses: true,
      pendingToolUseReason: 'session_recovery',
    });

    expect(repair.messages).toEqual([
      { role: 'user', content: 'task' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu-1', name: 'shell_exec', input: { command: 'pwd' } }] },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tu-1',
          content: JSON.stringify({
            status: 'interrupted',
            reason: 'session_recovery',
            message: 'Tool run was interrupted before completion.',
          }),
        }],
      },
      { role: 'user', content: 'next question' },
    ]);
    expect(validateAnthropicMessages(repair.messages)).toEqual([]);
  });

  it('splits mixed user content so tool_result blocks stay isolated', () => {
    const repair = normalizeAnthropicMessages([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu-1', name: 'shell_exec', input: { command: 'pwd' } }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' },
          { type: 'text', text: 'follow-up' },
        ],
      },
    ]);

    expect(repair.messages).toEqual([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu-1', name: 'shell_exec', input: { command: 'pwd' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }] },
      { role: 'user', content: [{ type: 'text', text: 'follow-up' }] },
    ]);
    expect(validateAnthropicMessages(repair.messages)).toEqual([]);
  });

  it('reports the last pending tool_use ids using immediate-pair semantics', () => {
    const pending = findPendingAnthropicToolUseIds([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu-old', name: 'shell_exec', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-old', content: 'ok' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu-new', name: 'shell_exec', input: {} }] },
    ]);

    expect(pending).toEqual(['tu-new']);
  });
});

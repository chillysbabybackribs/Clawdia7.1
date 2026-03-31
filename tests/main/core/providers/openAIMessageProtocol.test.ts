import { describe, expect, it } from 'vitest';
import {
  normalizeOpenAIMessages,
  prepareOpenAIMessagesForSend,
  validateOpenAIMessages,
} from '../../../../src/main/core/providers/openAIMessageProtocol';

describe('openAIMessageProtocol', () => {
  it('keeps a valid assistant tool_calls -> tool pair intact', () => {
    const messages = [
      { role: 'user', content: 'task' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'shell_exec', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
    ];

    const repair = normalizeOpenAIMessages(messages);
    expect(repair.repaired).toBe(false);
    expect(repair.messages).toEqual(messages);
    expect(validateOpenAIMessages(repair.messages)).toEqual([]);
  });

  it('drops orphaned tool messages', () => {
    const repair = normalizeOpenAIMessages([
      { role: 'user', content: 'task' },
      { role: 'tool', tool_call_id: 'stale_call', content: 'stale' },
    ]);

    expect(repair.repaired).toBe(true);
    expect(repair.messages).toEqual([{ role: 'user', content: 'task' }]);
    expect(validateOpenAIMessages(repair.messages)).toEqual([]);
  });

  it('inserts synthetic tool messages when a pending tool_call is skipped', () => {
    const repair = normalizeOpenAIMessages([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'shell_exec', arguments: '{}' } }],
      },
      { role: 'user', content: 'next question' },
    ]);

    expect(repair.messages).toEqual([
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
      { role: 'user', content: 'next question' },
    ]);
    expect(validateOpenAIMessages(repair.messages)).toEqual([]);
  });

  it('validates correctly when multiple tool messages follow one assistant tool_calls message', () => {
    const messages = [
      { role: 'user', content: 'task' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'tool_a', arguments: '{}' } },
          { id: 'call_2', type: 'function', function: { name: 'tool_b', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'result_a' },
      { role: 'tool', tool_call_id: 'call_2', content: 'result_b' },
    ];

    const repair = normalizeOpenAIMessages(messages);
    expect(repair.repaired).toBe(false);
    expect(repair.messages).toEqual(messages);
    expect(validateOpenAIMessages(repair.messages)).toEqual([]);
  });

  it('pre-flights a stale assistant tool_call into a valid request payload', () => {
    const repair = prepareOpenAIMessagesForSend([
      { role: 'user', content: 'task' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'shell_exec', arguments: '{}' } }],
      },
    ]);

    expect(repair.messages).toEqual([
      { role: 'user', content: 'task' },
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
    ]);
  });
});

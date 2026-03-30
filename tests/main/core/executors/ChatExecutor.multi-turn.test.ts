/**
 * Multi-turn loop smoke test for ChatExecutor.
 *
 * Verifies that the executor actually runs multiple tool-call turns before
 * producing a final response, and that tool results are fed back to the
 * provider each turn.
 */

import { describe, it, expect, vi } from 'vitest';
import { ChatExecutor } from '../../../../src/main/core/executors/ChatExecutor';
import type { CapabilityBroker } from '../../../../src/main/core/capabilities/CapabilityBroker';
import type { ProviderClient, ProviderTurnRequest, ProviderTurnResult } from '../../../../src/main/core/providers/ProviderClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssistantToolUse(toolName: string, toolId: string, input: Record<string, unknown> = {}) {
  return {
    role: 'assistant' as const,
    content: [{ type: 'tool_use', id: toolId, name: toolName, input }],
  };
}

function makeAssistantText(text: string) {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text', text }],
  };
}

function makeBroker(resultData: unknown = 'ok'): CapabilityBroker {
  return {
    execute: vi.fn().mockResolvedValue({
      ok: true,
      domain: 'fs',
      action: 'read_file',
      environment: { environmentId: 'e', executorMode: 'local_workspace', stateScope: 'local', persistenceScope: 'persistent' },
      data: resultData,
      metadata: { surface: 'structured_service', verification: 'basic', cacheHit: false },
    }),
  } as unknown as CapabilityBroker;
}

/** Build a provider that replays a fixed sequence of turns. */
function makeSequentialProvider(turns: ProviderTurnResult[]): ProviderClient & { calls: ProviderTurnRequest[] } {
  let idx = 0;
  const calls: ProviderTurnRequest[] = [];
  return {
    providerId: 'anthropic' as const,
    calls,
    runTurn: vi.fn(async (req: ProviderTurnRequest): Promise<ProviderTurnResult> => {
      calls.push(req);
      const result = turns[idx];
      idx += 1;
      console.log(`[mock provider] turn ${idx} → stopReason=${result.stopReason} toolCalls=${result.toolCalls.length} text="${result.text.slice(0, 60)}"`);
      return result;
    }),
  } as unknown as ProviderClient & { calls: ProviderTurnRequest[] };
}

function waitForCompletion(executor: ChatExecutor, runId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    executor.subscribe(runId, (event) => {
      if (event.type === 'run_completed') resolve((event as any).output);
      if (event.type === 'run_failed') reject(new Error((event as any).error));
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatExecutor multi-turn loop', () => {
  it('runs TWO tool-call turns before producing a final response', async () => {
    const broker = makeBroker('file contents here');

    // Turn 1: model calls fs_read_file
    const turn1: ProviderTurnResult = {
      assistantMessage: makeAssistantToolUse('fs_read_file', 'tc-1', { path: '/tmp/foo.txt' }),
      text: '',
      toolCalls: [{ id: 'tc-1', name: 'fs_read_file', input: { path: '/tmp/foo.txt' } }],
      stopReason: 'tool_use',
    };

    // Turn 2: model calls shell_exec after seeing the file result
    const turn2: ProviderTurnResult = {
      assistantMessage: makeAssistantToolUse('shell_exec', 'tc-2', { command: 'echo done' }),
      text: '',
      toolCalls: [{ id: 'tc-2', name: 'shell_exec', input: { command: 'echo done' } }],
      stopReason: 'tool_use',
    };

    // Turn 3: final text response
    const turn3: ProviderTurnResult = {
      assistantMessage: makeAssistantText('All done after two tool calls.'),
      text: 'All done after two tool calls.',
      toolCalls: [],
      stopReason: 'end_turn',
    };

    const provider = makeSequentialProvider([turn1, turn2, turn3]);
    const executor = new ChatExecutor(broker, provider);

    const request = {
      runId: 'run-multi-1',
      conversationId: 'conv-1',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      input: 'Read /tmp/foo.txt then run echo done',
      history: [],
    };

    const handle = await executor.startRun(request);
    const output = await waitForCompletion(executor, handle.runId);

    console.log(`[test] final output: "${output}"`);
    console.log(`[test] provider called ${provider.calls.length} times`);
    console.log(`[test] broker called ${(broker.execute as any).mock.calls.length} times`);

    // Provider must have been called 3 times (2 tool turns + 1 final)
    expect(provider.calls.length).toBe(3);

    // Broker must have been called twice (once per tool)
    expect((broker.execute as any).mock.calls.length).toBe(2);

    // Turn 2 request must include tool_result from turn 1.
    // At call time the array had: [user-input, assistant-tool_use, user-tool_result]
    // (the executor mutates in place so by assertion time it may be longer — find by type)
    const turn2Messages = provider.calls[1].messages;
    console.log(`[test] turn2 messages at call time (${turn2Messages.length}):`, JSON.stringify(turn2Messages, null, 2));
    const toolResultMsg = turn2Messages.find(
      (m) => m.role === 'user' && (m.content as any[]).some((b: any) => b.type === 'tool_result'),
    );
    expect(toolResultMsg).toBeDefined();
    const resultBlock = (toolResultMsg!.content as any[]).find((b: any) => b.type === 'tool_result');
    expect(resultBlock.tool_use_id).toBe('tc-1');

    expect(output).toBe('All done after two tool calls.');
  });

  it('exits on first turn when model returns text immediately (no tools)', async () => {
    const broker = makeBroker();

    const turn1: ProviderTurnResult = {
      assistantMessage: makeAssistantText('Simple answer.'),
      text: 'Simple answer.',
      toolCalls: [],
      stopReason: 'end_turn',
    };

    const provider = makeSequentialProvider([turn1]);
    const executor = new ChatExecutor(broker, provider);

    const handle = await executor.startRun({
      runId: 'run-simple',
      conversationId: 'conv-2',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      input: 'What is 2+2?',
      history: [],
    });

    const output = await waitForCompletion(executor, handle.runId);
    console.log(`[test] single-turn output: "${output}"`);

    expect(provider.calls.length).toBe(1);
    expect((broker.execute as any).mock.calls.length).toBe(0);
    expect(output).toBe('Simple answer.');
  });

  it('feeds tool results back — second turn messages contain tool_result block', async () => {
    const broker = makeBroker({ content: 'hello world' });

    const turn1: ProviderTurnResult = {
      assistantMessage: makeAssistantToolUse('fs_read_file', 'tc-feed-1', { path: '/tmp/test.txt' }),
      text: '',
      toolCalls: [{ id: 'tc-feed-1', name: 'fs_read_file', input: { path: '/tmp/test.txt' } }],
      stopReason: 'tool_use',
    };

    const turn2: ProviderTurnResult = {
      assistantMessage: makeAssistantText('Got the file.'),
      text: 'Got the file.',
      toolCalls: [],
      stopReason: 'end_turn',
    };

    const provider = makeSequentialProvider([turn1, turn2]);
    const executor = new ChatExecutor(broker, provider);

    const handle = await executor.startRun({
      runId: 'run-feed',
      conversationId: 'conv-3',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      input: 'Read /tmp/test.txt',
      history: [],
    });

    await waitForCompletion(executor, handle.runId);

    const turn2Messages = provider.calls[1].messages;
    console.log(`[test] turn 2 message count: ${turn2Messages.length}`);
    console.log(`[test] turn 2 messages:`, JSON.stringify(turn2Messages, null, 2));

    // Messages must include: user input, assistant tool_use, user tool_result
    // (array mutated in-place so length may be 4 by assertion time — find by content)
    const toolResultMsg = turn2Messages.find(
      (m) => m.role === 'user' && (m.content as any[]).some((b: any) => b.type === 'tool_result'),
    );
    expect(toolResultMsg).toBeDefined();
    const block = (toolResultMsg!.content as any[])[0];
    expect(block.type).toBe('tool_result');
    expect(block.tool_use_id).toBe('tc-feed-1');
  });

  it('repairs stale anthropic tool history before calling the provider', async () => {
    const broker = makeBroker();

    const turn1: ProviderTurnResult = {
      assistantMessage: makeAssistantText('Recovered.'),
      text: 'Recovered.',
      toolCalls: [],
      stopReason: 'end_turn',
    };

    const provider = makeSequentialProvider([turn1]);
    const executor = new ChatExecutor(broker, provider);

    const handle = await executor.startRun({
      runId: 'run-stale-history',
      conversationId: 'conv-stale',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      input: 'continue',
      history: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'stale-tu', name: 'shell_exec', input: { command: 'pwd' } }] },
      ],
    });

    await waitForCompletion(executor, handle.runId);

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'stale-tu', name: 'shell_exec', input: { command: 'pwd' } }],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'stale-tu',
          content: JSON.stringify({
            status: 'interrupted',
            reason: 'protocol_repair',
            message: 'Tool run was interrupted before completion.',
          }),
        }],
      },
      { role: 'user', content: [{ type: 'text', text: 'continue' }] },
    ]);
  });
});

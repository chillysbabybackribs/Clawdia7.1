/**
 * ChatExecutor — drives the multi-turn agentic loop for a single chat run.
 *
 * Responsibilities:
 *  1. Build the initial message list from history + user input.
 *  2. Call the ProviderClient for each turn.
 *  3. If the model returns tool_use, dispatch tool calls through the CapabilityBroker
 *     and feed results back as tool_result messages.
 *  4. Repeat until the model returns end_turn (or max turns is reached).
 *  5. Emit run_completed / run_failed events to subscribers.
 */

import type { CapabilityBroker } from '../capabilities/CapabilityBroker';
import type { ProviderClient, ProviderTurnRequest, ProviderTurnResult } from '../providers/ProviderClient';
import { normalizeAnthropicMessages, validateAnthropicMessages } from '../providers/anthropicMessageProtocol';
import { normalizeOpenAIMessages, validateOpenAIMessages } from '../providers/openAIMessageProtocol';

// ─── Event types ──────────────────────────────────────────────────────────────

export interface RunCompletedEvent {
  type: 'run_completed';
  runId: string;
  output: string;
}

export interface RunFailedEvent {
  type: 'run_failed';
  runId: string;
  error: string;
}

export interface ToolCalledEvent {
  type: 'tool_called';
  runId: string;
  toolName: string;
  toolId: string;
}

export interface ToolResultEvent {
  type: 'tool_result';
  runId: string;
  toolId: string;
  result: unknown;
}

export type RunEvent = RunCompletedEvent | RunFailedEvent | ToolCalledEvent | ToolResultEvent;

// ─── StartRun request/handle ─────────────────────────────────────────────────

export interface StartRunRequest {
  runId: string;
  conversationId: string;
  providerId: string;
  modelId: string;
  input: string;
  history: Array<{ role: string; content: unknown }>;
}

export interface RunHandle {
  runId: string;
}

// ─── ChatExecutor ─────────────────────────────────────────────────────────────

const MAX_TOOL_TURNS = 50;

export class ChatExecutor {
  private readonly broker: CapabilityBroker;
  private readonly provider: ProviderClient;
  private readonly subscribers = new Map<string, Array<(event: RunEvent) => void>>();
  /** Buffer of past events so late subscribers still receive them. */
  private readonly eventBuffers = new Map<string, RunEvent[]>();

  constructor(broker: CapabilityBroker, provider: ProviderClient) {
    this.broker = broker;
    this.provider = provider;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Start an asynchronous run. Returns immediately with a handle containing the runId.
   * Subscribe to events via `subscribe()` to track progress.
   */
  async startRun(request: StartRunRequest): Promise<RunHandle> {
    // Initialise the event buffer for this run.
    this.eventBuffers.set(request.runId, []);

    // Kick off the loop in the background — don't await here.
    this._runLoop(request).catch((err) => {
      this._emit(request.runId, {
        type: 'run_failed',
        runId: request.runId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return { runId: request.runId };
  }

  /**
   * Subscribe to events for a given run.
   * If events have already been emitted (e.g. the run completed before subscribe
   * was called), they are replayed synchronously to the callback.
   */
  subscribe(runId: string, callback: (event: RunEvent) => void): void {
    // Replay any buffered events first.
    const buffered = this.eventBuffers.get(runId) ?? [];
    for (const event of buffered) {
      callback(event);
    }

    const existing = this.subscribers.get(runId) ?? [];
    existing.push(callback);
    this.subscribers.set(runId, existing);
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private _emit(runId: string, event: RunEvent): void {
    // Buffer the event for late subscribers.
    const buf = this.eventBuffers.get(runId);
    if (buf) buf.push(event);

    const callbacks = this.subscribers.get(runId) ?? [];
    for (const cb of callbacks) {
      cb(event);
    }
  }

  private async _runLoop(request: StartRunRequest): Promise<void> {
    const { runId, conversationId, providerId, modelId, input, history } = request;

    // Build initial message list: history + new user message.
    // Always wrap the user text in a content-block array so downstream code
    // can safely call Array.prototype methods on every message's content.
    const messages: Array<{ role: string; content: unknown }> = [
      ...history,
      { role: 'user', content: [{ type: 'text', text: input }] },
    ];

    let finalText = '';
    let turns = 0;

    while (turns < MAX_TOOL_TURNS) {
      turns++;

      const turnRequest: ProviderTurnRequest = {
        runId,
        conversationId,
        providerId,
        modelId,
        input,
        messages: messages as ProviderTurnRequest['messages'],
        history: history as ProviderTurnRequest['history'],
      };

      if (providerId === 'anthropic') {
        const repair = normalizeAnthropicMessages(turnRequest.messages as any[], {
          closePendingToolUses: true,
          pendingToolUseReason: 'protocol_repair',
        });
        const errors = validateAnthropicMessages(repair.messages as any[]);
        if (errors.length > 0) {
          console.warn(`[ChatExecutor] Anthropic message protocol issues (auto-repaired): ${errors.join(' | ')}`);
        }
        turnRequest.messages = repair.messages as ProviderTurnRequest['messages'];
      } else if (providerId === 'openai') {
        const repair = normalizeOpenAIMessages(turnRequest.messages as any[]);
        const errors = validateOpenAIMessages(repair.messages as any[]);
        if (errors.length > 0) {
          console.warn(`[ChatExecutor] OpenAI message protocol issues (auto-repaired): ${errors.join(' | ')}`);
        }
        turnRequest.messages = repair.messages as ProviderTurnRequest['messages'];
      }

      const result: ProviderTurnResult = await this.provider.runTurn(turnRequest);

      // Append the assistant's response to the message list
      messages.push(result.assistantMessage);

      if (result.stopReason !== 'tool_use' || result.toolCalls.length === 0) {
        // Done — no more tool calls
        finalText = result.text;
        break;
      }

      // Execute each tool call and collect results
      const toolResultContents: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];

      for (const toolCall of result.toolCalls) {
        this._emit(runId, {
          type: 'tool_called',
          runId,
          toolName: toolCall.name,
          toolId: toolCall.id,
        });

        const capResult = await this.broker.execute(toolCall.name, toolCall.input);
        const resultText = typeof capResult.data === 'string'
          ? capResult.data
          : JSON.stringify(capResult.data);

        this._emit(runId, {
          type: 'tool_result',
          runId,
          toolId: toolCall.id,
          result: capResult,
        });

        toolResultContents.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: resultText,
        });
      }

      // Append tool results as a user message so the model sees them next turn
      messages.push({ role: 'user', content: toolResultContents });
    }

    this._emit(runId, {
      type: 'run_completed',
      runId,
      output: finalText,
    });
  }
}

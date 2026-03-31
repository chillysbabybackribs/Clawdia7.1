import Anthropic from '@anthropic-ai/sdk';
import type { ToolUseBlock, LLMTurn, LoopOptions } from './agent/types';
import {
  prepareAnthropicMessagesForSend,
  prepareAnthropicRequestBodyForSend,
} from './core/providers/anthropicMessageProtocol';

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

const ANTHROPIC_MAX_RETRIES = 3;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('AbortError'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function getAnthropicRequestId(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const requestId = (err as { request_id?: unknown }).request_id;
  return typeof requestId === 'string' ? requestId : null;
}

function isRetryableAnthropicError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as { status?: unknown }).status;
  const code = (err as { code?: unknown }).code;
  if (typeof status === 'number' && status >= 500) return true;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED') return true;
  return err.name === 'InternalServerError' || err.name === 'APIConnectionError' || err.name === 'APIConnectionTimeoutError';
}

function formatAnthropicError(err: unknown): Error {
  if (err instanceof Error) {
    const requestId = getAnthropicRequestId(err);
    if (requestId && !err.message.includes(requestId)) {
      return new Error(`${err.message} (request_id: ${requestId})`);
    }
    return err;
  }
  return new Error(String(err));
}

async function withAnthropicRetry<T>(
  work: () => Promise<T>,
  signal: AbortSignal | undefined,
  label: string,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= ANTHROPIC_MAX_RETRIES; attempt++) {
    try {
      return await work();
    } catch (err) {
      lastErr = err;
      if ((err as Error)?.name === 'AbortError' || !isRetryableAnthropicError(err) || attempt === ANTHROPIC_MAX_RETRIES) {
        throw formatAnthropicError(err);
      }
      const requestId = getAnthropicRequestId(err);
      console.warn(
        `[anthropic] transient ${label} failure on attempt ${attempt}/${ANTHROPIC_MAX_RETRIES}`
          + `${requestId ? ` request_id=${requestId}` : ''}: ${(err as Error).message}`,
      );
      await sleep(400 * attempt, signal);
    }
  }
  throw formatAnthropicError(lastErr);
}

// ---------------------------------------------------------------------------
// streamAnthropicLLM — single-turn non-streaming call used by agentLoop
// ---------------------------------------------------------------------------

/**
 * Single-turn non-streaming call for use by agentLoop.
 * Returns text + tool_use blocks from one LLM response. Does NOT run a tool loop.
 *
 * Live path: ChatIpc.ts → agentLoop.ts → streamLLM.ts → streamAnthropicLLM()
 */
export async function streamAnthropicLLM(
  messages: Anthropic.MessageParam[],
  systemPrompt: string,
  tools: Anthropic.Tool[],
  options: LoopOptions,
): Promise<LLMTurn> {
  const client = new Anthropic({ apiKey: options.apiKey, timeout: 120_000 });

  // Filter out OpenAI-format tool messages (role: 'tool') which are invalid for Anthropic
  const anthropicMessages = prepareAnthropicMessagesForSend(
    (messages as any[]).filter((m: any) => m.role !== 'tool') as Anthropic.MessageParam[],
    {
      caller: 'streamAnthropicLLM',
      closePendingToolUses: true,
      pendingToolUseReason: 'protocol_repair',
      onRepair: (issues) => {
        console.warn(`[anthropic] pre-flight repaired single-turn request: ${issues.join(' | ')}`);
      },
    },
  ).messages as Anthropic.MessageParam[];

  const rawBody: Anthropic.MessageCreateParams = {
    model: options.model,
    max_tokens: 16000,
    messages: anthropicMessages,
    system: [
      {
        type: 'text' as const,
        text: systemPrompt,
        cache_control: { type: 'ephemeral' as const },
      },
    ] as any,
    tools: tools as Anthropic.Tool[],
    stream: true,
  };

  const body = prepareAnthropicRequestBodyForSend(rawBody, {
    caller: 'streamAnthropicLLM.body',
    closePendingToolUses: true,
    pendingToolUseReason: 'protocol_repair',
    onRepair: (issues) => {
      console.warn(`[anthropic] send wrapper repaired single-turn body: ${issues.join(' | ')}`);
    },
  });

  const stream = await withAnthropicRetry(
    async () => client.messages.stream(body, { signal: options.signal }),
    options.signal,
    'message.stream',
  );

  let text = '';
  const toolUseBlocks: Array<{ id: string; name: string; input: string }> = [];
  let currentToolId = '';
  let currentToolName = '';
  let currentToolInput = '';

  stream.on('text', (delta) => {
    text += delta;
    options.onText(delta);
  });

  stream.on('contentBlock', (block: any) => {
    if (block.type === 'tool_use') {
      if (currentToolId) {
        toolUseBlocks.push({ id: currentToolId, name: currentToolName, input: currentToolInput });
      }
      currentToolId = block.id;
      currentToolName = block.name;
      currentToolInput = '';
    }
  });

  stream.on('inputJson', (_delta: string, snapshot: unknown) => {
    currentToolInput = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
  });

  const finalMessage = await stream.finalMessage();

  // Cache hit instrumentation
  const usage = finalMessage.usage as any;
  if (usage?.cache_read_input_tokens > 0) {
    console.log(`[cache] HIT ${usage.cache_read_input_tokens} tokens read, ${usage.input_tokens} uncached`);
  } else if (usage?.cache_creation_input_tokens > 0) {
    console.log(`[cache] WRITE ${usage.cache_creation_input_tokens} tokens cached, ${usage.input_tokens} uncached`);
  }

  // Flush last tool if any
  if (currentToolId) {
    toolUseBlocks.push({ id: currentToolId, name: currentToolName, input: currentToolInput });
  }

  // Only return client-side tool_use blocks — server_tool_use blocks are handled
  // server-side by Anthropic and must not be dispatched locally.
  const finalToolUseBlocks = finalMessage.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const toolBlocks: ToolUseBlock[] = finalToolUseBlocks.map(b => ({
    id: b.id,
    name: b.name,
    input: b.input as Record<string, unknown>,
  }));

  return {
    text,
    toolBlocks,
    stopReason: finalMessage.stop_reason ?? undefined,
    rawContent: finalMessage.content as unknown[],
  };
}

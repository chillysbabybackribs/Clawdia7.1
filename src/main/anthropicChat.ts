import Anthropic from '@anthropic-ai/sdk';
import type { WebContents } from 'electron';
import * as fs from 'fs';
import { IPC_EVENTS } from './ipc-channels';
import type { MessageAttachment } from '../shared/types';
import { BROWSER_TOOLS, executeBrowserTool } from './core/cli/browserTools';
import { executeShellTool } from './core/cli/shellTools';
import type { BrowserService } from './core/browser/BrowserService';
import { truncateBrowserResult, truncateToolResult, SHELL_MAX } from './core/cli/truncate';
import { buildSharedSystemPrompt, buildAnthropicStreamSystemPrompt } from './core/cli/systemPrompt';
import { startRun, trackToolCall, trackToolResult, completeRun, failRun } from './runTracker';
import { evaluatePolicy } from './agent/policy-engine';
import { executeGuiInteract, DESKTOP_TOOL_NAMES, renderCapabilities } from './core/desktop';
import { getMemoryContext } from './db/memory';
import { checkBudget } from './agent/spending-budget';
import { executeMemoryStore, executeMemorySearch, executeMemoryForget } from './agent/memoryExecutors';
import { MEMORY_TOOLS } from './core/cli/memoryTools';
import type { ToolUseBlock, LLMTurn, LoopOptions } from './agent/types';
import {
  prepareAnthropicMessagesForSend,
  prepareAnthropicRequestBodyForSend,
} from './core/providers/anthropicMessageProtocol';

/** Anthropic API accepts the same model ids as the in-app registry (e.g. claude-sonnet-4-6). */
export function resolveAnthropicModelId(registryId: string): string {
  return registryId;
}

function buildUserContent(
  text: string,
  attachments?: MessageAttachment[],
): string | Anthropic.ContentBlockParam[] {
  if (!attachments?.length) return text;

  const blocks: Anthropic.ContentBlockParam[] = [];

  for (const a of attachments) {
    if (a.kind === 'image' && (a.dataUrl || a.path)) {
      let base64 = '';
      let mediaType = a.mimeType || 'image/png';
      if (a.dataUrl) {
        const m = a.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (m) {
          mediaType = m[1];
          base64 = m[2];
        }
      } else if (a.path) {
        try {
          base64 = fs.readFileSync(a.path).toString('base64');
        } catch {
          continue;
        }
      }
      if (base64) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: base64,
          },
        });
      }
    } else if (a.textContent) {
      blocks.push({ type: 'text', text: `[Attachment: ${a.name}]\n${a.textContent}` });
    }
  }

  blocks.push({ type: 'text', text });
  return blocks;
}

function modelSupportsExtendedThinking(apiModelId: string): boolean {
  return (
    apiModelId.includes('claude-opus-4')
    || apiModelId.includes('claude-sonnet-4')
    || apiModelId.includes('claude-3-7')
  );
}

type StreamParams = {
  webContents: WebContents;
  apiKey: string;
  modelRegistryId: string;
  userText: string;
  attachments?: MessageAttachment[];
  /** Prior turns; mutated on success with user + assistant messages */
  sessionMessages: Anthropic.MessageParam[];
  signal: AbortSignal;
  /** When provided, browser tools are enabled in the chat loop */
  browserService?: BrowserService;
  unrestrictedMode?: boolean;
  conversationId?: string;
};

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

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

async function executeToolCall(block: Anthropic.ToolUseBlock): Promise<string> {
  try {
    if (block.name === 'bash') {
      const { command } = block.input as { command: string };
      const { stdout, stderr } = await execAsync(command);
      return stdout || stderr || 'Command executed successfully with no output.';
    }
    if (block.name === 'str_replace_based_edit_tool') {
      const input = block.input as any;
      const cmd = input.command;
      const filePath = input.path;
      if (cmd === 'view') {
        return fs.readFileSync(filePath, 'utf-8');
      }
      if (cmd === 'create') {
        fs.writeFileSync(filePath, input.file_text, 'utf-8');
        return `File created at ${filePath}`;
      }
      if (cmd === 'str_replace') {
        const text = fs.readFileSync(filePath, 'utf-8');
        const count = text.split(input.old_str).length - 1;
        if (count === 0) return 'Error: old_str not found in file.';
        if (count > 1) return 'Error: old_str found multiple times.';
        fs.writeFileSync(filePath, text.replace(input.old_str, input.new_str), 'utf-8');
        return 'File updated successfully.';
      }
      return `Executed ${cmd} on ${filePath} (limited implementation).`;
    }
    return `Error: Unknown tool ${block.name}`;
  } catch (err: any) {
    return `Error executing tool: ${err.message}`;
  }
}

export async function streamAnthropicChat({
  webContents,
  apiKey,
  modelRegistryId,
  userText,
  attachments,
  sessionMessages,
  signal,
  browserService,
  unrestrictedMode = false,
  conversationId,
}: StreamParams): Promise<{ response: string; error?: string }> {
  const client = new Anthropic({ apiKey });
  const apiModelId = resolveAnthropicModelId(modelRegistryId);
  const runId = conversationId ? startRun(conversationId, 'anthropic', apiModelId) : null;
  const userContent = buildUserContent(userText, attachments);

  const userMessage: Anthropic.MessageParam = {
    role: 'user',
    content: userContent,
  };

  const sendThinking = (t: string) => {
    if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_THINKING, t);
  };
  const sendText = (chunk: string) => {
    if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, chunk);
  };

  sendThinking('Claude is thinking…');

  const tryThinking = modelSupportsExtendedThinking(apiModelId);

  const repairedSession = prepareAnthropicMessagesForSend(
    [...sessionMessages].filter((m: any) => m.role !== 'tool') as Anthropic.MessageParam[],
    {
      caller: 'streamAnthropicChat.session',
      closePendingToolUses: true,
      pendingToolUseReason: 'protocol_repair',
      onRepair: (issues) => {
        console.warn(`[anthropic] pre-flight repaired session history: ${issues.join(' | ')}`);
      },
    },
  ).messages as Anthropic.MessageParam[];
  // Inject memory context as a user/assistant preflight pair rather than
  // embedding it in the system prompt. This keeps the system prompt string
  // identical across every turn so Anthropic's prompt cache actually hits.
  const memCtx = getMemoryContext(userText);
  const messagesForRequest: Anthropic.MessageParam[] = [
    ...repairedSession,
    ...(memCtx ? [
      { role: 'user' as const, content: `[Memory context]\n${memCtx}` },
      { role: 'assistant' as const, content: 'Understood.' },
    ] : []),
    userMessage,
  ];

  const runStream = async (withThinking: boolean): Promise<string> => {
    const budget = checkBudget(1); // Check with 1 cent minimum
    if (!budget.allowed) {
      return `Budget exceeded: ${budget.periodLimit} cents limit reached for ${budget.blockedBy} period.`;
    }
    const caps = await renderCapabilities();
    const systemInstructions = buildAnthropicStreamSystemPrompt(unrestrictedMode) + (caps ? `\n\nOS CONTEXT:\n${caps}` : '');

    const safeMessages = prepareAnthropicMessagesForSend(messagesForRequest, {
      caller: 'streamAnthropicChat.stream',
      closePendingToolUses: true,
      pendingToolUseReason: 'protocol_repair',
      onRepair: (issues) => {
        console.warn(`[anthropic] pre-flight repaired stream request: ${issues.join(' | ')}`);
      },
    }).messages as Anthropic.MessageParam[];

    const rawBody: Anthropic.MessageCreateParams = {
      model: apiModelId,
      max_tokens: 16000,
      messages: safeMessages,
      system: [
        {
          type: 'text' as const,
          text: systemInstructions,
          cache_control: { type: 'ephemeral' as const },
        },
      ] as any,
      tools: [
        { type: 'bash_20250124', name: 'bash' } as any,
        { type: 'text_editor_20250728', name: 'str_replace_based_edit_tool', cache_control: { type: 'ephemeral' as const } } as any
      ],
    };

    if (withThinking && tryThinking) {
      (rawBody as any).thinking = { type: 'adaptive' };
    }

    const body = prepareAnthropicRequestBodyForSend(rawBody, {
      caller: 'streamAnthropicChat.stream.body',
      closePendingToolUses: true,
      pendingToolUseReason: 'protocol_repair',
      onRepair: (issues) => {
        console.warn(`[anthropic] send wrapper repaired stream body: ${issues.join(' | ')}`);
      },
    });

    const stream = await withAnthropicRetry(
      async () => client.messages.stream(body, { signal }),
      signal,
      'stream',
    );

    let fullText = '';
    let sawThinking = false;

    stream.on('text', (delta) => {
      fullText += delta;
      sendText(delta);
    });

    stream.on('thinking', (delta) => {
      const t = delta.trim();
      if (t) {
        sawThinking = true;
        // Extract a clean, short status line from raw reasoning text.
        // Take only the first sentence/line, strip markdown artifacts,
        // and cap length so the shimmer UI stays readable.
        const firstLine = t.split(/[\n\r]/)[0].replace(/^[-*>#]+\s*/, '').trim();
        const display = firstLine.length > 80
          ? firstLine.slice(0, 77) + '…'
          : firstLine;
        if (display) sendThinking(display);
      }
    });

    await stream.finalMessage();

    if (!sawThinking && !fullText) {
      sendThinking('Composing a reply…');
    }

    return fullText;
  };

  // Shell tools in Anthropic custom-tool format (always loaded, cached)
  const ANTHROPIC_SHELL_TOOLS: Anthropic.Tool[] = [
    {
      name: 'shell_exec',
      description: 'Execute a bash shell command on the local system.',
      input_schema: { type: 'object' as const, properties: { command: { type: 'string', description: 'The shell command to run.' } }, required: ['command'] },
    },
    {
      name: 'file_edit',
      description: 'Read and edit files. command: view|create|str_replace. path: file path. file_text: content for create. old_str/new_str: for str_replace.',
      input_schema: { type: 'object' as const, properties: { command: { type: 'string' }, path: { type: 'string' }, file_text: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['command', 'path'] },
    },
    {
      name: 'file_list_directory',
      description: 'List the contents of a directory. Returns structured JSON with name, type, and size.',
      input_schema: { type: 'object' as const, properties: { path: { type: 'string', description: 'Absolute directory path to list.' } }, required: ['path'] },
    },
    {
      name: 'file_search',
      description: 'Search for a pattern in files. Returns structured JSON matches with file, line, text.',
      input_schema: { type: 'object' as const, properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' } }, required: ['pattern'] },
    },
  ];

  /** Run one non-streaming tool-use turn and return the assistant message. */
  const runToolTurn = async (
    messages: Anthropic.MessageParam[],
  ): Promise<Anthropic.Message> => {
    const budget = checkBudget(1);
    if (!budget.allowed) {
      throw new Error(`Budget exceeded (${budget.blockedBy} limit)`);
    }
    // Shell tools are always loaded (small, always needed).
    // Browser tools are deferred — model searches via tool_search_tool_bm25.
    // defer_loading and cache_control are mutually exclusive per Anthropic API.
    const deferredBrowserTools = BROWSER_TOOLS.map(t => ({ ...t, defer_loading: true }));

    const caps = await renderCapabilities();
    const systemInstruction = buildSharedSystemPrompt(unrestrictedMode) + (caps ? `\n\nOS CONTEXT:\n${caps}` : '');

    const safeMessages = prepareAnthropicMessagesForSend(messages, {
      caller: 'streamAnthropicChat.toolTurn',
      closePendingToolUses: true,
      pendingToolUseReason: 'protocol_repair',
      onRepair: (issues) => {
        console.warn(`[anthropic] pre-flight repaired tool-turn request: ${issues.join(' | ')}`);
      },
    }).messages as Anthropic.MessageParam[];

    const rawBody: Anthropic.MessageCreateParams = {
      model: apiModelId,
      max_tokens: 16000,
      messages: safeMessages,
      system: systemInstruction,
      tools: [
        { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' } as any,
        ...ANTHROPIC_SHELL_TOOLS.map((t, i) =>
          i === ANTHROPIC_SHELL_TOOLS.length - 1
            ? { ...t, cache_control: { type: 'ephemeral' as const } }
            : t
        ),
        ...MEMORY_TOOLS,
        ...deferredBrowserTools,
      ] as any,
    };
    const body = prepareAnthropicRequestBodyForSend(rawBody, {
      caller: 'streamAnthropicChat.toolTurn.body',
      closePendingToolUses: true,
      pendingToolUseReason: 'protocol_repair',
      onRepair: (issues) => {
        console.warn(`[anthropic] send wrapper repaired tool-turn body: ${issues.join(' | ')}`);
      },
    });
    return withAnthropicRetry(
      async () => client.messages.create(body, { signal }),
      signal,
      'message.create',
    );
  };

  const SHELL_TOOL_NAMES = new Set(['shell_exec', 'file_edit', 'file_list_directory', 'file_search']);
  const MEMORY_TOOL_NAMES = new Set(['memory_store', 'memory_search', 'memory_forget']);

  /** Execute tool calls from an assistant message and return tool_result blocks. */
  const executeTools = async (
    toolUseBlocks: Anthropic.ToolUseBlock[],
    browser: BrowserService,
  ): Promise<Anthropic.ToolResultBlockParam[]> => {
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const startMs = Date.now();
      let resultContent: string;
      let isError = false;
      console.log(`[tool] ${block.name}`, JSON.stringify(block.input).slice(0, 120));
      const argsSummary = JSON.stringify(block.input).slice(0, 120);
      const eventId = runId ? trackToolCall(runId, block.name, argsSummary) : '';

      // ── Policy gate ──────────────────────────────────────────────────────
      const decision = evaluatePolicy(
        block.name,
        block.input as Record<string, unknown>,
        { runId: runId ?? undefined },
      );

      if (decision.effect === 'deny') {
        resultContent = `[POLICY DENIED] ${decision.reason} (rule: ${decision.ruleId ?? 'none'}, profile: ${decision.profileName})`;
        isError = true;
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
            id: block.id,
            name: block.name,
            status: 'error',
            detail: resultContent,
            durationMs: 0,
            policyDenied: true,
          });
        }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: resultContent, is_error: true });
        continue;
      }

      if (decision.effect === 'require_approval') {
        // Surface to renderer — the model is told the action requires user approval and was held.
        // In a future iteration this will await an approval IPC response; for now it blocks with a
        // clear message that the user must approve the action in the UI.
        resultContent = `[POLICY HELD] This action requires your approval: ${decision.reason}. ` +
          `Tool "${block.name}" was not executed. You can approve it manually or change the policy profile in Settings.`;
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
            id: block.id,
            name: block.name,
            status: 'error',
            detail: `Requires approval: ${decision.reason}`,
            durationMs: 0,
            policyHeld: true,
          });
        }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: resultContent });
        continue;
      }
      // ── End policy gate ──────────────────────────────────────────────────

      if (!webContents.isDestroyed()) {
        webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
          id: block.id,
          name: block.name,
          status: 'running',
          detail: argsSummary,
          input: JSON.stringify(block.input, null, 2),
        });
      }

      try {
        if (SHELL_TOOL_NAMES.has(block.name)) {
          resultContent = await executeShellTool(block.name, block.input as Record<string, unknown>);
        } else if (DESKTOP_TOOL_NAMES.has(block.name)) {
          resultContent = await executeGuiInteract(block.input as Record<string, unknown>);
        } else if (MEMORY_TOOL_NAMES.has(block.name)) {
          if (block.name === 'memory_store') {
            resultContent = executeMemoryStore(block.input as Record<string, unknown>);
          } else if (block.name === 'memory_search') {
            resultContent = executeMemorySearch(block.input as Record<string, unknown>);
          } else {
            resultContent = executeMemoryForget(block.input as Record<string, unknown>);
          }
        } else {
          const output = await executeBrowserTool(block.name, block.input as Record<string, unknown>, browser);
          resultContent = truncateBrowserResult(JSON.stringify(output));
          isError = (output as { ok?: boolean }).ok === false;
        }
      } catch (err) {
        resultContent = JSON.stringify({ ok: false, error: (err as Error).message });
        isError = true;
      }
      const durationMs = Date.now() - startMs;
      if (runId && eventId) {
        trackToolResult(runId, eventId, resultContent.slice(0, 200), durationMs);
      }
      if (!webContents.isDestroyed()) {
        webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
          id: block.id,
          name: block.name,
          status: isError ? 'error' : 'success',
          detail: resultContent.slice(0, 200),
          input: JSON.stringify(block.input, null, 2),
          output: resultContent,
          durationMs,
        });
      }
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: resultContent,
      });
    }
    return results;
  };

  const sessionLengthBeforeRequest = sessionMessages.length;
  try {
    sessionMessages.push(userMessage);

    let assistantText = '';

    if (!browserService) {
      // ── Standard streaming path (no tools) ──────────────────────────────
      try {
        assistantText = await runStream(true);
      } catch (firstErr: unknown) {
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        if (tryThinking && (msg.includes('thinking') || msg.includes('Thinking') || msg.includes('400'))) {
          assistantText = await runStream(false);
        } else {
          throw firstErr;
        }
      }
    } else {
      // ── Agentic tool-use loop ────────────────────────────────────────────
      const loopMessages: Anthropic.MessageParam[] = [...messagesForRequest];
      const MAX_TOOL_TURNS = 20;
      let turns = 0;

      while (turns < MAX_TOOL_TURNS) {
        turns++;
        const response = await runToolTurn(loopMessages);
        console.log(`[anthropic] turn=${turns} stop=${response.stop_reason} blocks=${response.content.map(b => b.type).join(',')}`);

        // server_tool_use = tool search calls handled server-side; skip client execution
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        const textBlocks = response.content.filter(
          (b): b is Anthropic.TextBlock => b.type === 'text',
        );

        // Append assistant turn to loop messages
        loopMessages.push({ role: 'assistant', content: response.content });

        // If no tool calls this is the final response — stream as real text
        if (toolUseBlocks.length === 0) {
          for (const block of textBlocks) {
            if (block.text) {
              assistantText += block.text;
              sendText(block.text);
            }
          }
          break;
        }

        // Intermediate turn: model is narrating between tool calls ("Let me
        // check X…"). Route to shimmer/thinking instead of content area so it
        // shows as a single rotating status line, not a growing paragraph.
        for (const block of textBlocks) {
          if (block.text) {
            assistantText += block.text;
            const line = block.text.trim().split(/[\n\r]/)[0].replace(/^[-*>#]+\s*/, '').trim();
            if (line) sendThinking(line.length > 80 ? line.slice(0, 77) + '…' : line);
          }
        }

        // Execute tools and append results
        const toolResults = await executeTools(toolUseBlocks, browserService);
        loopMessages.push({ role: 'user', content: toolResults });
      }

      // Sync the canonical session with what happened in the loop (skip the
      // first user message we already pushed above)
      for (let i = messagesForRequest.length; i < loopMessages.length; i++) {
        sessionMessages.push(loopMessages[i]);
      }

      if (turns >= MAX_TOOL_TURNS && assistantText === '') {
        assistantText = '[Browser tool loop reached maximum turn limit without producing a response.]';
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, assistantText);
        }
      }
    }

    // Push final assistant text to session history (streaming path only —
    // agentic path already pushed all turns above)
    if (!browserService) {
      sessionMessages.push({
        role: 'assistant',
        content: assistantText,
      });
    }

    if (!webContents.isDestroyed()) {
      webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true });
    }

    if (runId) completeRun(runId, 0, 0);
    return { response: assistantText };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.name === 'AbortError') {
      if (runId) failRun(runId, 'Cancelled by user');
      if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, cancelled: true });
      return { response: '', error: 'Stopped' };
    }
    if (runId) failRun(runId, err.message);
    sessionMessages.splice(sessionLengthBeforeRequest);
    if (!webContents.isDestroyed()) {
      webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message });
    }
    return { response: '', error: err.message };
  }
}

/**
 * Single-turn non-streaming call for use by agentLoop.
 * Returns text + tool_use blocks from one LLM response. Does NOT run a tool loop.
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

import OpenAI from 'openai';
import type { WebContents } from 'electron';
import * as fs from 'fs';
import { IPC_EVENTS } from './ipc-channels';
import type { MessageAttachment } from '../shared/types';
import { executeShellTool } from './core/cli/shellTools';
import { executeBrowserTool } from './core/cli/browserTools';
import { SEARCH_TOOL_OPENAI, executeSearchTools, toOpenAITool, searchTools } from './core/cli/toolRegistry';
import type { BrowserService } from './core/browser/BrowserService';
import { truncateBrowserResult } from './core/cli/truncate';
import { buildSharedSystemPrompt } from './core/cli/systemPrompt';
import { startRun, trackToolCall, trackToolResult, completeRun, failRun } from './runTracker';
import { executeGuiInteract, DESKTOP_TOOL_NAMES, renderCapabilities } from './core/desktop';
import { checkBudget } from './agent/spending-budget';
import type { ToolUseBlock, LLMTurn, LoopOptions } from './agent/types';
import { prepareOpenAIMessagesForSend } from './core/providers/openAIMessageProtocol';

type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;


function buildUserContent(
  text: string,
  attachments?: MessageAttachment[],
): string | OpenAI.Chat.ChatCompletionContentPart[] {
  if (!attachments?.length) return text;

  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];

  for (const a of attachments) {
    if (a.kind === 'image' && (a.dataUrl || a.path)) {
      let dataUrl = a.dataUrl;
      if (!dataUrl && a.path) {
        try {
          const b64 = fs.readFileSync(a.path).toString('base64');
          const mime = a.mimeType || 'image/png';
          dataUrl = `data:${mime};base64,${b64}`;
        } catch {
          continue;
        }
      }
      if (dataUrl) {
        parts.push({ type: 'image_url', image_url: { url: dataUrl } });
      }
    } else if (a.textContent) {
      parts.push({ type: 'text', text: `[Attachment: ${a.name}]\n${a.textContent}` });
    }
  }

  parts.push({ type: 'text', text });
  return parts;
}

type StreamParams = {
  webContents: WebContents;
  apiKey: string;
  modelRegistryId: string;
  userText: string;
  attachments?: MessageAttachment[];
  sessionMessages: OpenAIMessage[];
  signal: AbortSignal;
  browserService?: BrowserService;
  unrestrictedMode?: boolean;
  conversationId?: string;
};

export async function streamOpenAIChat({
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
  const client = new OpenAI({ apiKey });
  const runId = conversationId ? startRun(conversationId, 'openai', modelRegistryId) : null;

  const userContent = buildUserContent(userText, attachments);
  const userMessage: OpenAIMessage = { role: 'user', content: userContent };

  const sendThinking = (t: string) => {
    if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_THINKING, t);
  };
  const sendText = (chunk: string) => {
    if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, chunk);
  };

  sendThinking('GPT is thinking…');

  const sessionLengthBeforeRequest = sessionMessages.length;

  try {
    const budget = checkBudget(1);
    if (!budget.allowed) {
      return { response: '', error: `Budget exceeded: ${budget.periodLimit} cents limit reached for ${budget.blockedBy} period.` };
    }

    const caps = await renderCapabilities();
    const systemPrompt = await Promise.resolve(buildSharedSystemPrompt(unrestrictedMode)) + (caps ? `\n\nOS CONTEXT:\n${caps}` : '');

    // Repair stale tool history before appending the new user message
    const repairedSession = prepareOpenAIMessagesForSend([...sessionMessages] as OpenAIMessage[], {
      caller: 'streamOpenAIChat.session',
      onRepair: (issues) => {
        console.warn(`[openai] pre-flight repaired session history: ${issues.join(' | ')}`);
      },
    }).messages as OpenAIMessage[];
    repairedSession.push(userMessage);

    sessionMessages.push(userMessage);

    const loopMessages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...repairedSession,
    ];

    // Start with only the search meta-tool; tools are loaded on demand
    let activeTools: OpenAI.Chat.ChatCompletionTool[] = [SEARCH_TOOL_OPENAI];
    // Pre-load shell tools since they're small and almost always needed
    const shellToolSchemas = searchTools({ names: ['shell_exec', 'file_edit', 'file_list_directory', 'file_search'] });
    activeTools = [SEARCH_TOOL_OPENAI, ...shellToolSchemas.map(toOpenAITool)];

    let fullText = '';
    const MAX_TOOL_TURNS = 20;
    let turns = 0;

    while (turns < MAX_TOOL_TURNS) {
      turns++;

      const safeLoopMessages = prepareOpenAIMessagesForSend(loopMessages as OpenAIMessage[], {
        caller: 'streamOpenAIChat.turn',
        onRepair: (issues) => {
          console.warn(`[openai] pre-flight repaired turn request: ${issues.join(' | ')}`);
        },
      }).messages as OpenAIMessage[];

      const stream = await client.chat.completions.create(
        {
          model: modelRegistryId,
          messages: safeLoopMessages,
          tools: activeTools,
          tool_choice: 'auto',
          stream: true,
          // @ts-ignore
          store: false,
        },
        { signal },
      );

      let turnText = '';
      const toolCallAccumulators: Record<string, { name: string; args: string }> = {};

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          turnText += delta.content;
        }

        // Accumulate streamed tool call arguments
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = String(tc.index);
            if (!toolCallAccumulators[idx]) {
              toolCallAccumulators[idx] = { name: tc.function?.name ?? '', args: '' };
            }
            if (tc.function?.name) toolCallAccumulators[idx].name = tc.function.name;
            if (tc.function?.arguments) toolCallAccumulators[idx].args += tc.function.arguments;
          }
        }
      }

      fullText += turnText;

      const toolCalls = Object.values(toolCallAccumulators);

      // Generate stable IDs for this turn's tool calls (must match between assistant + tool result)
      const toolCallIds: Record<string, string> = {};
      const ts = Date.now();
      for (const idx of Object.keys(toolCallAccumulators)) {
        toolCallIds[idx] = `call_${idx}_${ts}`;
      }

      // Push assistant turn to loop
      const assistantMsg: OpenAIMessage = { role: 'assistant', content: turnText || null };
      if (toolCalls.length > 0) {
        (assistantMsg as any).tool_calls = Object.entries(toolCallAccumulators).map(([idx, tc]) => ({
          id: toolCallIds[idx],
          type: 'function',
          function: { name: tc.name, arguments: tc.args },
        }));
      }
      loopMessages.push(assistantMsg);

      if (toolCalls.length === 0) {
        // Final turn — stream as real text content
        if (turnText) sendText(turnText);
        break;
      }

      // Intermediate turn: route narration to shimmer/thinking instead of
      // content area so it shows as a single rotating status line.
      if (turnText) {
        const line = turnText.trim().split(/[\n\r]/)[0].replace(/^[-*>#]+\s*/, '').trim();
        if (line) sendThinking(line.length > 80 ? line.slice(0, 77) + '…' : line);
      }

      // Execute tools and push results
      for (const [idx, tc] of Object.entries(toolCallAccumulators)) {
        const toolCallId = toolCallIds[idx];
        const startMs = Date.now();
        const argsSummary = tc.args.slice(0, 120);
        const eventId = (runId && tc.name !== 'search_tools') ? trackToolCall(runId, tc.name, argsSummary) : '';
        let resultStr: string;

        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.args || '{}'); } catch { /* leave empty */ }

        if (!webContents.isDestroyed()) {
          webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
            id: toolCallId,
            name: tc.name,
            status: 'running',
            detail: tc.args.slice(0, 200),
            input: tc.args,
          });
        }

        // Handle search_tools meta-tool
        if (tc.name === 'search_tools') {
          const searchResult = executeSearchTools(args);
          const parsed = JSON.parse(searchResult);
          // Add newly discovered tools to activeTools for subsequent turns
          if (parsed.schemas) {
            for (const schema of parsed.schemas) {
              const oaiTool = toOpenAITool(schema);
              if (!activeTools.find(t => (t as any).function?.name === schema.name)) {
                activeTools.push(oaiTool);
              }
            }
          }
          // Send tool activity to UI
          if (!webContents.isDestroyed()) {
            webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
              id: toolCallId,
              name: 'search_tools',
              status: 'success',
              detail: `Loaded: ${parsed.tools_loaded?.join(', ') ?? 'catalog'}`,
              durationMs: Date.now() - startMs,
            });
          }
          loopMessages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: searchResult,
          } as OpenAIMessage);
          continue; // don't fall through to regular tool execution
        }

        try {
          if (tc.name.startsWith('browser_') && browserService) {
            const output = await executeBrowserTool(tc.name, args, browserService);
            resultStr = truncateBrowserResult(JSON.stringify(output));
          } else if (DESKTOP_TOOL_NAMES.has(tc.name)) {
            resultStr = await executeGuiInteract(args);
          } else {
            resultStr = await executeShellTool(tc.name, args);
          }
        } catch (err) {
          resultStr = JSON.stringify({ ok: false, error: (err as Error).message });
        }

        const durationMs = Date.now() - startMs;
        if (runId && eventId) {
          trackToolResult(runId, eventId, resultStr.slice(0, 200), durationMs);
        }
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
            id: toolCallId,
            name: tc.name,
            status: 'success',
            detail: resultStr.slice(0, 200),
            input: tc.args,
            output: resultStr,
            durationMs,
          });
        }

        loopMessages.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: resultStr,
        } as OpenAIMessage);
      }
    }

    if (turns >= MAX_TOOL_TURNS && fullText === '') {
      fullText = '[Tool loop reached maximum turn limit without producing a response.]';
      sendText(fullText);
    }

    // Sync canonical session: skip system (index 0) and repairedSession entries,
    // then append only the new loop turns (assistant + tool results).
    for (let i = 1 + repairedSession.length; i < loopMessages.length; i++) {
      sessionMessages.push(loopMessages[i]);
    }

    if (!webContents.isDestroyed()) {
      webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true });
    }

    if (runId) completeRun(runId, 0, 0);
    return { response: fullText };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.name === 'AbortError' || (err as NodeJS.ErrnoException).code === 'ERR_CANCELED') {
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

export async function streamOpenAILLM(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  systemPrompt: string,
  tools: OpenAI.Chat.ChatCompletionTool[],
  options: LoopOptions,
): Promise<LLMTurn> {
  const client = new OpenAI({ apiKey: options.apiKey });

  const loopMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const safeLoopMessages = prepareOpenAIMessagesForSend(loopMessages as OpenAIMessage[], {
    caller: 'streamOpenAILLM',
    onRepair: (issues) => {
      console.warn(`[openai] pre-flight repaired LLM request: ${issues.join(' | ')}`);
    },
  }).messages as OpenAIMessage[];

  const stream = await client.chat.completions.create(
    {
      model: options.model,
      messages: safeLoopMessages,
      tools,
      tool_choice: 'auto',
      stream: true,
      // @ts-ignore
      store: false,
    },
    { signal: options.signal },
  );

  let text = '';
  const toolCallAccumulators: Record<string, { name: string; args: string }> = {};

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      text += delta.content;
      options.onText(delta.content);
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = String(tc.index);
        if (!toolCallAccumulators[idx]) toolCallAccumulators[idx] = { name: '', args: '' };
        if (tc.function?.name) toolCallAccumulators[idx].name = tc.function.name;
        if (tc.function?.arguments) toolCallAccumulators[idx].args += tc.function.arguments;
      }
    }
  }

  const ts = Date.now();
  const toolBlocks: ToolUseBlock[] = Object.entries(toolCallAccumulators).map(([idx, tc]) => ({
    id: `call_${idx}_${ts}`,
    name: tc.name,
    input: (() => { try { return JSON.parse(tc.args || '{}'); } catch { return {}; } })(),
  }));

  return { text, toolBlocks };
}

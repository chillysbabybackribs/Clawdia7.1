import OpenAI from 'openai';
import type { WebContents } from 'electron';
import * as fs from 'fs';
import { IPC_EVENTS } from './ipc-channels';
import type { MessageAttachment } from '../shared/types';
import { executeShellTool, SHELL_TOOLS_OPENAI } from './core/cli/shellTools';
import { BROWSER_TOOLS, executeBrowserTool } from './core/cli/browserTools';
import type { BrowserService } from './core/browser/BrowserService';
import { truncateBrowserResult } from './core/cli/truncate';
import { SHARED_SYSTEM_PROMPT } from './core/cli/systemPrompt';

type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;

// Convert BROWSER_TOOLS (Anthropic schema) to OpenAI function tool format
const BROWSER_TOOLS_OPENAI: OpenAI.Chat.ChatCompletionTool[] = BROWSER_TOOLS.map(t => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema as Record<string, unknown>,
  },
}));

const ALL_TOOLS_OPENAI: OpenAI.Chat.ChatCompletionTool[] = [
  ...SHELL_TOOLS_OPENAI,
  ...BROWSER_TOOLS_OPENAI,
];

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
}: StreamParams): Promise<{ response: string; error?: string }> {
  const client = new OpenAI({ apiKey });

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
    sessionMessages.push(userMessage);

    const loopMessages: OpenAIMessage[] = [
      { role: 'system', content: SHARED_SYSTEM_PROMPT },
      ...sessionMessages,
    ];

    let fullText = '';
    const MAX_TOOL_TURNS = 20;
    let turns = 0;

    while (turns < MAX_TOOL_TURNS) {
      turns++;

      const stream = await client.chat.completions.create(
        {
          model: modelRegistryId,
          messages: loopMessages,
          tools: ALL_TOOLS_OPENAI,
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
          sendText(delta.content);
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

      if (toolCalls.length === 0) break;

      // Execute tools and push results
      for (const [idx, tc] of Object.entries(toolCallAccumulators)) {
        const toolCallId = toolCallIds[idx];
        const startMs = Date.now();
        let resultStr: string;

        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.args || '{}'); } catch { /* leave empty */ }

        if (!webContents.isDestroyed()) {
          webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
            id: toolCallId,
            name: tc.name,
            status: 'running',
            detail: tc.args.slice(0, 200),
          });
        }

        try {
          if (tc.name.startsWith('browser_') && browserService) {
            const output = await executeBrowserTool(tc.name, args, browserService);
            resultStr = truncateBrowserResult(JSON.stringify(output));
          } else {
            resultStr = await executeShellTool(tc.name, args);
          }
        } catch (err) {
          resultStr = JSON.stringify({ ok: false, error: (err as Error).message });
        }

        const durationMs = Date.now() - startMs;
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
            id: toolCallId,
            name: tc.name,
            status: 'success',
            detail: resultStr.slice(0, 200),
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

    // Sync canonical session: skip system message (index 0) and original session messages
    for (let i = 1 + sessionMessages.length; i < loopMessages.length; i++) {
      sessionMessages.push(loopMessages[i]);
    }

    if (!webContents.isDestroyed()) {
      webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true });
    }

    return { response: fullText };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.name === 'AbortError' || (err as NodeJS.ErrnoException).code === 'ERR_CANCELED') {
      if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, cancelled: true });
      return { response: '', error: 'Stopped' };
    }
    sessionMessages.splice(sessionLengthBeforeRequest);
    if (!webContents.isDestroyed()) {
      webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message });
    }
    return { response: '', error: err.message };
  }
}

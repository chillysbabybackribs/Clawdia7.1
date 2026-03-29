// src/main/agent/agentLoop.ts
import * as fs from 'fs';
import { classify } from './classify';
import { buildStaticPrompt, buildDynamicPrompt } from './promptBuilder';
import { createLoopControl, removeLoopControl } from './loopControl';
import { initBrowserBudget, checkBrowserBudget, updateBrowserBudget, checkToolPolicy } from './browserBudget';
import { dispatch } from './dispatch';
import { verifyOutcomes } from './recovery';
import { streamLLM } from './streamLLM';
import type { LoopOptions, DispatchContext, ToolUseBlock } from './types';
import type { MessageAttachment } from '../../shared/types';
import { buildAppMappingSystemPrompt } from './appMapping';

const MAX_ITERATIONS = 50;

export async function agentLoop(
  userMessage: string,
  messages: any[],
  options: LoopOptions,
): Promise<string> {
  const { runId } = options;

  // 1. Classify
  const profile = classify(userMessage, options.forcedProfile);

  // 2. Build static prompt (once per run)
  const baseStaticPrompt = buildStaticPrompt(profile, options.unrestrictedMode ?? false);
  const staticPrompt = profile.specialMode === 'app_mapping'
    ? await buildAppMappingSystemPrompt(baseStaticPrompt, {
        appName: profile.mappingTarget || 'target app',
        phase: profile.mappingPhase,
      })
    : baseStaticPrompt;

  // 3. Init loop state
  const control = createLoopControl(runId, options.signal);
  const ctx: DispatchContext = {
    runId,
    signal: control.signal,
    iterationIndex: 0,
    toolCallCount: 0,
    allToolCalls: [],
    browserBudget: initBrowserBudget(),
    options,
  };

  // Push current user message onto session history
  messages.push(buildUserMessage(userMessage, options.attachments, options.provider));

  // Greeting shortcut — no tools needed
  if (profile.isGreeting) {
    options.onThinking?.('Responding…');
    const { text } = await streamLLM(messages, staticPrompt, '', profile, { ...options, signal: control.signal });
    removeLoopControl(runId);
    return text;
  }

  let finalText = '';

  try {
    for (let i = 0; i < (options.maxIterations ?? MAX_ITERATIONS); i++) {
      // Pause check
      await control.waitIfPaused();
      if (control.signal.aborted) break;

      // Inject queued user context
      if (control.pendingContext) {
        messages.push({ role: 'user', content: control.pendingContext });
        control.pendingContext = null;
      }

      ctx.iterationIndex = i;
      const dynamicPrompt = buildDynamicPrompt(profile, ctx);

      options.onThinking?.(`Thinking… (step ${i + 1})`);

      // Stream text to renderer immediately while also accumulating
      // for the agent loop's internal state tracking.
      let turnText = '';
      const iterOptions = {
        ...options,
        currentIteration: i + 1,
        signal: control.signal,
        onText: (delta: string) => {
          turnText += delta;
          options.onText(delta);  // Forward immediately for live streaming
        },
      };

      // Call LLM
      const { text, toolBlocks } = await streamLLM(
        messages, staticPrompt, dynamicPrompt, profile,
        iterOptions,
      );

      if (text) finalText = text;

      // No tools → LLM is done; text was already streamed live
      if (toolBlocks.length === 0) {
        break;
      }

      // Intermediate turn: narration between tool calls was already
      // streamed to content area. Also show first line as shimmer hint.
      if (turnText) {
        const line = turnText.trim().split(/[\n\r]/)[0].replace(/^[-*>#]+\s*/, '').trim();
        if (line) options.onThinking?.(line.length > 80 ? line.slice(0, 77) + '…' : line);
      }

      // Policy checks before execution
      const violation = checkBrowserBudget(toolBlocks, ctx.browserBudget)
        ?? checkToolPolicy(toolBlocks);

      if (violation) {
        messages.push({ role: 'assistant', content: text || '(no text)' });
        messages.push({ role: 'user', content: `[POLICY] ${violation}` });
        continue;
      }

      // Push assistant turn with tool calls
      const assistantMsg = buildAssistantContent(text, toolBlocks, options.provider);
      if (Array.isArray(assistantMsg) && options.provider === 'anthropic') {
        messages.push({ role: 'assistant', content: assistantMsg });
      } else {
        messages.push(assistantMsg);
      }

      // Execute tools in parallel
      const results = await dispatch(toolBlocks, ctx);

      // Update browser budget
      updateBrowserBudget(toolBlocks, results, ctx.browserBudget);

      // Push tool results
      const toolResultMsg = buildToolResultMessage(toolBlocks, results, options.provider);
      if (Array.isArray(toolResultMsg) && options.provider === 'openai') {
        // OpenAI: each tool result is a separate message
        messages.push(...toolResultMsg);
      } else {
        messages.push(toolResultMsg);
      }

      if (profile.specialMode === 'app_mapping' && options.provider !== 'anthropic') {
        compactAppMappingHistory(messages, profile, ctx);
      }
    }

    // Post-loop verification
    const issue = verifyOutcomes(finalText, ctx.allToolCalls);
    if (issue && !control.signal.aborted) {
      options.onThinking?.('Verifying…');
      messages.push({ role: 'user', content: `Your response said: "${issue.issue}". ${issue.context} Please correct this.` });
      const { text } = await streamLLM(messages, staticPrompt, '', profile, { ...options, signal: control.signal });
      if (text) finalText = text;
    }

    return finalText;
  } finally {
    removeLoopControl(runId);
  }
}

function compactAppMappingHistory(
  messages: any[],
  profile: ReturnType<typeof classify>,
  ctx: DispatchContext,
): void {
  const maxMessages = 12;
  if (messages.length <= maxMessages) return;

  const recentMessages = messages.slice(-6);
  const firstMessage = messages[0];
  const summary = buildAppMappingHistorySummary(profile, ctx);

  const compacted: any[] = [];
  if (firstMessage) compacted.push(firstMessage);
  compacted.push({ role: 'assistant', content: summary });

  for (const message of recentMessages) {
    if (message !== firstMessage) compacted.push(message);
  }

  messages.splice(0, messages.length, ...compacted);
}

function buildAppMappingHistorySummary(
  profile: ReturnType<typeof classify>,
  ctx: DispatchContext,
): string {
  const recentCalls = ctx.allToolCalls.slice(-8);
  const target = profile.mappingTarget || 'target app';
  const phase = profile.mappingPhase || 'phase1';

  const recentLines = recentCalls.length
    ? recentCalls.map((call) => `- ${call.name}: ${summarizeToolResult(call.result)}`).join('\n')
    : '- no tool results yet';

  return [
    '[App Mapping Run Summary]',
    `Target: ${target}`,
    `Phase: ${phase}`,
    `Iteration: ${ctx.iterationIndex + 1}`,
    `Tool calls so far: ${ctx.toolCallCount}`,
    'Recent tool outcomes:',
    recentLines,
  ].join('\n');
}

function summarizeToolResult(result: string): string {
  const line = result
    .replace(/\s+/g, ' ')
    .replace(/\[Screenshot:[^\]]+\]/g, '[Screenshot]')
    .trim()
    .split('\n')[0]
    .slice(0, 160);

  return line || '[no result]';
}

function buildUserMessage(
  text: string,
  attachments: MessageAttachment[] | undefined,
  provider: string,
): any {
  if (!attachments?.length) return { role: 'user', content: text };

  if (provider === 'anthropic') {
    const blocks: any[] = [];
    for (const a of attachments) {
      if (a.kind === 'image' && (a.dataUrl || a.path)) {
        let base64 = '';
        let mediaType = a.mimeType || 'image/png';
        if (a.dataUrl) {
          const m = a.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (m) { mediaType = m[1]; base64 = m[2]; }
        } else if (a.path) {
          try { base64 = fs.readFileSync(a.path).toString('base64'); } catch { continue; }
        }
        if (base64) {
          blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
        }
      } else if (a.textContent) {
        blocks.push({ type: 'text', text: `[Attachment: ${a.name}]\n${a.textContent}` });
      }
    }
    blocks.push({ type: 'text', text });
    return { role: 'user', content: blocks };
  }

  if (provider === 'openai') {
    const parts: any[] = [];
    for (const a of attachments) {
      if (a.kind === 'image' && (a.dataUrl || a.path)) {
        let dataUrl = a.dataUrl;
        if (!dataUrl && a.path) {
          try {
            const b64 = fs.readFileSync(a.path).toString('base64');
            dataUrl = `data:${a.mimeType || 'image/png'};base64,${b64}`;
          } catch { continue; }
        }
        if (dataUrl) parts.push({ type: 'image_url', image_url: { url: dataUrl } });
      } else if (a.textContent) {
        parts.push({ type: 'text', text: `[Attachment: ${a.name}]\n${a.textContent}` });
      }
    }
    parts.push({ type: 'text', text });
    return { role: 'user', content: parts };
  }

  // Gemini: streamGeminiLLM reads sessionMessages[last].parts
  const parts: any[] = [{ text }];
  for (const a of attachments) {
    if (a.kind === 'image' && (a.dataUrl || a.path)) {
      let base64 = '';
      let mediaType = a.mimeType || 'image/png';
      if (a.dataUrl) {
        const m = a.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (m) { mediaType = m[1]; base64 = m[2]; }
      } else if (a.path) {
        try { base64 = fs.readFileSync(a.path).toString('base64'); } catch { continue; }
      }
      if (base64) parts.push({ inlineData: { data: base64, mimeType: mediaType } });
    } else if (a.textContent) {
      parts.push({ text: `[Attachment: ${a.name}]\n${a.textContent}` });
    }
  }
  return { role: 'user', parts };
}

function buildAssistantContent(text: string, toolBlocks: ToolUseBlock[], provider: string): any {
  if (provider === 'anthropic') {
    const content: any[] = [];
    if (text) content.push({ type: 'text', text });
    for (const b of toolBlocks) {
      content.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
    }
    return content;  // caller wraps in { role: 'assistant', content: [...] }
  }
  if (provider === 'openai') {
    return {
      role: 'assistant',
      content: text || null,
      tool_calls: toolBlocks.map(b => ({
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      })),
    };
  }
  // Gemini
  const parts: any[] = [];
  if (text) parts.push({ text });
  for (const b of toolBlocks) parts.push({ functionCall: { name: b.name, args: b.input } });
  return { role: 'model', parts };
}

function buildToolResultMessage(toolBlocks: ToolUseBlock[], results: string[], provider: string): any {
  if (provider === 'anthropic') {
    return {
      role: 'user',
      content: toolBlocks.map((b, i) => ({
        type: 'tool_result',
        tool_use_id: b.id,
        content: results[i],
      })),
    };
  }
  if (provider === 'openai') {
    // Return array — caller uses push(...) to add each as separate message
    return toolBlocks.map((b, i) => ({
      role: 'tool',
      tool_call_id: b.id,
      content: results[i],
    }));
  }
  // Gemini
  return {
    role: 'user',
    parts: toolBlocks.map((b, i) => ({
      functionResponse: { name: b.name, response: { result: results[i] } },
    })),
  };
}

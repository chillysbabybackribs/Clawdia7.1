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

// ── Token-aware history trimming ──────────────────────────────────────────────
// Estimates token count as Math.ceil(chars / 4) — avoids a tiktoken dependency
// while remaining within ~10% of real counts for typical prose + JSON content.
// Drops middle messages (oldest non-first) until the estimate is under budget,
// always preserving message[0] (original task) and the most recent message.
const TOKEN_BUDGET = 28_000;   // leave headroom for tool schemas + response
const CHARS_PER_TOKEN = 4;

function estimateTokens(messages: any[]): number {
  return Math.ceil(JSON.stringify(messages).length / CHARS_PER_TOKEN);
}

function trimMessageHistory(messages: any[]): void {
  if (estimateTokens(messages) <= TOKEN_BUDGET) return;

  // Drop oldest non-first messages until under budget.
  // IMPORTANT: Anthropic requires that every tool_use assistant message is
  // immediately followed by its tool_result user message. Dropping one without
  // the other produces an API error. We detect and drop such pairs together.
  while (messages.length > 2 && estimateTokens(messages) > TOKEN_BUDGET) {
    const candidate = messages[1];
    const isPairedToolUse =
      candidate?.role === 'assistant' &&
      Array.isArray(candidate?.content) &&
      candidate.content.some((b: any) => b?.type === 'tool_use') &&
      messages[2]?.role === 'user' &&
      Array.isArray(messages[2]?.content) &&
      messages[2].content.some((b: any) => b?.type === 'tool_result');

    if (isPairedToolUse && messages.length > 3) {
      // Drop the assistant tool_use AND the following tool_result together.
      messages.splice(1, 2);
    } else {
      messages.splice(1, 1);
    }
  }
}

// ── Browser completion heuristic ─────────────────────────────────────────────
// After a browser_extract_text result with substantial non-truncated content,
// the model has enough evidence to synthesize — force a no-tools final answer.
const BROWSER_EXTRACT_TOOL = 'browser_extract_text';
const BROWSER_COMPLETE_MIN_CHARS = 200;

function hasSufficientBrowserContent(allToolCalls: DispatchContext['allToolCalls']): boolean {
  for (const call of allToolCalls) {
    if (call.name !== BROWSER_EXTRACT_TOOL) continue;
    try {
      const parsed = JSON.parse(call.result);
      if (
        typeof parsed.text === 'string'
        && parsed.text.length >= BROWSER_COMPLETE_MIN_CHARS
        && parsed.truncated === false
      ) {
        return true;
      }
    } catch { /* not JSON — ignore */ }
  }
  return false;
}

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
    browserMode: 'plan',
    options,
    messages,
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
      const { text, toolBlocks, stopReason, rawContent } = await streamLLM(
        messages, staticPrompt, dynamicPrompt, profile,
        iterOptions,
      );

      if (text) finalText = text;

      // pause_turn: server-side tool loop hit its iteration limit — append
      // the full raw content and re-send so the server can resume.
      if (stopReason === 'pause_turn' && rawContent) {
        messages.push({ role: 'assistant', content: rawContent });
        continue;
      }

      // No client-side tools → LLM is done; text was already streamed live
      if (toolBlocks.length === 0) {
        break;
      }

      // Intermediate text was already streamed live to the chat panel via onText.
      // Only update the shimmer if the LLM produced no narration at all this turn.
      if (!turnText) {
        options.onThinking?.(`Working… (step ${i + 1})`);
      }

      // Policy checks before execution
      const violation = checkBrowserBudget(toolBlocks, ctx.browserBudget)
        ?? checkToolPolicy(toolBlocks);

      if (violation) {
        messages.push({ role: 'assistant', content: text || '(no text)' });
        messages.push({ role: 'user', content: `[POLICY] ${violation}` });
        continue;
      }

      // Push assistant turn — use rawContent when available (Anthropic) so that
      // any server_tool_use/web_search_result blocks are preserved correctly.
      if (rawContent && options.provider === 'anthropic') {
        messages.push({ role: 'assistant', content: rawContent });
      } else {
        const assistantMsg = buildAssistantContent(text, toolBlocks, options.provider);
        if (Array.isArray(assistantMsg) && options.provider === 'anthropic') {
          messages.push({ role: 'assistant', content: assistantMsg });
        } else {
          messages.push(assistantMsg);
        }
      }

      // Execute tools in parallel
      const dispatchResult = await dispatch(toolBlocks, ctx);
      const results = dispatchResult.results;

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

      // Trim history to prevent context blowup
      trimMessageHistory(messages);

      // Browser completion heuristic: enough page content extracted — synthesize
      // a final answer using the existing session with no tools (toolMode: 'none').
      // This reuses the same LLM connection and session; no separate API call.
      if (profile.toolGroup === 'browser' && hasSufficientBrowserContent(ctx.allToolCalls)) {
        options.onThinking?.('Synthesizing…');
        const finalOptions = {
          ...options,
          currentIteration: i + 2,
          signal: control.signal,
          onText: (delta: string) => { options.onText(delta); },
        };
        const { text } = await streamLLM(messages, staticPrompt, '', profile, finalOptions, [], 'none');
        if (text) finalText = text;
        break;
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

// ── Test exports (tree-shaken in production builds) ───────────────────────────
export const trimMessageHistoryForTest = trimMessageHistory;
export const estimateTokensForTest = estimateTokens;

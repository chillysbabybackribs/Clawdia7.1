// src/main/agent/agentLoop.ts
import * as fs from 'fs';
import { classify } from './classify';
import { buildStaticPrompt, buildDynamicPrompt } from './promptBuilder';
import { createLoopControl, removeLoopControl } from './loopControl';
import { initBrowserBudget, checkBrowserBudget, updateBrowserBudget, checkToolPolicy, checkBrowserScreenshotPolicy } from './browserBudget';
import { dispatch } from './dispatch';
import { verifyOutcomes } from './recovery';
import { streamLLM } from './streamLLM';
import type { LoopOptions, DispatchContext, ToolUseBlock } from './types';
import type { MessageAttachment } from '../../shared/types';
import { buildAppMappingSystemPrompt } from './appMapping';
import { prepareAnthropicMessagesForSend } from '../core/providers/anthropicMessageProtocol';
import { prepareOpenAIMessagesForSend } from '../core/providers/openAIMessageProtocol';
import { buildCacheKey, getCachedResponse, setCachedResponse } from '../db/responseCache';
import { getMemoryContext } from '../db/memory';
import { checkBudget } from './spending-budget';

const MAX_ITERATIONS = 50;
// Maximum wall-clock time for a single agent run (5 minutes).
// Guards against loops where each iteration completes quickly but the run
// never reaches a terminal state (e.g. infinite tool-call cycles).
const MAX_RUN_MS = 10 * 60 * 1000;

// ── Token-aware history trimming ──────────────────────────────────────────────
// Estimates token count as Math.ceil(chars / 4) — avoids a tiktoken dependency
// while remaining within ~10% of real counts for typical prose + JSON content.
// Drops middle messages (oldest non-first) until the estimate is under budget,
// always preserving message[0] (original task) and the most recent message.
// Budget for in-loop history trimming.
// Claude supports 200K tokens; we allow up to 90K for accumulated history,
// leaving generous headroom for tool schemas, system prompt, and the response.
// Raising this from the old 28K prevents the loop from stripping recent
// conversational turns (e.g. "here are your options A/B/C") that the user
// needs visible when they reply with a short follow-up like "option A".
const TOKEN_BUDGET = 90_000;
const CHARS_PER_TOKEN = 4;

// How many of the most-recent non-tool-result messages to always preserve.
// These are the live dialogue turns the user is actively referring to.
const PROTECTED_TAIL = 6;

function estimateTokens(messages: any[]): number {
  return Math.ceil(JSON.stringify(messages).length / CHARS_PER_TOKEN);
}

function isToolPair(messages: any[], idx: number): boolean {
  // Returns true when messages[idx] is an assistant tool_use immediately
  // followed by a user tool_result — a pair that must be dropped together.
  const a = messages[idx];
  const b = messages[idx + 1];
  return (
    a?.role === 'assistant' &&
    Array.isArray(a?.content) &&
    a.content.some((bl: any) => bl?.type === 'tool_use') &&
    b?.role === 'user' &&
    Array.isArray(b?.content) &&
    b.content.some((bl: any) => bl?.type === 'tool_result')
  );
}

function trimMessageHistory(messages: any[]): void {
  if (estimateTokens(messages) <= TOKEN_BUDGET) return;

  // Drop oldest messages until under budget, but never touch the most-recent
  // PROTECTED_TAIL entries — those are the live dialogue context the user is
  // actively referencing (e.g. "here are your options A/B/C").
  //
  // IMPORTANT: Anthropic requires that every tool_use assistant message is
  // immediately followed by its tool_result user message. Dropping one without
  // the other produces an API error. We detect and drop such pairs together.
  while (messages.length > PROTECTED_TAIL + 1 && estimateTokens(messages) > TOKEN_BUDGET) {
    // messages[0] is the initial user message (anchor) — never drop it.
    // Start trimming from messages[1].
    if (messages.length <= 2) break;

    const candidate = messages[1];
    const safeToDropPair = isToolPair(messages, 1) && messages.length > PROTECTED_TAIL + 2;

    if (safeToDropPair) {
      // Drop the assistant tool_use AND the following tool_result together.
      messages.splice(1, 2);
    } else {
      messages.splice(1, 1);
    }
  }
}

function normalizeHistoryForProvider(messages: any[], provider: LoopOptions['provider'], caller: string): void {
  if (provider === 'anthropic') {
    const repair = prepareAnthropicMessagesForSend(messages, {
      caller,
      closePendingToolUses: true,
      pendingToolUseReason: 'protocol_repair',
      onRepair: (issues) => {
        console.warn(`[agentLoop] Anthropic protocol repaired in ${caller}: ${issues.join(' | ')}`);
      },
    });
    messages.splice(0, messages.length, ...repair.messages);
    return;
  }

  if (provider === 'openai') {
    const repair = prepareOpenAIMessagesForSend(messages, {
      caller,
      onRepair: (issues) => {
        console.warn(`[agentLoop] OpenAI protocol repaired in ${caller}: ${issues.join(' | ')}`);
      },
    });
    messages.splice(0, messages.length, ...repair.messages);
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
  const loopDeadline = Date.now() + MAX_RUN_MS;
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

  // Memory recall: inject relevant facts/past-conversation snippets once per run,
  // before the first LLM call. Injected as a user/assistant prefill pair so the
  // static system prompt stays identical across iterations (Anthropic cache hits).
  const memoryContext = getMemoryContext(userMessage);
  if (memoryContext) {
    messages.push({ role: 'user', content: `[Memory context]\n${memoryContext}` });
    messages.push({ role: 'assistant', content: 'Understood.' });
  }

  // Inject browser session context once per run (browser/full profiles only).
  // Placed here — after user message, before the loop — so it costs tokens once
  // and does not disturb the cacheable static system prompt.
  if (options.browserService && (profile.toolGroup === 'browser' || profile.toolGroup === 'full')) {
    const sessions = await options.browserService.listSessions();
    if (sessions.length > 0) {
      messages.push({
        role: 'user',
        content: `[Browser session context] You are currently authenticated on: ${sessions.join(', ')}. Use these existing sessions directly — do not attempt to log in again unless a page explicitly shows you are signed out.`,
      });
      messages.push({ role: 'assistant', content: 'Understood.' });
    }
  }

  // Greeting shortcut — no tools needed
  if (profile.isGreeting) {
    options.onThinking?.('Responding…');
    normalizeHistoryForProvider(messages, options.provider, 'agentLoop.greeting');
    const { text } = await streamLLM(messages, staticPrompt, '', profile, { ...options, signal: control.signal });
    removeLoopControl(runId);
    return text;
  }

  // Response cache: skip for browser/desktop profiles (page state changes constantly)
  // and for greetings (already handled above). Only cache clean text-only responses.
  const isCacheable = profile.toolGroup !== 'browser' && profile.toolGroup !== 'desktop' && profile.specialMode == null;
  const cacheKey = isCacheable
    ? buildCacheKey(options.provider, options.model, staticPrompt, messages)
    : null;

  if (cacheKey) {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      options.onText(cached);
      removeLoopControl(runId);
      return cached;
    }
  }

  let finalText = '';
  // Tools discovered via search_tools accumulate across iterations so the model
  // can call them on subsequent turns (OpenAI/Gemini don't support defer_loading).
  let accumulatedTools: import('@anthropic-ai/sdk').default.Tool[] = [];

  try {
    for (let i = 0; i < (options.maxIterations ?? MAX_ITERATIONS); i++) {
      // Pause check
      await control.waitIfPaused();
      if (control.signal.aborted) break;
      if (Date.now() > loopDeadline) {
        console.warn(`[agentLoop] Run ${runId} exceeded ${MAX_RUN_MS / 1000}s wall-clock limit — aborting`);
        break;
      }

      // Budget enforcement: checked before every LLM call so all providers
      // (Anthropic, OpenAI, Gemini) are covered by a single guard.
      const budgetCheck = checkBudget(1);
      if (!budgetCheck.allowed) {
        throw new Error(`Budget exceeded: ${budgetCheck.periodLimit} cents limit reached for ${budgetCheck.blockedBy} period.`);
      }

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

      // Ensure message history is protocol-valid before sending to API.
      normalizeHistoryForProvider(messages, options.provider, `agentLoop.preSend.${i + 1}`);

      // Call LLM — pass accumulated discovered tools so OpenAI/Gemini can call
      // tools that were returned by a previous search_tools invocation.
      const { text, toolBlocks, stopReason, rawContent } = await streamLLM(
        messages, staticPrompt, dynamicPrompt, profile,
        iterOptions,
        accumulatedTools,
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
      const violation = options.unrestrictedMode
        ? null
        : checkBrowserBudget(toolBlocks, ctx.browserBudget)
          ?? checkBrowserScreenshotPolicy(toolBlocks, userMessage, ctx.allToolCalls)
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

      // Accumulate any tools discovered via search_tools so they stay in the
      // tool list for all subsequent iterations (critical for OpenAI/Gemini).
      for (const tool of dispatchResult.discoveredTools) {
        if (!accumulatedTools.find(t => t.name === tool.name)) {
          accumulatedTools.push(tool);
        }
      }

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

      // Trim history to prevent context blowup, then re-validate protocol
      trimMessageHistory(messages);
      normalizeHistoryForProvider(messages, options.provider, `agentLoop.postTrim.${i + 1}`);

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
        normalizeHistoryForProvider(messages, options.provider, `agentLoop.synthesize.${i + 1}`);
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
      normalizeHistoryForProvider(messages, options.provider, 'agentLoop.verify');
      const { text } = await streamLLM(messages, staticPrompt, '', profile, { ...options, signal: control.signal });
      if (text) finalText = text;
    }

    // Cache clean text-only final responses for reuse within TTL.
    // Only cache if: no tool calls were made (pure conversational response)
    // and the response is non-empty and the run wasn't aborted.
    if (
      cacheKey &&
      finalText &&
      !control.signal.aborted &&
      ctx.allToolCalls.length === 0
    ) {
      setCachedResponse(cacheKey, finalText);
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
export const normalizeHistoryForProviderForTest = normalizeHistoryForProvider;

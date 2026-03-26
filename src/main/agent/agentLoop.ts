// src/main/agent/agentLoop.ts
import { classify } from './classify';
import { buildStaticPrompt, buildDynamicPrompt } from './promptBuilder';
import { createLoopControl, removeLoopControl } from './loopControl';
import { initBrowserBudget, checkBrowserBudget, updateBrowserBudget, checkToolPolicy } from './browserBudget';
import { dispatch } from './dispatch';
import { verifyOutcomes } from './recovery';
import { streamLLM } from './streamLLM';
import type { LoopOptions, DispatchContext, ToolUseBlock } from './types';

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
  const staticPrompt = buildStaticPrompt(profile, options.unrestrictedMode ?? false);

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
  messages.push({ role: 'user', content: userMessage });

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

      // Call LLM
      const { text, toolBlocks } = await streamLLM(
        messages, staticPrompt, dynamicPrompt, profile,
        { ...options, signal: control.signal },
      );

      if (text) finalText = text;

      // No tools → LLM is done
      if (toolBlocks.length === 0) break;

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

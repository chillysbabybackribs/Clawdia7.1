// src/main/agent/historyTrimmer.ts
// Token-aware history trimming for OpenAI and Gemini direct chat paths.
// Mirrors the logic in agentLoop.ts but works with both message formats.
//
// OpenAI: messages are {role, content, tool_calls?, tool_call_id?}
// Gemini:  messages are {role: 'user'|'model', parts: [...]}
//
// Strategy: estimate tokens via chars/4, drop oldest messages (starting from
// index 1) until under budget, always preserving the first message (original
// task) and the PROTECTED_TAIL most-recent messages.

const TOKEN_BUDGET = 90_000;
const CHARS_PER_TOKEN = 4;
const PROTECTED_TAIL = 6;

function estimateTokens(messages: any[]): number {
  return Math.ceil(JSON.stringify(messages).length / CHARS_PER_TOKEN);
}

// For OpenAI: an assistant message with tool_calls must be followed by its
// tool result messages (role:'tool'). Drop them together to avoid API errors.
function countOpenAIToolPairSize(messages: any[], idx: number): number {
  if (
    messages[idx]?.role === 'assistant' &&
    Array.isArray(messages[idx]?.tool_calls) &&
    messages[idx].tool_calls.length > 0
  ) {
    let count = 1;
    while (
      idx + count < messages.length &&
      messages[idx + count]?.role === 'tool'
    ) {
      count++;
    }
    return count;
  }
  return 1;
}

// For Gemini: a model message with functionCall parts must be followed by the
// user message with functionResponse parts. Drop them together.
function countGeminiToolPairSize(messages: any[], idx: number): number {
  const msg = messages[idx];
  if (
    msg?.role === 'model' &&
    Array.isArray(msg?.parts) &&
    msg.parts.some((p: any) => p.functionCall)
  ) {
    if (
      idx + 1 < messages.length &&
      messages[idx + 1]?.role === 'user' &&
      Array.isArray(messages[idx + 1]?.parts) &&
      messages[idx + 1].parts.some((p: any) => p.functionResponse)
    ) {
      return 2;
    }
  }
  return 1;
}

export function trimOpenAIHistory(messages: any[]): void {
  if (estimateTokens(messages) <= TOKEN_BUDGET) return;
  while (messages.length > PROTECTED_TAIL + 1 && estimateTokens(messages) > TOKEN_BUDGET) {
    if (messages.length <= 2) break;
    const pairSize = countOpenAIToolPairSize(messages, 1);
    if (messages.length > PROTECTED_TAIL + pairSize) {
      messages.splice(1, pairSize);
    } else {
      messages.splice(1, 1);
    }
  }
}

export function trimGeminiHistory(messages: any[]): void {
  if (estimateTokens(messages) <= TOKEN_BUDGET) return;
  while (messages.length > PROTECTED_TAIL + 1 && estimateTokens(messages) > TOKEN_BUDGET) {
    if (messages.length <= 2) break;
    const pairSize = countGeminiToolPairSize(messages, 1);
    if (messages.length > PROTECTED_TAIL + pairSize) {
      messages.splice(1, pairSize);
    } else {
      messages.splice(1, 1);
    }
  }
}

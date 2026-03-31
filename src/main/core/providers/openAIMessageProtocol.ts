type OpenAIProtocolMessage = {
  role?: string;
  content?: unknown;
  tool_calls?: Array<{ id?: string }>;
  tool_call_id?: string;
};

export interface OpenAIProtocolRepair {
  messages: OpenAIProtocolMessage[];
  repaired: boolean;
  issues: string[];
}

export interface OpenAIPreflightOptions {
  caller?: string;
  onRepair?: (issues: string[]) => void;
}

function getAssistantToolCallIds(message: OpenAIProtocolMessage | undefined | null): string[] {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.tool_calls)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const toolCall of message.tool_calls) {
    if (typeof toolCall?.id !== 'string' || seen.has(toolCall.id)) continue;
    seen.add(toolCall.id);
    ids.push(toolCall.id);
  }
  return ids;
}

function makeInterruptedToolMessage(toolCallId: string): OpenAIProtocolMessage {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify({
      status: 'interrupted',
      reason: 'protocol_repair',
      message: 'Tool run was interrupted before completion.',
    }),
  };
}

export function normalizeOpenAIMessages(messages: OpenAIProtocolMessage[]): OpenAIProtocolRepair {
  const normalized: OpenAIProtocolMessage[] = [];
  const issues: string[] = [];
  let pendingToolCallIds: string[] = [];

  const flushPendingToolCalls = (why: string) => {
    if (pendingToolCallIds.length === 0) return;
    normalized.push(...pendingToolCallIds.map((toolCallId) => makeInterruptedToolMessage(toolCallId)));
    issues.push(`Inserted synthetic tool messages for pending tool_calls ${pendingToolCallIds.join(', ')} before ${why}.`);
    pendingToolCallIds = [];
  };

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      flushPendingToolCalls('a non-object message');
      normalized.push(message);
      continue;
    }

    if (message.role === 'assistant') {
      flushPendingToolCalls('a later assistant message');
      normalized.push(message);
      pendingToolCallIds = getAssistantToolCallIds(message);
      continue;
    }

    if (message.role === 'tool') {
      const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id : null;
      if (!toolCallId) {
        issues.push('Dropped tool message with no tool_call_id.');
        continue;
      }

      if (pendingToolCallIds.length === 0) {
        issues.push(`Dropped orphaned tool message for ${toolCallId}.`);
        continue;
      }

      if (!pendingToolCallIds.includes(toolCallId)) {
        issues.push(`Dropped tool message for unexpected tool_call_id ${toolCallId}.`);
        continue;
      }

      normalized.push(message);
      pendingToolCallIds = pendingToolCallIds.filter((id) => id !== toolCallId);
      continue;
    }

    flushPendingToolCalls('a non-tool message');
    normalized.push(message);
  }

  flushPendingToolCalls('the end of the message list');
  return { messages: normalized, repaired: issues.length > 0, issues };
}

export function validateOpenAIMessages(messages: OpenAIProtocolMessage[]): string[] {
  const errors: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message?.role !== 'tool') continue;

    const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id : null;
    if (!toolCallId) {
      errors.push(`Tool message ${i} is missing tool_call_id.`);
      continue;
    }

    // Walk back past sibling tool messages to find the owning assistant message.
    let j = i - 1;
    while (j >= 0 && messages[j]?.role === 'tool') j--;
    const owningAssistant = messages[j];
    const owningToolCallIds = getAssistantToolCallIds(owningAssistant);
    if (!owningAssistant || owningAssistant.role !== 'assistant' || owningToolCallIds.length === 0) {
      errors.push(`Tool message ${i} has no immediately preceding assistant tool_calls message.`);
      continue;
    }

    if (!owningToolCallIds.includes(toolCallId)) {
      errors.push(`Tool message ${i} references unexpected tool_call_id ${toolCallId}.`);
    }
  }

  return errors;
}

export function prepareOpenAIMessagesForSend(
  messages: OpenAIProtocolMessage[],
  options: OpenAIPreflightOptions = {},
): OpenAIProtocolRepair {
  const repair = normalizeOpenAIMessages(messages);

  if (repair.issues.length > 0) {
    options.onRepair?.(repair.issues);
  }

  const errors = validateOpenAIMessages(repair.messages);
  if (errors.length > 0) {
    const caller = options.caller ? `${options.caller}: ` : '';
    throw new Error(`${caller}OpenAI message pre-flight failed: ${errors.join(' | ')}`);
  }

  return repair;
}

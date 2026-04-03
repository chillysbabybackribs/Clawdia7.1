type ToolRepairReason = 'user_interrupted' | 'session_recovery' | 'protocol_repair';

type ProtocolBlock = {
  type?: string;
  id?: string;
  tool_use_id?: string;
  content?: unknown;
};

type ProtocolMessage = {
  role?: string;
  content?: unknown;
};

export interface AnthropicProtocolRepair {
  messages: ProtocolMessage[];
  repaired: boolean;
  issues: string[];
}

export interface AnthropicPreflightOptions {
  caller?: string;
  closePendingToolUses?: boolean;
  pendingToolUseReason?: ToolRepairReason;
  onRepair?: (issues: string[]) => void;
}

export interface AnthropicRequestWithMessages<TMessage = ProtocolMessage> {
  messages: TMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function getContentBlocks(message: ProtocolMessage): ProtocolBlock[] | null {
  return Array.isArray(message?.content) ? (message.content as ProtocolBlock[]) : null;
}

export function getAnthropicAssistantToolUseIds(message: ProtocolMessage | undefined | null): string[] {
  const content = message ? getContentBlocks(message) : null;
  if (!content || message?.role !== 'assistant') return [];

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const block of content) {
    if (block?.type !== 'tool_use' || typeof block.id !== 'string' || seen.has(block.id)) continue;
    seen.add(block.id);
    ids.push(block.id);
  }
  return ids;
}

function makeInterruptedToolResult(toolUseId: string, reason: ToolRepairReason): ProtocolBlock {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: JSON.stringify({
      status: 'interrupted',
      reason,
      message: 'Tool run was interrupted before completion.',
    }),
  };
}

export function findPendingAnthropicToolUseIds(messages: ProtocolMessage[]): string[] {
  let pending: string[] = [];

  for (const message of messages) {
    const toolUseIds = getAnthropicAssistantToolUseIds(message);
    if (toolUseIds.length > 0) {
      pending = toolUseIds;
      continue;
    }

    const content = getContentBlocks(message);
    if (message?.role === 'user' && content?.every((block) => block?.type === 'tool_result')) {
      pending = [];
      continue;
    }

    if (message?.role === 'user' && content?.some((block) => block?.type === 'tool_result')) {
      pending = [];
      continue;
    }

    if (pending.length > 0 && message) pending = [];
  }

  return pending;
}

export function normalizeAnthropicMessages(
  messages: ProtocolMessage[],
  options: {
    closePendingToolUses?: boolean;
    pendingToolUseReason?: ToolRepairReason;
  } = {},
): AnthropicProtocolRepair {
  const closePendingToolUses = options.closePendingToolUses ?? true;
  const pendingToolUseReason = options.pendingToolUseReason ?? 'protocol_repair';
  const normalized: ProtocolMessage[] = [];
  const issues: string[] = [];
  let pendingToolUseIds: string[] = [];

  const flushPendingToolUses = (why: string) => {
    if (!closePendingToolUses || pendingToolUseIds.length === 0) return;
    normalized.push({
      role: 'user',
      content: pendingToolUseIds.map((toolUseId) => makeInterruptedToolResult(toolUseId, pendingToolUseReason)),
    });
    issues.push(`Inserted synthetic tool_result blocks for pending tool_use ids ${pendingToolUseIds.join(', ')} before ${why}.`);
    pendingToolUseIds = [];
  };

  for (const originalMessage of messages) {
    if (!isRecord(originalMessage)) {
      flushPendingToolUses('a non-object message');
      normalized.push(originalMessage as ProtocolMessage);
      continue;
    }

    const message: ProtocolMessage = { ...originalMessage };
    const content = getContentBlocks(message);

    if (message.role === 'assistant') {
      flushPendingToolUses('a later assistant message');
      normalized.push(message);
      pendingToolUseIds = getAnthropicAssistantToolUseIds(message);
      continue;
    }

    if (message.role === 'user' && content) {
      const toolResults = content.filter((block) => block?.type === 'tool_result' && typeof block.tool_use_id === 'string');
      const nonToolResults = content.filter((block) => block?.type !== 'tool_result' && !(block?.type === 'text' && !(block as any).text));

      if (toolResults.length === 0) {
        flushPendingToolUses('a non-tool user message');
        if (Array.isArray(message.content)) {
          const filtered = message.content.filter((b: any) => !(b?.type === 'text' && !b.text));
          normalized.push({ ...message, content: filtered.length > 0 ? filtered : message.content });
        } else if (typeof message.content === 'string' && !message.content) {
          // Empty-string content is rejected by Anthropic. Use a zero-width space placeholder.
          normalized.push({ ...message, content: '\u200b' });
          issues.push('Replaced empty string user message content with placeholder.');
        } else {
          normalized.push(message);
        }
        continue;
      }

      const allowedIds = new Set(pendingToolUseIds);
      const seenToolResultIds = new Set<string>();
      const acceptedToolResults: ProtocolBlock[] = [];

      for (const block of toolResults) {
        const toolUseId = block.tool_use_id!;
        if (!allowedIds.has(toolUseId)) {
          issues.push(`Dropped orphaned tool_result for ${toolUseId}.`);
          continue;
        }
        if (seenToolResultIds.has(toolUseId)) {
          issues.push(`Dropped duplicate tool_result for ${toolUseId}.`);
          continue;
        }
        seenToolResultIds.add(toolUseId);
        acceptedToolResults.push(block);
      }

      if (allowedIds.size > 0) {
        const missingIds = pendingToolUseIds.filter((toolUseId) => !seenToolResultIds.has(toolUseId));
        const repairedContent = [
          ...acceptedToolResults,
          ...missingIds.map((toolUseId) => makeInterruptedToolResult(toolUseId, pendingToolUseReason)),
        ];

        if (repairedContent.length > 0) {
          if (missingIds.length > 0) {
            issues.push(`Closed missing tool_result blocks for ${missingIds.join(', ')}.`);
          }
          normalized.push({ ...message, content: repairedContent });
        }
      } else if (acceptedToolResults.length > 0) {
        normalized.push({ ...message, content: acceptedToolResults });
      }

      pendingToolUseIds = [];

      if (nonToolResults.length > 0) {
        issues.push('Split mixed user content so tool_result blocks are isolated.');
        normalized.push({ ...message, content: nonToolResults });
      }

      continue;
    }

    flushPendingToolUses('a later non-user message');
    normalized.push(message);
  }

  flushPendingToolUses('the end of the message list');

  // Strip trailing assistant messages that contain only text (no tool_use blocks).
  // These are assistant-prefill stubs (e.g. 'Understood.') that models without
  // prefill support will reject with a 400 error.
  while (normalized.length > 0) {
    const last = normalized[normalized.length - 1];
    if (last?.role !== 'assistant') break;
    const blocks = getContentBlocks(last);
    const hasToolUse = blocks ? blocks.some((b) => b?.type === 'tool_use') : false;
    if (hasToolUse) break;
    normalized.pop();
    issues.push('Stripped trailing assistant text message (prefill not supported).');
  }

  return { messages: normalized, repaired: issues.length > 0, issues };
}

export function validateAnthropicMessages(messages: ProtocolMessage[]): string[] {
  const errors: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const content = getContentBlocks(message);
    if (message?.role !== 'user' || !content) continue;

    const toolResults = content.filter((block) => block?.type === 'tool_result' && typeof block.tool_use_id === 'string');
    if (toolResults.length === 0) continue;

    if (toolResults.length !== content.length) {
      errors.push(`User message ${i} mixes tool_result blocks with other content.`);
    }

    const previous = messages[i - 1];
    const previousToolUseIds = getAnthropicAssistantToolUseIds(previous);
    if (!previous || previous.role !== 'assistant' || previousToolUseIds.length === 0) {
      errors.push(`User message ${i} contains tool_result blocks without an immediately preceding assistant tool_use message.`);
      continue;
    }

    const allowedIds = new Set(previousToolUseIds);
    const seenToolResultIds = new Set<string>();
    for (const block of toolResults) {
      const toolUseId = block.tool_use_id!;
      if (!allowedIds.has(toolUseId)) {
        errors.push(`User message ${i} contains unexpected tool_use_id ${toolUseId}.`);
      }
      if (seenToolResultIds.has(toolUseId)) {
        errors.push(`User message ${i} repeats tool_use_id ${toolUseId}.`);
      }
      seenToolResultIds.add(toolUseId);
    }
  }

  return errors;
}

export function prepareAnthropicMessagesForSend(
  messages: ProtocolMessage[],
  options: AnthropicPreflightOptions = {},
): AnthropicProtocolRepair {
  const repair = normalizeAnthropicMessages(messages, {
    closePendingToolUses: options.closePendingToolUses,
    pendingToolUseReason: options.pendingToolUseReason,
  });

  if (repair.issues.length > 0) {
    options.onRepair?.(repair.issues);
  }

  const errors = validateAnthropicMessages(repair.messages);
  if (errors.length > 0) {
    const caller = options.caller ? `${options.caller}: ` : '';
    throw new Error(`${caller}Anthropic message pre-flight failed: ${errors.join(' | ')}`);
  }

  return repair;
}

export function prepareAnthropicRequestBodyForSend<TBody extends AnthropicRequestWithMessages>(
  body: TBody,
  options: AnthropicPreflightOptions = {},
): TBody {
  const repair = prepareAnthropicMessagesForSend(body.messages as ProtocolMessage[], options);
  return {
    ...body,
    messages: repair.messages as TBody['messages'],
  };
}

export function closePendingAnthropicToolUses(
  messages: ProtocolMessage[],
  reason: ToolRepairReason = 'user_interrupted',
): boolean {
  const repair = normalizeAnthropicMessages(messages, {
    closePendingToolUses: true,
    pendingToolUseReason: reason,
  });
  if (!repair.repaired) return false;

  messages.splice(0, messages.length, ...repair.messages);
  return repair.issues.some((issue) => issue.includes('Inserted synthetic tool_result blocks'));
}

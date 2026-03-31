interface GeminiMessageProtocolOptions {
  caller: string;
  onRepair?: (issues: string[]) => void;
}

function toGeminiRole(role: unknown): 'user' | 'model' {
  return role === 'assistant' || role === 'model' ? 'model' : 'user';
}

function convertContentToParts(content: unknown): any[] {
  if (Array.isArray(content)) {
    const parts = content.flatMap((block) => {
      if (!block || typeof block !== 'object') return [];
      const typedBlock = block as Record<string, unknown>;

      if (typeof typedBlock.text === 'string') return [{ text: typedBlock.text }];
      if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') return [{ text: typedBlock.text }];

      if (
        typedBlock.type === 'tool_use'
        && typeof typedBlock.name === 'string'
        && typedBlock.input
        && typeof typedBlock.input === 'object'
      ) {
        return [{ functionCall: { name: typedBlock.name, args: typedBlock.input } }];
      }

      if (
        typedBlock.type === 'tool_result'
        && typeof typedBlock.name === 'string'
        && typedBlock.content != null
      ) {
        return [{ functionResponse: { name: typedBlock.name, response: { result: typedBlock.content } } }];
      }

      if (typedBlock.inlineData || typedBlock.functionCall || typedBlock.functionResponse) {
        return [typedBlock];
      }

      return [];
    });

    return parts;
  }

  if (typeof content === 'string') return [{ text: content }];
  if (content == null) return [];

  try {
    return [{ text: JSON.stringify(content) }];
  } catch {
    return [{ text: String(content) }];
  }
}

export function prepareGeminiMessagesForSend(
  messages: any[],
  options: GeminiMessageProtocolOptions,
): { messages: any[]; issues: string[] } {
  const issues: string[] = [];

  const normalized = messages.map((message, index) => {
    if (!message || typeof message !== 'object') return message;

    const currentRole = toGeminiRole((message as Record<string, unknown>).role);
    const currentParts = Array.isArray((message as Record<string, unknown>).parts)
      ? (message as Record<string, unknown>).parts as any[]
      : null;

    if (currentParts) {
      if ((message as Record<string, unknown>).role !== currentRole) {
        issues.push(`message[${index}] role normalized to ${currentRole}`);
      }
      return { ...message, role: currentRole, parts: currentParts };
    }

    const parts = convertContentToParts((message as Record<string, unknown>).content);
    issues.push(`message[${index}] content converted to Gemini parts`);
    return { role: currentRole, parts };
  });

  if (issues.length > 0) options.onRepair?.(issues);

  return { messages: normalized, issues };
}

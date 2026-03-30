/**
 * ProviderClient — minimal interface for a model provider turn.
 *
 * A single "turn" is one round-trip to the model: you send messages + context,
 * and receive a (possibly tool-requesting) response.
 */

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AssistantMessage {
  role: 'assistant';
  content: Array<{ type: string; [key: string]: unknown }>;
}

export interface ProviderTurnRequest {
  /** Stable run identifier (for logging / tracing). */
  runId: string;
  /** Conversation the run belongs to. */
  conversationId: string;
  /** Provider to use (e.g. 'anthropic'). */
  providerId: string;
  /** Model to use (e.g. 'claude-sonnet-4-6'). */
  modelId: string;
  /** The latest user message text. */
  input: string;
  /** Full message history to send to the model. */
  messages: Array<{ role: string; content: unknown }>;
  /** Prior conversation turns (used to seed the first request). */
  history: Array<{ role: string; content: unknown }>;
}

export interface ProviderTurnResult {
  /** Structured assistant message (verbatim from provider). */
  assistantMessage: AssistantMessage;
  /** Plain-text portion of the response (empty if stop_reason is tool_use). */
  text: string;
  /** Tool calls the model wants to make (empty if stop_reason is end_turn). */
  toolCalls: ToolCall[];
  /** Why the model stopped. */
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | string;
}

export interface ProviderClient {
  readonly providerId: string;
  runTurn(request: ProviderTurnRequest): Promise<ProviderTurnResult>;
}

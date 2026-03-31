// src/main/agent/types.ts
import type { BrowserService } from '../core/browser/BrowserService';
import type { MessageAttachment, PromptDebugSnapshot } from '../../shared/types';

export type ToolGroup = 'core' | 'browser' | 'desktop' | 'coding' | 'full';
export type ModelTier = 'fast' | 'standard' | 'powerful';
export type SpecialMode = 'app_mapping';
export type MappingPhase = 'phase1' | 'phase2';
export type BrowserMode = 'plan' | 'act' | 'extract' | 'recover' | 'validate';

export interface AgentProfile {
  toolGroup: ToolGroup;
  modelTier: ModelTier;
  isGreeting: boolean;
  isContinuation?: boolean;
  specialMode?: SpecialMode;
  mappingTarget?: string;
  mappingPhase?: MappingPhase;
}

export interface LoopOptions {
  provider: 'anthropic' | 'openai' | 'gemini';
  apiKey: string;
  model: string;           // resolved model ID (e.g. 'claude-sonnet-4-6')
  runId: string;
  conversationId?: string;  // used to scope browser tool calls to a per-conversation tab
  currentIteration?: number;
  maxIterations?: number;  // default 50
  signal?: AbortSignal;
  forcedProfile?: Partial<AgentProfile>;
  unrestrictedMode?: boolean;
  browserService?: BrowserService;
  attachments?: MessageAttachment[];
  onText: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolActivity?: (activity: ToolActivity) => void;
  onPromptDebug?: (snapshot: PromptDebugSnapshot) => void;
  onSystemPrompt?: (prompt: string) => void;
}

export interface ToolActivity {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  detail?: string;
  input?: string;         // NEW
  output?: string;        // NEW
  durationMs?: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: string;
}

export interface BrowserBudgetState {
  searchRounds: number;
  inspectedTargets: Set<string>;
  backgroundTabs: number;
  scrollFallbacks: Map<string, number>;
}

export interface DispatchContext {
  runId: string;
  signal: AbortSignal;
  iterationIndex: number;
  toolCallCount: number;
  allToolCalls: ToolCallRecord[];
  browserBudget: BrowserBudgetState;
  browserMode: BrowserMode;
  options: LoopOptions;
  /** Live reference to the messages array for context_status and self-aware tools */
  messages: unknown[];
}

export interface VerificationResult {
  issue: string;
  context: string;
}

// Provider-agnostic message format used inside the loop
export type LoopRole = 'user' | 'assistant';
export interface LoopMessage {
  role: LoopRole;
  content: string;
}

// What streamLLM returns each iteration
export interface LLMTurn {
  text: string;
  toolBlocks: ToolUseBlock[];
  /** Tool schemas discovered via search_tools this iteration (Anthropic format) */
  discoveredTools?: import('@anthropic-ai/sdk').default.Tool[];
  /** stop_reason from the API (e.g. 'end_turn', 'tool_use', 'pause_turn') */
  stopReason?: string;
  /** Full raw content blocks from the API response — needed to pass server_tool_use back correctly */
  rawContent?: unknown[];
}

export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

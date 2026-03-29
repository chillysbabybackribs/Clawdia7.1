// src/main/agent/types.ts
import type { BrowserService } from '../core/browser/BrowserService';
import type { MessageAttachment, PromptDebugSnapshot } from '../../shared/types';

export type ToolGroup = 'core' | 'browser' | 'desktop' | 'coding' | 'full';
export type ModelTier = 'fast' | 'standard' | 'powerful';
export type SpecialMode = 'app_mapping';
export type MappingPhase = 'phase1' | 'phase2';

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
  options: LoopOptions;
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
}

export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

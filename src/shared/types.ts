import type { ProviderId } from './model-registry';

export interface MessageIteration {
  text: string;          // LLM narration for this iteration (may be '')
  toolCalls: ToolCall[]; // tool calls dispatched after this text (may be [])
}

// Flat append-only feed item — renderer-only, NOT persisted to DB
export type FeedItem =
  | { kind: 'tool'; tool: ToolCall }
  | { kind: 'text'; text: string; isStreaming?: boolean };

export interface MessageAttachment {
  id: string;
  kind: 'image' | 'file';
  name: string;
  size: number;
  mimeType: string;
  path?: string;
  dataUrl?: string;
  textContent?: string;
}

export interface MessageLinkPreview {
  id: string;
  title: string;
  url: string;
  hostname: string;
  imageUrl?: string;
  sourceLabel?: string;
}

export interface MessageFileRef {
  rawText: string;
  resolvedPath: string;
  exists?: boolean;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  type?: 'chat' | 'pipeline';         // undefined = 'chat'
  content: string;
  timestamp: string;
  attachments?: MessageAttachment[];
  linkPreviews?: MessageLinkPreview[];
  fileRefs?: MessageFileRef[];
  toolCalls?: ToolCall[];
  iterations?: MessageIteration[];   // legacy, kept for DB-loaded messages
  feed?: FeedItem[];                 // renderer-only — NOT persisted to DB
  isStreaming?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  detail?: string;
  durationMs?: number;
  previewHints?: MessageLinkPreview[];
  rating?: 'up' | 'down' | null;
  ratingNote?: string;  // annotation for thumbs-down: "unnecessary step", "wrong target", etc.
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  messageCount?: number;
  mode?: 'chat' | 'claude_terminal';
  claudeTerminalStatus?: 'idle' | 'starting' | 'ready' | 'working' | 'errored' | 'stopped';
  claudeTerminalSessionId?: string | null;
}

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  active: boolean;
}

export type AgentType = 'web_data' | 'spreadsheet' | 'email' | 'files' | 'research' | 'general';
export type AgentStatus = 'draft' | 'ready' | 'disabled';
export type AgentOperationMode = 'read_only' | 'suggest_only' | 'approval_required' | 'semi_autonomous';
export type AgentMutationPolicy = 'no_mutation' | 'create_copies_only' | 'may_modify_with_approval' | 'may_modify_in_scope';
export type AgentApprovalPolicy = 'always_ask' | 'ask_on_sensitive_actions' | 'ask_on_external_actions' | 'minimal' | 'never_ask';
export type AgentLaunchMode = 'manual' | 'browser_context' | 'file_context' | 'url_input' | 'schedule';
export type AgentOutputMode = 'preview' | 'csv' | 'json' | 'spreadsheet' | 'chat_message' | 'file_output';
export type AgentTestStatus = 'untested' | 'passed' | 'failed';

export interface AgentResourceScope {
  browserDomains?: string[];
  urls?: string[];
  folders?: string[];
  files?: string[];
  apps?: string[];
  sessions?: string[];
  selectedContext?: Array<'current_browser_page' | 'selected_file' | 'selected_folder' | 'selected_text'>;
}

export interface WebDataField {
  id: string;
  label: string;
  kind: 'text' | 'number' | 'url' | 'date' | 'image' | 'custom';
  sample?: string;
}

export interface WebDataAgentConfig {
  sourceMode: 'current_page' | 'current_domain' | 'specific_urls' | 'multiple_domains';
  sources: string[];
  allowedDomains: string[];
  requiresAuthSession: boolean;
  fields: WebDataField[];
  extractionScope: 'current_page_only' | 'all_items_on_page' | 'paginate_results' | 'specific_urls_only';
  paginationEnabled: boolean;
  followDetailPages: boolean;
  maxPages: number;
  maxItems: number;
  rowMode: 'row_per_item' | 'row_per_page';
}

export interface AgentBlueprintOutput {
  mode: AgentOutputMode;
  target?: string;
  summary: string;
}

export interface AgentBlueprint {
  objective: string;
  inputs: string[];
  scope: string[];
  constraints: string[];
  steps: string[];
  output: AgentBlueprintOutput;
  successCriteria: string[];
  assumptions: string[];
  openQuestions: string[];
}

export interface AgentBuilderCompileInput {
  goal: string;
  refinement?: string;
  currentBlueprint?: AgentBlueprint;
}

export interface AgentBuilderCompileResult {
  name: string;
  description: string;
  agentType: AgentType;
  outputMode: AgentOutputMode;
  outputTarget?: string;
  resourceScope: AgentResourceScope;
  blueprint: AgentBlueprint;
  questions: string[];
  warnings: string[];
  model?: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  agentType: AgentType;
  status: AgentStatus;
  goal: string;
  blueprint?: AgentBlueprint;
  successDescription?: string;
  resourceScope: AgentResourceScope;
  operationMode: AgentOperationMode;
  mutationPolicy: AgentMutationPolicy;
  approvalPolicy: AgentApprovalPolicy;
  launchModes: AgentLaunchMode[];
  defaultLaunchMode: AgentLaunchMode;
  config: WebDataAgentConfig | Record<string, any>;
  outputMode: AgentOutputMode;
  outputTarget?: string;
  schedule?: Record<string, any> | null;
  lastTestStatus: AgentTestStatus;
  lastTestSummary?: string;
  lastRunAt?: string;
  lastRunStatus?: RunStatus | 'idle';
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunHistoryItem {
  runId: string;
  agentId: string;
  launchMode: AgentLaunchMode;
  sourceContext?: Record<string, any>;
  status: RunStatus;
  title: string;
  goal: string;
  startedAt: number;
  completedAt?: number;
  toolCallCount: number;
  toolCompletedCount: number;
  toolFailedCount: number;
  conversationId: string;
  error?: string;
}

export type AgentProfile =
  | 'general'
  | 'filesystem'
  | 'bloodhound'
  | 'ytdlp'
  // Swarm agent profiles
  | 'coordinator'
  | 'scout'
  | 'builder'
  | 'analyst'
  | 'writer'
  | 'reviewer'
  | 'data'
  | 'devops'
  | 'security'
  | 'synthesizer';

// ─── Swarm Types ───────────────────────────────────────────────────────────────

export type SwarmAgentStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type SwarmStrategy = 'single_pass' | 'staged_fanout' | 'staged_reduce';
export type SwarmFanOutDimension = 'none' | 'entities' | 'urls' | 'files' | 'claims' | 'options';
export type SwarmStageKind = 'discover' | 'shortlist' | 'verify' | 'extract' | 'compare' | 'synthesize' | 'critique';
export type SwarmWorkerRole = 'discoverer' | 'verifier' | 'extractor' | 'analyst' | 'synthesizer' | 'critic';
export type WorkUnitStatus = 'pending' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'skipped';
export type SwarmMergePolicy = 'evidence_first' | 'best_effort' | 'strict_consensus';
export type SwarmStopConditionKind = 'coverage_reached' | 'budget_exhausted' | 'failure_rate_high' | 'login_blocked' | 'low_confidence';

export interface SwarmBudget {
  maxWorkers: number;
  maxParallelBrowserWorkers: number;
  maxToolCalls: number;
  maxToolCallsPerUnit: number;
  maxWallMs: number;
  maxBackgroundTabs: number;
}

export interface SwarmStopCondition {
  kind: SwarmStopConditionKind;
  threshold?: number;
  note?: string;
}

export interface SwarmStage {
  id: string;
  kind: SwarmStageKind;
  label: string;
  workerRole: SwarmWorkerRole;
  parallelism: number;
  headlessBrowser: boolean;
  goalTemplate: string;
  inputPolicy: 'user_input' | 'prior_stage' | 'evidence_ledger';
  completionRule: string;
  allowedToolFamilies: Array<'browser' | 'filesystem' | 'document' | 'memory' | 'core'>;
}

export interface WorkUnitFailure {
  reason: string;
  category: 'login_required' | 'rate_limited' | 'navigation_failed' | 'budget_exhausted' | 'insufficient_signal' | 'unknown';
  fixHint?: string;
}

export interface WorkUnit {
  id: string;
  stageId: string;
  kind: SwarmFanOutDimension | 'general';
  goal: string;
  input: Record<string, any>;
  priority: number;
  budget: {
    maxToolCalls: number;
    maxWallMs: number;
    maxBackgroundTabs?: number;
  };
  status: WorkUnitStatus;
  resultSummary?: string;
  evidenceRefs: string[];
  failure?: WorkUnitFailure;
}

export interface SwarmEvidenceRecord {
  id: string;
  workUnitId: string;
  stageId: string;
  claim: string;
  confidence: number;
  sourceRefs: string[];
  payload: Record<string, any>;
}

export interface SwarmPlan {
  strategy: SwarmStrategy;
  fanOutDimension: SwarmFanOutDimension;
  objective: string;
  rationale: string;
  stages: SwarmStage[];
  budgets: SwarmBudget;
  mergePolicy: SwarmMergePolicy;
  stopConditions: SwarmStopCondition[];
}

export interface SwarmAgent {
  id: string;               // unique sub-agent id
  role: AgentProfile;       // which profile is running
  goal: string;             // short description of what this agent is doing
  status: SwarmAgentStatus;
  startedAt?: number;
  completedAt?: number;
  toolCallCount: number;
  result?: string;          // truncated result summary
  error?: string;
}

export interface SwarmState {
  runId: string;            // parent run id
  totalAgents: number;
  agents: SwarmAgent[];
  startedAt: number;
  completedAt?: number;
}
export type WorkflowStage = 'starting' | 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed' | 'cancelled';

export interface ProcessInfo {
  id: string;
  conversationId: string;
  status: 'running' | 'awaiting_approval' | 'needs_human' | 'completed' | 'failed' | 'cancelled';
  summary: string;
  startedAt: number;
  completedAt?: number;
  toolCallCount: number;
  toolCompletedCount?: number;
  toolFailedCount?: number;
  error?: string;
  isAttached: boolean;
  wasDetached: boolean;
  provider?: ProviderId;
  model?: string;
  agentProfile?: AgentProfile;
  lastSpecializedTool?: string;
  workflowStage?: WorkflowStage;
}

export type RunStatus = 'running' | 'awaiting_approval' | 'needs_human' | 'completed' | 'failed' | 'cancelled';

export interface RunSummary {
  id: string;
  conversationId: string;
  title: string;
  goal: string;
  status: RunStatus;
  startedAt: number;
  completedAt?: number;
  toolCallCount: number;
  toolCompletedCount?: number;
  toolFailedCount?: number;
  error?: string;
  wasDetached: boolean;
  provider?: ProviderId;
  model?: string;
  workflowStage?: WorkflowStage;
}

export interface RunArtifact {
  id: number;
  runId: string;
  kind:
    | 'execution_plan'
    | 'execution_graph_scaffold'
    | 'execution_graph_state'
    | 'evidence_ledger'
    | 'work_units'
    | 'bootstrap_results';
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunEvent {
  id: number;
  runId: string;
  seq: number;
  timestamp: string;
  kind: string;
  phase?: string | null;
  surface?: string | null;
  toolName?: string | null;
  payload: Record<string, any>;
}

export interface RunChange {
  id: number;
  runId: string;
  eventId?: number;
  changeType: string;
  target: string;
  summary: string;
  diffText?: string;
  createdAt: string;
}

export interface RunApproval {
  id: number;
  runId: string;
  status: 'pending' | 'approved' | 'denied';
  actionType: string;
  target: string;
  summary: string;
  request: Record<string, any>;
  createdAt: string;
  resolvedAt?: string;
}

export interface RunHumanIntervention {
  id: number;
  runId: string;
  status: 'pending' | 'resolved' | 'dismissed';
  interventionType: 'password' | 'otp' | 'captcha' | 'native_dialog' | 'site_confirmation' | 'conflict_resolution' | 'manual_takeover' | 'unknown';
  target?: string;
  summary: string;
  instructions?: string;
  request: Record<string, any>;
  createdAt: string;
  resolvedAt?: string;
}

export type BrowserExecutionMode = 'headed' | 'headless' | 'persistent_session';
export type PerformanceStance = 'conservative' | 'standard' | 'aggressive';

export type { ProviderId };

export interface PolicyRule {
  id: string;
  enabled: boolean;
  match: {
    toolNames?: string[];
    commandPatterns?: string[];
    pathPrefixes?: string[];
  };
  effect: 'allow' | 'deny' | 'require_approval';
  reason: string;
}

export interface PolicyProfile {
  id: string;
  name: string;
  scopeType: 'global' | 'workspace' | 'task_type';
  scopeValue?: string;
  rules: PolicyRule[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatSendResult {
  ok?: boolean;
  runId?: string;
  response?: string;
  toolCalls?: ToolCall[];
  conversationId?: string | null;
  error?: string;
}

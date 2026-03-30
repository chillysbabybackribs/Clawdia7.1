/**
 * RunTelemetry — lightweight per-run instrumentation for Clawdia chat executor.
 *
 * Captures turn-level, tool-call-level, and task-level metrics and writes them
 * as newline-delimited JSON to ~/.config/Clawdia/run-telemetry.jsonl.
 *
 * No external dependencies. No behavior changes. Console output mirrors the JSONL.
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TurnMetrics {
  event: 'turn';
  runId: string;
  turn: number;
  provider: string;
  model: string;
  toolCallCount: number;
  /** text_only | tools_only | text_and_tools */
  turnShape: 'text_only' | 'tools_only' | 'text_and_tools';
  /** total chars of all serialized tool results injected back into context this turn */
  toolResultCharsInjected: number;
  /** cumulative chars injected across all turns so far */
  cumulativeResultCharsInjected: number;
  hasError: boolean;
  hasApprovalPending: boolean;
  timestampMs: number;
}

export interface ToolCallMetrics {
  event: 'tool_call';
  runId: string;
  turn: number;
  toolName: string;
  domain: string;
  action: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  success: boolean;
  approvalRequired: boolean;
  resultSizeBeforeTruncation: number;
  resultSizeAfterTruncation: number;
  truncated: boolean;
  /** for rediscovery detection: serialized key of the call (name + payload fingerprint) */
  callKey: string;
}

export interface InefficencyFlag {
  event: 'inefficiency';
  runId: string;
  turn: number;
  kind:
    | 'repeated_tool_same_payload'
    | 'repeated_browser_list_tabs'
    | 'repeated_browser_get_page_info'
    | 'repeated_fs_read_file_same_path'
    | 'repeated_desktop_list_apps'
    | 'retry_after_approval_pending'
    | 'retry_after_error';
  toolName: string;
  detail: string;
  timestampMs: number;
}

export interface TaskSummary {
  event: 'task_summary';
  runId: string;
  provider: string;
  model: string;
  totalTurns: number;
  totalToolCalls: number;
  /** map of tool name → call count */
  toolFrequency: Record<string, number>;
  approvalsEncountered: number;
  errorsEncountered: number;
  totalResultCharsBeforeTruncation: number;
  totalResultCharsAfterTruncation: number;
  truncationEvents: number;
  longestToolDurationMs: number;
  longestToolName: string;
  repeatedIdenticalCallCount: number;
  /** how the run ended */
  termination: 'success' | 'max_turns' | 'empty_response' | 'error' | 'interrupted';
  totalWallMs: number;
  inefficiencyFlags: InefficencyFlag['kind'][];
}

// ── Telemetry class ───────────────────────────────────────────────────────────

export class RunTelemetry {
  private readonly startMs: number;
  private cumulativeResultCharsInjected = 0;
  private totalResultCharsBeforeTruncation = 0;
  private totalResultCharsAfterTruncation = 0;
  private truncationEvents = 0;
  private approvalsEncountered = 0;
  private errorsEncountered = 0;
  private longestToolDurationMs = 0;
  private longestToolName = '';
  private readonly toolFrequency: Record<string, number> = {};
  private readonly callHistory: string[] = []; // callKey per call, in order
  private repeatedIdenticalCallCount = 0;
  private readonly inefficiencyFlags: InefficencyFlag[] = [];
  private readonly logPath: string;

  // Per-turn state (reset each turn)
  private turnToolResultChars = 0;
  private turnHasError = false;
  private turnHasApprovalPending = false;

  // Rediscovery tracking: last 3 call keys per tool name
  private readonly recentCallKeys = new Map<string, string[]>();

  constructor(
    readonly runId: string,
    readonly provider: string,
    readonly model: string,
  ) {
    this.startMs = Date.now();
    const configDir = join(homedir(), '.config', 'Clawdia');
    try {
      mkdirSync(configDir, { recursive: true });
    } catch {
      // already exists
    }
    this.logPath = join(configDir, 'run-telemetry.jsonl');
  }

  // ── Turn lifecycle ──────────────────────────────────────────────────────────

  beginTurn(): void {
    this.turnToolResultChars = 0;
    this.turnHasError = false;
    this.turnHasApprovalPending = false;
  }

  recordTurn(turn: number, toolCallCount: number, hasText: boolean): void {
    const shape: TurnMetrics['turnShape'] =
      toolCallCount > 0 && hasText ? 'text_and_tools'
      : toolCallCount > 0          ? 'tools_only'
      :                              'text_only';

    this.cumulativeResultCharsInjected += this.turnToolResultChars;

    const metrics: TurnMetrics = {
      event: 'turn',
      runId: this.runId,
      turn,
      provider: this.provider,
      model: this.model,
      toolCallCount,
      turnShape: shape,
      toolResultCharsInjected: this.turnToolResultChars,
      cumulativeResultCharsInjected: this.cumulativeResultCharsInjected,
      hasError: this.turnHasError,
      hasApprovalPending: this.turnHasApprovalPending,
      timestampMs: Date.now(),
    };

    this.write(metrics);
  }

  // ── Tool call lifecycle ─────────────────────────────────────────────────────

  beginToolCall(toolName: string, domain: string, action: string, payload: Record<string, unknown>): { startMs: number; callKey: string } {
    const startMs = Date.now();
    const callKey = this.makeCallKey(toolName, payload);
    return { startMs, callKey };
  }

  recordToolCall(
    turn: number,
    toolName: string,
    domain: string,
    action: string,
    startMs: number,
    callKey: string,
    success: boolean,
    approvalRequired: boolean,
    rawResultSize: number,
    serializedResultSize: number,
  ): void {
    const endMs = Date.now();
    const durationMs = endMs - startMs;
    const truncated = serializedResultSize < rawResultSize;

    this.totalResultCharsBeforeTruncation += rawResultSize;
    this.totalResultCharsAfterTruncation += serializedResultSize;
    if (truncated) this.truncationEvents++;
    if (!success) this.turnHasError = true;
    if (approvalRequired) {
      this.turnHasApprovalPending = true;
      this.approvalsEncountered++;
    }
    if (!success && !approvalRequired) this.errorsEncountered++;

    this.turnToolResultChars += serializedResultSize;

    if (durationMs > this.longestToolDurationMs) {
      this.longestToolDurationMs = durationMs;
      this.longestToolName = toolName;
    }

    this.toolFrequency[toolName] = (this.toolFrequency[toolName] ?? 0) + 1;

    // Rediscovery detection
    this.detectInefficiency(turn, toolName, callKey, approvalRequired, success);

    // Track call history (cap at 500 to prevent unbounded growth)
    this.callHistory.push(callKey);
    if (this.callHistory.length > 500) this.callHistory.splice(0, this.callHistory.length - 500);
    const recent = this.recentCallKeys.get(toolName) ?? [];
    recent.push(callKey);
    if (recent.length > 5) recent.shift();
    this.recentCallKeys.set(toolName, recent);

    const metrics: ToolCallMetrics = {
      event: 'tool_call',
      runId: this.runId,
      turn,
      toolName,
      domain,
      action,
      startMs,
      endMs,
      durationMs,
      success,
      approvalRequired,
      resultSizeBeforeTruncation: rawResultSize,
      resultSizeAfterTruncation: serializedResultSize,
      truncated,
      callKey,
    };

    this.write(metrics);
  }

  // ── Inefficiency detection ──────────────────────────────────────────────────

  private detectInefficiency(
    turn: number,
    toolName: string,
    callKey: string,
    approvalRequired: boolean,
    success: boolean,
  ): void {
    const recent = this.recentCallKeys.get(toolName) ?? [];

    // Repeated identical call (same tool + same payload).
    // browser.extract_text always has an empty payload — its context changes via navigate,
    // so repeated calls after navigation are legitimate and should not be flagged.
    const skipRepeatedCheck = toolName === 'browser.extract_text';
    if (!skipRepeatedCheck && recent.includes(callKey)) {
      this.repeatedIdenticalCallCount++;
      this.flagInefficiency(turn, 'repeated_tool_same_payload', toolName,
        `${toolName} called again with identical payload (key=${callKey})`);
    }

    // Surface-specific repetition flags (even if payload differs) — fire on 2nd+ call
    if (toolName === 'browser.list_tabs' && recent.length >= 1) {
      this.flagInefficiency(turn, 'repeated_browser_list_tabs', toolName,
        `browser.list_tabs called ${recent.length + 1} times recently — model may be re-discovering tab state`);
    }
    if (toolName === 'browser.get_page_info' && recent.length >= 1) {
      this.flagInefficiency(turn, 'repeated_browser_get_page_info', toolName,
        `browser.get_page_info called ${recent.length + 1} times recently without visible state change`);
    }
    if (toolName === 'desktop.list_apps' && recent.length >= 1) {
      this.flagInefficiency(turn, 'repeated_desktop_list_apps', toolName,
        `desktop.list_apps called ${recent.length + 1} times recently`);
    }

    // Retry after approval pending
    if (approvalRequired) {
      const lastKey = recent[recent.length - 1];
      if (lastKey && !lastKey.includes('approval')) {
        this.flagInefficiency(turn, 'retry_after_approval_pending', toolName,
          `${toolName} retried while prior call had approval pending`);
      }
    }

    // Retry after error
    if (!success && !approvalRequired) {
      const lastKey = recent[recent.length - 1];
      if (lastKey) {
        this.flagInefficiency(turn, 'retry_after_error', toolName,
          `${toolName} retried after a prior call returned an error`);
      }
    }
  }

  private flagInefficiency(turn: number, kind: InefficencyFlag['kind'], toolName: string, detail: string): void {
    const flag: InefficencyFlag = {
      event: 'inefficiency',
      runId: this.runId,
      turn,
      kind,
      toolName,
      detail,
      timestampMs: Date.now(),
    };
    this.inefficiencyFlags.push(flag);
    this.write(flag);
  }

  // ── Task summary ────────────────────────────────────────────────────────────

  finalize(
    termination: TaskSummary['termination'],
    totalTurns: number,
  ): TaskSummary {
    const totalToolCalls = this.callHistory.length;
    const summary: TaskSummary = {
      event: 'task_summary',
      runId: this.runId,
      provider: this.provider,
      model: this.model,
      totalTurns,
      totalToolCalls,
      toolFrequency: { ...this.toolFrequency },
      approvalsEncountered: this.approvalsEncountered,
      errorsEncountered: this.errorsEncountered,
      totalResultCharsBeforeTruncation: this.totalResultCharsBeforeTruncation,
      totalResultCharsAfterTruncation: this.totalResultCharsAfterTruncation,
      truncationEvents: this.truncationEvents,
      longestToolDurationMs: this.longestToolDurationMs,
      longestToolName: this.longestToolName,
      repeatedIdenticalCallCount: this.repeatedIdenticalCallCount,
      termination,
      totalWallMs: Date.now() - this.startMs,
      inefficiencyFlags: this.inefficiencyFlags.map(f => f.kind),
    };

    this.write(summary);
    console.log('[RunTelemetry] SUMMARY', JSON.stringify(summary, null, 2));
    return summary;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private makeCallKey(toolName: string, payload: Record<string, unknown>): string {
    // Stable fingerprint: tool name + sorted payload keys + truncated values
    const payloadStr = Object.entries(payload)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
      .join(',');
    return `${toolName}|${payloadStr}`;
  }

  private write(record: TurnMetrics | ToolCallMetrics | InefficencyFlag | TaskSummary): void {
    const line = JSON.stringify(record);
    try {
      appendFileSync(this.logPath, line + '\n', 'utf8');
    } catch {
      // non-fatal: filesystem unavailable
    }
    // Also log abbreviated form to console for immediate visibility
    if (record.event !== 'task_summary') {
      console.log(`[RunTelemetry] ${record.event}`, line);
    }
  }
}

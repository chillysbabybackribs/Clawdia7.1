// src/main/agent/dispatch.ts
import { executeShellTool } from '../core/cli/shellTools';
import { executeBrowserTool } from '../core/cli/browserTools';
import { truncateBrowserResult } from '../core/cli/truncate';
import { executeGuiInteract } from '../core/desktop';
import { executeDbusControl } from '../core/desktop/dbus';
import { trackToolCall, trackToolResult } from '../runTracker';
import { executeSearchTools } from '../core/cli/toolRegistry';
import { executeWorkspaceTool, WORKSPACE_TOOL_NAMES } from '../core/cli/workspaceTools';
import { executeMemoryStore, executeMemorySearch, executeMemoryForget } from './memoryExecutors';
import { executeSelfAwareTool, SELF_AWARE_TOOL_NAMES } from '../core/cli/selfAwareTools';
import { executeUIStateTool, UI_STATE_TOOL_NAMES } from '../core/cli/uiStateTools';
import { evaluatePolicy } from './policy-engine';
import type { DispatchContext, ToolUseBlock, ToolCallRecord } from './types';
import type Anthropic from '@anthropic-ai/sdk';

const MEMORY_TOOL_NAMES = new Set([
  'memory_store', 'memory_search', 'memory_forget',
]);

const SHELL_TOOL_NAMES = new Set([
  'shell_exec', 'bash', 'file_edit', 'str_replace_based_edit_tool',
  'file_list_directory', 'file_search',
]);

const BROWSER_TOOL_NAMES = new Set([
  'browser_navigate', 'browser_click', 'browser_type', 'browser_scroll',
  'browser_wait_for', 'browser_evaluate_js', 'browser_find_elements',
  'browser_get_page_state', 'browser_screenshot', 'browser_extract_text',
  'browser_new_tab', 'browser_switch_tab', 'browser_list_tabs',
  'browser_select', 'browser_hover', 'browser_key_press',
  'browser_close_tab', 'browser_get_element_text', 'browser_back', 'browser_forward',
]);

const DESKTOP_TOOL_NAMES = new Set([
  'gui_interact',
  'dbus_control',
]);

// ── Per-tool execution timeouts ───────────────────────────────────────────────
const TOOL_TIMEOUTS_MS: Record<string, number> = {
  shell:   30_000,
  browser: 60_000,
  desktop: 15_000,
  default: 30_000,
};

function toolTimeoutMs(name: string): number {
  if (SHELL_TOOL_NAMES.has(name))   return TOOL_TIMEOUTS_MS.shell;
  if (BROWSER_TOOL_NAMES.has(name)) return TOOL_TIMEOUTS_MS.browser;
  if (DESKTOP_TOOL_NAMES.has(name)) return TOOL_TIMEOUTS_MS.desktop;
  return TOOL_TIMEOUTS_MS.default;
}

function withTimeout<T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error(`Tool "${toolName}" timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timerId));
}

export interface DispatchResult {
  results: string[];
  /** Any tool schemas returned by search_tools calls this dispatch round */
  discoveredTools: Anthropic.Tool[];
}

export async function dispatch(
  toolBlocks: ToolUseBlock[],
  ctx: DispatchContext,
): Promise<DispatchResult> {
  const pairs = await Promise.all(
    toolBlocks.map(block => executeOne(block, ctx)),
  );

  const results = pairs.map(p => p.result);
  const discoveredTools: Anthropic.Tool[] = [];
  for (const p of pairs) {
    if (p.discoveredTools) discoveredTools.push(...p.discoveredTools);
  }

  // Track tool calls, keeping only the most recent 200 to prevent unbounded growth
  const MAX_TRACKED_TOOL_CALLS = 200;
  for (let i = 0; i < toolBlocks.length; i++) {
    const record: ToolCallRecord = {
      id: toolBlocks[i].id,
      name: toolBlocks[i].name,
      input: toolBlocks[i].input,
      result: results[i],
    };
    ctx.allToolCalls.push(record);
  }
  if (ctx.allToolCalls.length > MAX_TRACKED_TOOL_CALLS) {
    ctx.allToolCalls.splice(0, ctx.allToolCalls.length - MAX_TRACKED_TOOL_CALLS);
  }
  ctx.toolCallCount += toolBlocks.length;

  return { results, discoveredTools };
}

async function executeOne(
  block: ToolUseBlock,
  ctx: DispatchContext,
): Promise<{ result: string; discoveredTools?: Anthropic.Tool[] }> {
  if (ctx.signal.aborted) {
    return { result: JSON.stringify({ ok: false, error: 'Cancelled' }) };
  }

  const { options } = ctx;
  const startMs = Date.now();
  const argsSummary = JSON.stringify(block.input).slice(0, 120);

  // Intercept search_tools — execute locally, return discovered schemas
  if (block.name === 'search_tools') {
    const searchResult = executeSearchTools(block.input);
    const parsed = JSON.parse(searchResult) as { schemas?: Anthropic.Tool[]; tools_loaded?: string[] };
    const discoveredTools = (parsed.schemas ?? []) as Anthropic.Tool[];

    options.onToolActivity?.({
      id: block.id,
      name: 'search_tools',
      status: 'success',
      detail: `Loaded: ${parsed.tools_loaded?.join(', ') ?? 'catalog'}`,
      input: JSON.stringify(block.input, null, 2),
      output: searchResult,
      durationMs: Date.now() - startMs,
    });

    return { result: searchResult, discoveredTools };
  }

  const eventId = trackToolCall(ctx.runId, block.name, argsSummary);

  options.onToolActivity?.({
    id: block.id,
    name: block.name,
    status: 'running',
    detail: argsSummary,
    input: JSON.stringify(block.input, null, 2),
  });

  let result: string;
  let isError = false;

  try {
    result = await withTimeout(
      routeToolExecution(block, ctx),
      toolTimeoutMs(block.name),
      block.name,
    );
  } catch (err) {
    result = JSON.stringify({ ok: false, error: (err as Error).message });
    isError = true;
  }

  const durationMs = Date.now() - startMs;
  trackToolResult(ctx.runId, eventId, result.slice(0, 200), durationMs);

  options.onToolActivity?.({
    id: block.id,
    name: block.name,
    status: isError ? 'error' : 'success',
    detail: result.slice(0, 200),
    output: result,
    durationMs,
  });

  return { result };
}

async function routeToolExecution(
  block: ToolUseBlock,
  ctx: DispatchContext,
): Promise<string> {
  // ── Policy gate ───────────────────────────────────────────────────────────
  // search_tools is a local meta-operation with no side effects; exempt.
  if (block.name !== 'search_tools') {
    const decision = evaluatePolicy(block.name, block.input, { runId: ctx.runId });
    if (decision.effect === 'deny') {
      return JSON.stringify({
        ok: false,
        error: `[POLICY DENIED] ${decision.reason} (rule: ${decision.ruleId ?? 'none'}, profile: ${decision.profileName})`,
      });
    }
    if (decision.effect === 'require_approval') {
      return JSON.stringify({
        ok: false,
        error: `[POLICY HELD] Action requires approval: ${decision.reason}. Tool "${block.name}" was not executed.`,
      });
    }
  }
  // ── End policy gate ───────────────────────────────────────────────────────

  if (SHELL_TOOL_NAMES.has(block.name)) {
    return executeShellTool(block.name, block.input);
  }

  if (BROWSER_TOOL_NAMES.has(block.name)) {
    const { browserService } = ctx.options;
    if (!browserService) {
      return JSON.stringify({ ok: false, error: 'Browser not available' });
    }
    const output = await executeBrowserTool(block.name, block.input, browserService);
    return truncateBrowserResult(JSON.stringify(output));
  }

  if (DESKTOP_TOOL_NAMES.has(block.name)) {
    if (block.name === 'gui_interact') {
      return executeGuiInteract(block.input);
    }
    if (block.name === 'dbus_control') {
      return executeDbusControl(block.input);
    }
  }

  if (WORKSPACE_TOOL_NAMES.has(block.name)) {
    return executeWorkspaceTool(block.name, block.input);
  }

  if (MEMORY_TOOL_NAMES.has(block.name)) {
    if (block.name === 'memory_store')  return executeMemoryStore(block.input);
    if (block.name === 'memory_search') return executeMemorySearch(block.input);
    if (block.name === 'memory_forget') return executeMemoryForget(block.input);
  }

  if (SELF_AWARE_TOOL_NAMES.has(block.name)) {
    return executeSelfAwareTool(block.name, block.input, ctx, ctx.messages);
  }

  if (UI_STATE_TOOL_NAMES.has(block.name)) {
    return executeUIStateTool(block.name, block.input);
  }

  return JSON.stringify({ ok: false, error: `Unknown tool: ${block.name}` });
}

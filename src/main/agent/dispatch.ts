// src/main/agent/dispatch.ts
import { executeShellTool } from '../core/cli/shellTools';
import { executeBrowserTool } from '../core/cli/browserTools';
import { executeCDPTool } from '../core/cli/cdpTools';
import { executeSystemTool } from '../core/cli/systemExecutor';
import { truncateBrowserResult } from '../core/cli/truncate';
import { executeGuiInteract } from '../core/desktop';
import { executeDbusControl } from '../core/desktop/dbus';
import { trackToolCall, trackToolResult } from '../runTracker';
import { executeSearchTools } from '../core/cli/toolRegistry';
import { executeWorkspaceTool, WORKSPACE_TOOL_NAMES } from '../core/cli/workspaceTools';
import { executeMemoryStore, executeMemorySearch, executeMemoryForget } from './memoryExecutors';
import { executeSelfAwareTool, SELF_AWARE_TOOL_NAMES } from '../core/cli/selfAwareTools';
import { executeUIStateTool, UI_STATE_TOOL_NAMES } from '../core/cli/uiStateTools';
import { executeTerminalTool, TERMINAL_TOOL_NAMES } from '../core/cli/terminalTools';
import { evaluatePolicy } from './policy-engine';
import type { DispatchContext, ToolUseBlock, ToolCallRecord } from './types';
import type Anthropic from '@anthropic-ai/sdk';
import type { ElectronBrowserService } from '../core/browser/ElectronBrowserService';

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
  'browser_select', 'browser_hover', 'browser_right_click', 'browser_double_click',
  'browser_drag', 'browser_key_press',
  'browser_click_at', 'browser_double_click_at', 'browser_drag_coords',
  'browser_move_to', 'browser_scroll_at', 'browser_verify_action',
  'browser_close_tab', 'browser_get_element_text', 'browser_back', 'browser_forward',
  'browser_stop_loading', 'browser_wait_for_network_idle', 'browser_wait_for_navigation',
  'browser_get_network_activity', 'browser_set_user_agent',
]);

const DESKTOP_TOOL_NAMES = new Set([
  'gui_interact',
  'dbus_control',
]);

const CDP_TOOL_NAMES = new Set([
  'browser_cdp_mouse', 'browser_cdp_key', 'browser_cdp_touch',
  'browser_cdp_fetch_enable', 'browser_cdp_fetch_disable', 'browser_cdp_fetch_continue',
  'browser_cdp_fetch_fulfill', 'browser_cdp_fetch_fail',
  'browser_cdp_cookies_get', 'browser_cdp_cookies_set', 'browser_cdp_cookies_delete',
  'browser_cdp_network_emulate',
  'browser_cdp_accessibility_tree', 'browser_cdp_accessibility_query', 'browser_cdp_dom_snapshot',
  'browser_cdp_emulate_device', 'browser_cdp_emulate_geolocation', 'browser_cdp_emulate_timezone',
  'browser_cdp_print_pdf', 'browser_cdp_file_chooser', 'browser_cdp_handle_dialog',
  'browser_cdp_storage_get', 'browser_cdp_storage_set', 'browser_cdp_storage_clear',
]);

const SYSTEM_TOOL_NAMES = new Set([
  'system_secret_store', 'system_secret_retrieve', 'system_secret_delete', 'system_secret_list',
  'system_fetch',
  'system_global_shortcut_register', 'system_global_shortcut_unregister', 'system_global_shortcut_list',
  'system_remote_desktop_init', 'system_remote_desktop_click', 'system_remote_desktop_type',
  'system_remote_desktop_key', 'system_remote_desktop_move', 'system_remote_desktop_close',
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
  if (CDP_TOOL_NAMES.has(name))     return TOOL_TIMEOUTS_MS.browser;
  if (DESKTOP_TOOL_NAMES.has(name)) return TOOL_TIMEOUTS_MS.desktop;
  if (SYSTEM_TOOL_NAMES.has(name))  return TOOL_TIMEOUTS_MS.default;
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
  /** Elapsed wall-clock time (ms) for each tool call, parallel-indexed with results */
  elapsedMs: number[];
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

  for (let i = 0; i < toolBlocks.length; i++) {
    const record: ToolCallRecord = {
      id: toolBlocks[i].id,
      name: toolBlocks[i].name,
      input: toolBlocks[i].input,
      result: results[i],
      startMs: pairs[i].startMs,
      endMs: pairs[i].endMs,
      elapsed_ms: pairs[i].endMs - pairs[i].startMs,
      success: pairs[i].success,
    };
    ctx.allToolCalls.push(record);
  }
  ctx.toolCallCount += toolBlocks.length;

  const elapsedMs = pairs.map(p => p.endMs - p.startMs);
  return { results, elapsedMs, discoveredTools };
}

interface ExecuteOneResult {
  result: string;
  startMs: number;
  endMs: number;
  success: boolean;
  discoveredTools?: Anthropic.Tool[];
}

async function executeOne(
  block: ToolUseBlock,
  ctx: DispatchContext,
): Promise<ExecuteOneResult> {
  const startMs = Date.now();

  if (ctx.signal.aborted) {
    const endMs = Date.now();
    return { result: JSON.stringify({ ok: false, error: 'Cancelled' }), startMs, endMs, success: false };
  }

  const { options } = ctx;
  const argsSummary = JSON.stringify(block.input).slice(0, 120);

  // Intercept search_tools — execute locally, return discovered schemas
  if (block.name === 'search_tools') {
    const searchResult = executeSearchTools(block.input);
    const endMs = Date.now();
    const parsed = JSON.parse(searchResult) as { schemas?: Anthropic.Tool[]; tools_loaded?: string[] };
    const discoveredTools = (parsed.schemas ?? []) as Anthropic.Tool[];

    options.onToolActivity?.({
      id: block.id,
      name: 'search_tools',
      status: 'success',
      detail: `Loaded: ${parsed.tools_loaded?.join(', ') ?? 'catalog'}`,
      input: JSON.stringify(block.input, null, 2),
      output: searchResult,
      durationMs: endMs - startMs,
    });

    return { result: searchResult, startMs, endMs, success: true, discoveredTools };
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

  const endMs = Date.now();
  const durationMs = endMs - startMs;
  trackToolResult(ctx.runId, eventId, result.slice(0, 200), durationMs);

  options.onToolActivity?.({
    id: block.id,
    name: block.name,
    status: isError ? 'error' : 'success',
    detail: result.slice(0, 200),
    output: result,
    durationMs,
  });

  return { result, startMs, endMs, success: !isError };
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
    const { browserService, conversationId } = ctx.options;
    if (!browserService) {
      return JSON.stringify({ ok: false, error: 'Browser not available' });
    }
    const output = await executeBrowserTool(block.name, block.input, browserService, conversationId);
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

  if (TERMINAL_TOOL_NAMES.has(block.name)) {
    const ctrl = ctx.options.terminalController;
    if (!ctrl) return JSON.stringify({ ok: false, error: 'Terminal controller not available' });
    return executeTerminalTool(block.name, block.input, ctrl);
  }

  if (CDP_TOOL_NAMES.has(block.name)) {
    const { browserService, conversationId } = ctx.options;
    if (!browserService) {
      return JSON.stringify({ ok: false, error: 'Browser not available' });
    }
    const ebs = browserService as ElectronBrowserService;
    const tabId = await ebs.getOrAssignTab(conversationId ?? '');
    const output = await executeCDPTool(block.name, block.input, ebs, tabId);
    return truncateBrowserResult(JSON.stringify(output));
  }

  if (SYSTEM_TOOL_NAMES.has(block.name)) {
    const output = await executeSystemTool(block.name, block.input);
    return JSON.stringify(output);
  }

  return JSON.stringify({ ok: false, error: `Unknown tool: ${block.name}` });
}

// src/main/agent/dispatch.ts
import { executeShellTool } from '../core/cli/shellTools';
import { executeBrowserTool } from '../core/cli/browserTools';
import { truncateBrowserResult } from '../core/cli/truncate';
import { executeGuiInteract } from '../core/desktop';
import { executeDbusControl } from '../core/desktop/dbus';
import { trackToolCall, trackToolResult } from '../runTracker';
import type { DispatchContext, ToolUseBlock, ToolCallRecord } from './types';

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

export async function dispatch(
  toolBlocks: ToolUseBlock[],
  ctx: DispatchContext,
): Promise<string[]> {
  const results = await Promise.all(
    toolBlocks.map(block => executeOne(block, ctx)),
  );

  for (let i = 0; i < toolBlocks.length; i++) {
    const record: ToolCallRecord = {
      id: toolBlocks[i].id,
      name: toolBlocks[i].name,
      input: toolBlocks[i].input,
      result: results[i],
    };
    ctx.allToolCalls.push(record);
  }
  ctx.toolCallCount += toolBlocks.length;

  return results;
}

async function executeOne(
  block: ToolUseBlock,
  ctx: DispatchContext,
): Promise<string> {
  if (ctx.signal.aborted) {
    return JSON.stringify({ ok: false, error: 'Cancelled' });
  }

  const { options } = ctx;
  const startMs = Date.now();
  const argsSummary = JSON.stringify(block.input).slice(0, 120);
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
    result = await routeToolExecution(block, ctx);
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

  return result;
}

async function routeToolExecution(
  block: ToolUseBlock,
  ctx: DispatchContext,
): Promise<string> {
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

  return JSON.stringify({ ok: false, error: `Unknown tool: ${block.name}` });
}

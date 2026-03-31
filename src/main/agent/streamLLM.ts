// src/main/agent/streamLLM.ts
import Anthropic from '@anthropic-ai/sdk';
import { modelHasCapability } from '../../shared/model-registry';
import { BROWSER_TOOLS } from '../core/cli/browserTools';
import { searchTools, toOpenAITool, toGeminiDeclaration, getSearchToolGemini, SEARCH_TOOL_OPENAI } from '../core/cli/toolRegistry';
import { SELF_AWARE_TOOLS } from '../core/cli/selfAwareTools';
import { DESKTOP_TOOLS } from '../core/desktop/tools';
import { streamAnthropicLLM } from '../anthropicChat';
import { streamOpenAILLM } from '../openaiChat';
import { streamGeminiLLM } from '../geminiChat';
import type { LLMTurn, LoopOptions, AgentProfile } from './types';
import type { PromptDebugSnapshot } from '../../shared/types';

/** The search_tools meta-tool schema in Anthropic format */
const SEARCH_TOOL_ANTHROPIC: Anthropic.Tool = {
  name: 'search_tools',
  description: 'Search for available tools by description or exact name. Call this FIRST to discover tools before using them. Returns full tool schemas you can then call.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Natural language description of what you want to do (e.g. "navigate a browser", "click GUI elements")',
      },
      names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exact tool names to load (e.g. ["browser_navigate", "gui_interact"])',
      },
    },
  },
};

// Server-side web tools — Anthropic runs these, no client execution needed.
// Dynamic filtering is built into the _20260209 versions (Opus 4.6 / Sonnet 4.6).
export const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search' } as any;
export const WEB_FETCH_TOOL  = { type: 'web_fetch_20260209',  name: 'web_fetch'  } as any;
export const WEB_TOOL_NAMES  = new Set(['web_search', 'web_fetch']);

const SHELL_TOOL_NAMES = ['shell_exec', 'file_edit', 'file_list_directory', 'file_search'];
const FIRST_TURN_BROWSER_TOOL_NAMES = new Set([
  'browser_get_page_state',
  'browser_navigate',
  'browser_extract_text',
  'browser_find_elements',
  'browser_get_element_text',
]);
const FIRST_TURN_BROWSER_TOOLS = BROWSER_TOOLS.filter((tool) => FIRST_TURN_BROWSER_TOOL_NAMES.has(tool.name));

// Per-profile tool schema caches for OpenAI and Gemini.
// Tool schemas are static within a run — no need to rebuild each iteration.
const _openAIToolCache = new Map<string, ReturnType<typeof toOpenAITool>[]>();
const _geminiToolCache = new Map<string, any[]>();

function applyAnthropicToolCompatibility(model: string, tools: Anthropic.Tool[]): Anthropic.Tool[] {
  // Some models (e.g. Haiku 4.5) do not support programmatic tool calling for
  // server web tools. Restrict those tools to direct invocation only.
  if (!modelHasCapability(model, 'restrictServerToolCallers')) return tools;

  return tools.map((tool) => {
    if (!WEB_TOOL_NAMES.has(tool.name)) return tool;
    return { ...(tool as any), allowed_callers: ['direct'] } as Anthropic.Tool;
  });
}

function getAnthropicTools(
  profile: AgentProfile,
  accumulated: Anthropic.Tool[] = [],
  currentIteration = 0,
): Anthropic.Tool[] {
  // app_mapping is a known fixed tool set — skip discovery overhead
  if (profile.specialMode === 'app_mapping') {
    return searchTools({
      names: [...SHELL_TOOL_NAMES, 'gui_interact'],
    }) as Anthropic.Tool[];
  }

  // 'full' means no specific tool group was detected — treat as conversational.
  // The LLM can call search_tools if it decides it needs something.
  if (profile.toolGroup === 'full') {
    return [SEARCH_TOOL_ANTHROPIC, ...SELF_AWARE_TOOLS];
  }

  const isBrowserProfile = profile.toolGroup === 'browser';
  const isFirstBrowserTurn = isBrowserProfile && currentIteration <= 1;

  const base: Anthropic.Tool[] = [
    ...searchTools({ names: SHELL_TOOL_NAMES }) as Anthropic.Tool[],
  ];

  if (!isBrowserProfile) {
    base.push(...SELF_AWARE_TOOLS);
  }

  if (isBrowserProfile) {
    // Server-side web tools first — cheaper and faster for research/recon tasks.
    // Electron browser tools follow for tasks needing real rendering/interaction.
    base.push(WEB_SEARCH_TOOL, WEB_FETCH_TOOL);
    base.push(...(isFirstBrowserTurn ? FIRST_TURN_BROWSER_TOOLS : BROWSER_TOOLS));
  }

  if (profile.toolGroup === 'desktop') {
    base.push(...DESKTOP_TOOLS);
  }

  if (profile.toolGroup !== 'browser' && profile.toolGroup !== 'desktop') {
    base.unshift(SEARCH_TOOL_ANTHROPIC);
  }

  // Merge in any tools discovered via search_tools in prior iterations
  for (const tool of accumulated) {
    if (!base.find(t => t.name === tool.name)) {
      base.push(tool);
    }
  }

  return base;
}

function buildOpenAITools(
  profile: AgentProfile,
  currentIteration = 0,
  accumulated: Anthropic.Tool[] = [],
): ReturnType<typeof toOpenAITool>[] {
  if (profile.specialMode === 'app_mapping') {
    return searchTools({
      names: [...SHELL_TOOL_NAMES, 'gui_interact'],
    }).map(toOpenAITool);
  }
  if (profile.toolGroup === 'full') {
    return [SEARCH_TOOL_OPENAI, ...SELF_AWARE_TOOLS.map(toOpenAITool)];
  }

  const shell = searchTools({ names: SHELL_TOOL_NAMES });
  const isBrowserProfile = profile.toolGroup === 'browser';
  const isFirstBrowserTurn = isBrowserProfile && currentIteration <= 1;
  const tools = [
    ...shell.map(toOpenAITool),
    ...(isBrowserProfile ? [] : SELF_AWARE_TOOLS.map(toOpenAITool)),
  ];
  if (profile.toolGroup === 'desktop') {
    tools.push(...searchTools({ names: ['gui_interact', 'dbus_control'] }).map(toOpenAITool));
  }
  if (isBrowserProfile) {
    tools.push(...(isFirstBrowserTurn ? FIRST_TURN_BROWSER_TOOLS : BROWSER_TOOLS).map(toOpenAITool));
  }

  // Merge in tools discovered via search_tools in prior iterations
  const existingNames = new Set(tools.map(t => (t as any).function?.name ?? ''));
  for (const tool of accumulated) {
    if (!existingNames.has(tool.name)) {
      tools.push(toOpenAITool(tool));
      existingNames.add(tool.name);
    }
  }

  return tools;
}

function getOpenAITools(
  profile: AgentProfile,
  currentIteration = 0,
  accumulated: Anthropic.Tool[] = [],
): ReturnType<typeof toOpenAITool>[] {
  // Only use the static cache when there are no accumulated tools — once
  // search_tools has run, each iteration may have a different tool set.
  if (accumulated.length === 0) {
    const iterationBucket = profile.toolGroup === 'browser' && currentIteration <= 1 ? 'first' : 'default';
    const key = `${profile.specialMode ?? ''}:${profile.toolGroup}:${iterationBucket}`;
    if (!_openAIToolCache.has(key)) {
      _openAIToolCache.set(key, buildOpenAITools(profile, currentIteration));
    }
    return _openAIToolCache.get(key)!;
  }
  return buildOpenAITools(profile, currentIteration, accumulated);
}

function buildGeminiTools(profile: AgentProfile, currentIteration = 0, accumulated: Anthropic.Tool[] = []): any[] {
  if (profile.specialMode === 'app_mapping') {
    return [{
      functionDeclarations: searchTools({
        names: [...SHELL_TOOL_NAMES, 'gui_interact'],
      }).map(toGeminiDeclaration),
    }];
  }
  if (profile.toolGroup === 'full') {
    return [{ functionDeclarations: [getSearchToolGemini(), ...SELF_AWARE_TOOLS.map(toGeminiDeclaration)] }];
  }

  const shellDecls = searchTools({ names: SHELL_TOOL_NAMES }).map(toGeminiDeclaration);
  const isBrowserProfile = profile.toolGroup === 'browser';
  const isFirstBrowserTurn = isBrowserProfile && currentIteration <= 1;
  const selfAwareDecls = isBrowserProfile ? [] : SELF_AWARE_TOOLS.map(toGeminiDeclaration);
  const desktopDecls = profile.toolGroup === 'desktop'
    ? searchTools({ names: ['gui_interact', 'dbus_control'] }).map(toGeminiDeclaration)
    : [];
  const decls = [getSearchToolGemini(), ...shellDecls, ...selfAwareDecls, ...desktopDecls];
  if (isBrowserProfile) {
    decls.push(...(isFirstBrowserTurn ? FIRST_TURN_BROWSER_TOOLS : BROWSER_TOOLS).map(toGeminiDeclaration));
  }

  // Merge in tools discovered via search_tools in prior iterations
  const existingNames = new Set(decls.map((d: any) => d.name ?? ''));
  for (const tool of accumulated) {
    if (!existingNames.has(tool.name)) {
      decls.push(toGeminiDeclaration(tool));
      existingNames.add(tool.name);
    }
  }

  return [{ functionDeclarations: decls }];
}

function getGeminiTools(profile: AgentProfile, currentIteration = 0, accumulated: Anthropic.Tool[] = []): any[] {
  if (accumulated.length === 0) {
    const iterationBucket = profile.toolGroup === 'browser' && currentIteration <= 1 ? 'first' : 'default';
    const key = `${profile.specialMode ?? ''}:${profile.toolGroup}:${iterationBucket}`;
    if (!_geminiToolCache.has(key)) {
      _geminiToolCache.set(key, buildGeminiTools(profile, currentIteration));
    }
    return _geminiToolCache.get(key)!;
  }
  return buildGeminiTools(profile, currentIteration, accumulated);
}

function serializeContent(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content ?? '');
    }
  }

  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return String(block ?? '');
      if (block.type === 'text') return block.text ?? '';
      if (block.type === 'tool_use') return `[tool_use] ${block.name} ${JSON.stringify(block.input ?? {})}`;
      if (block.type === 'tool_result') return `[tool_result] ${block.tool_use_id} ${typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? {})}`;
      if (block.type === 'image') return '[image]';
      if (block.image_url?.url) return '[image_url]';
      if (block.inlineData) return '[inline_data]';
      if (block.functionCall) return `[function_call] ${block.functionCall.name} ${JSON.stringify(block.functionCall.args ?? {})}`;
      if (block.functionResponse) return `[function_response] ${block.functionResponse.name} ${JSON.stringify(block.functionResponse.response ?? {})}`;
      try {
        return JSON.stringify(block);
      } catch {
        return '[unserializable_block]';
      }
    })
    .filter(Boolean)
    .join('\n');
}

function emitPromptDebug(
  messages: any[],
  fullPrompt: string,
  toolNames: string[],
  options: LoopOptions,
): void {
  const snapshot: PromptDebugSnapshot = {
    provider: options.provider,
    model: options.model,
    iteration: options.currentIteration ?? 0,
    systemPrompt: fullPrompt,
    toolNames,
    messages: messages.map((message) => ({
      role: message?.role ?? 'unknown',
      content: serializeContent(message?.content ?? message?.parts ?? ''),
    })),
  };

  console.log(
    [
      '[PromptDebug] BEGIN',
      `provider=${snapshot.provider}`,
      `model=${snapshot.model}`,
      `iteration=${snapshot.iteration}`,
      `tools=${snapshot.toolNames.join(', ') || 'none'}`,
      '--- SYSTEM PROMPT ---',
      snapshot.systemPrompt,
      '--- MESSAGES ---',
      ...snapshot.messages.map((message, index) => `[#${index + 1}] ${message.role}\n${message.content}`),
      '[PromptDebug] END',
    ].join('\n'),
  );

  options.onPromptDebug?.(snapshot);
}

function getOpenAIToolNames(tools: ReturnType<typeof toOpenAITool>[]): string[] {
  return tools.map((tool) => {
    const maybeFunction = (tool as any).function;
    if (maybeFunction?.name) return maybeFunction.name as string;
    return (tool as any).name ?? 'unknown_tool';
  });
}

/**
 * Inject dynamicPrompt as a brief prefix on the last user message so the
 * system prompt string stays identical across iterations (enabling cache hits).
 * Returns a new messages array — does not mutate the original.
 */
function injectDynamicPrompt(messages: any[], dynamicPrompt: string): any[] {
  if (!dynamicPrompt || messages.length === 0) return messages;
  const copy = [...messages];
  const last = copy[copy.length - 1];
  if (!last || last.role !== 'user') return copy;

  if (typeof last.content === 'string') {
    copy[copy.length - 1] = { ...last, content: `[${dynamicPrompt}]\n${last.content}` };
  } else if (Array.isArray(last.content)) {
    // Never inject into a tool_result message — Anthropic requires those to
    // contain only tool_result blocks, and mixing in a text block corrupts
    // the tool_use/tool_result pairing validation.
    const isToolResultMsg = last.content.every((b: any) => b.type === 'tool_result');
    if (isToolResultMsg) return copy;

    // Find the first text block and prepend, or insert a new text block at the start
    const blocks = [...last.content];
    const firstTextIdx = blocks.findIndex((b: any) => b.type === 'text');
    if (firstTextIdx >= 0) {
      blocks[firstTextIdx] = { ...blocks[firstTextIdx], text: `[${dynamicPrompt}]\n${blocks[firstTextIdx].text}` };
    } else {
      blocks.unshift({ type: 'text', text: `[${dynamicPrompt}]` });
    }
    copy[copy.length - 1] = { ...last, content: blocks };
  } else if (Array.isArray(last.parts)) {
    // Gemini format
    const parts = [...last.parts];
    const firstTextIdx = parts.findIndex((p: any) => typeof p.text === 'string');
    if (firstTextIdx >= 0) {
      parts[firstTextIdx] = { ...parts[firstTextIdx], text: `[${dynamicPrompt}]\n${parts[firstTextIdx].text}` };
    } else {
      parts.unshift({ text: `[${dynamicPrompt}]` });
    }
    copy[copy.length - 1] = { ...last, parts };
  }
  return copy;
}

export async function streamLLM(
  messages: any[],
  systemPrompt: string,
  dynamicPrompt: string,
  profile: AgentProfile,
  options: LoopOptions,
  accumulatedTools: Anthropic.Tool[] = [],
  toolMode: 'default' | 'none' = 'default',
): Promise<LLMTurn> {
  // Dynamic context goes into the user message, not the system prompt.
  // This keeps the system prompt string identical across iterations so
  // Anthropic's prompt cache (cache_control: ephemeral) actually hits.
  const messagesWithDynamic = injectDynamicPrompt(messages, dynamicPrompt);

  switch (options.provider) {
    case 'anthropic':
      {
        const anthropicTools = toolMode === 'none'
          ? []
          : applyAnthropicToolCompatibility(
              options.model,
              getAnthropicTools(profile, accumulatedTools, options.currentIteration ?? 0),
            );
        emitPromptDebug(messagesWithDynamic, systemPrompt, anthropicTools.map((tool) => tool.name), options);
        return streamAnthropicLLM(messagesWithDynamic, systemPrompt, anthropicTools, options);
      }
    case 'openai':
      {
        const openaiTools = toolMode === 'none' ? [] : getOpenAITools(profile, options.currentIteration ?? 0, accumulatedTools);
        emitPromptDebug(messagesWithDynamic, systemPrompt, getOpenAIToolNames(openaiTools), options);
        return streamOpenAILLM(messagesWithDynamic, systemPrompt, openaiTools, options);
      }
    case 'gemini':
      {
        const geminiTools = toolMode === 'none' ? [] : getGeminiTools(profile, options.currentIteration ?? 0, accumulatedTools);
        const geminiToolNames = (geminiTools[0]?.functionDeclarations ?? []).map((d: any) => d.name as string);
        emitPromptDebug(messagesWithDynamic, systemPrompt, geminiToolNames, options);
        return streamGeminiLLM(messagesWithDynamic, systemPrompt, geminiTools, options);
      }
    default:
      throw new Error(`Unknown provider: ${(options as any).provider}`);
  }
}

// ── Test exports (tree-shaken in production builds) ──────────────────────────
export const injectDynamicPromptForTest = injectDynamicPrompt;
export const getAnthropicToolsForTest = getAnthropicTools;
export const applyAnthropicToolCompatibilityForTest = applyAnthropicToolCompatibility;
export const getOpenAIToolsForTest = getOpenAITools;
export const getGeminiToolsForTest = getGeminiTools;
export const buildOpenAIToolsForTest = buildOpenAITools;
export const buildGeminiToolsForTest = buildGeminiTools;

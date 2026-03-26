// src/main/core/cli/toolRegistry.ts
import type Anthropic from '@anthropic-ai/sdk';
import { Type } from '@google/genai';
import type OpenAI from 'openai';
import { BROWSER_TOOLS } from './browserTools';
import { MEMORY_TOOLS } from './memoryTools';
import { SHELL_TOOLS_OPENAI } from './shellTools';

type OAITool = OpenAI.Chat.Completions.ChatCompletionTool;

// ── Canonical tool registry ───────────────────────────────────────────────────
// All tools indexed by name. Shell tools are stored in Anthropic schema format
// (name + description + input_schema) for a single source of truth.

const SHELL_TOOLS_CANONICAL: Anthropic.Tool[] = SHELL_TOOLS_OPENAI.map(t => ({
  name: t.function.name,
  description: t.function.description ?? '',
  input_schema: t.function.parameters as Anthropic.Tool['input_schema'],
}));

const ALL_TOOLS: Anthropic.Tool[] = [
  ...SHELL_TOOLS_CANONICAL,
  ...BROWSER_TOOLS,
  ...MEMORY_TOOLS,
];

const TOOL_INDEX: Map<string, Anthropic.Tool> = new Map(
  ALL_TOOLS.map(t => [t.name, t])
);

// Keywords extracted from name + description for fuzzy matching
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[_\-]/g, ' ').split(/\s+/).filter(Boolean);
}

const TOOL_TOKENS: Map<string, string[]> = new Map(
  ALL_TOOLS.map(t => [t.name, tokenize(`${t.name} ${t.description}`)])
);

/**
 * Search tools by query string and/or exact names.
 * Returns matching tool schemas (Anthropic format).
 */
export function searchTools(opts: {
  query?: string;
  names?: string[];
  limit?: number;
}): Anthropic.Tool[] {
  const { query, names, limit = 10 } = opts;
  const results = new Map<string, Anthropic.Tool>();

  // Exact name lookups first
  if (names?.length) {
    for (const name of names) {
      const tool = TOOL_INDEX.get(name);
      if (tool) results.set(name, tool);
    }
  }

  // Fuzzy query matching
  if (query) {
    const queryTokens = tokenize(query);
    const scored: Array<{ tool: Anthropic.Tool; score: number }> = [];

    for (const tool of ALL_TOOLS) {
      if (results.has(tool.name)) continue; // already included by name
      const toolTokens = TOOL_TOKENS.get(tool.name) ?? [];
      let score = 0;
      for (const qt of queryTokens) {
        for (const tt of toolTokens) {
          if (tt === qt) score += 2;         // exact token match
          else if (tt.includes(qt)) score += 1; // substring match
        }
      }
      if (score > 0) scored.push({ tool, score });
    }

    scored.sort((a, b) => b.score - a.score);
    for (const { tool } of scored.slice(0, limit - results.size)) {
      results.set(tool.name, tool);
    }
  }

  return [...results.values()];
}

/** Convert Anthropic tool schema to OpenAI function tool format */
export function toOpenAITool(tool: Anthropic.Tool): OAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema as Record<string, unknown>,
    },
  };
}

/** Convert Anthropic tool schema to Gemini function declaration format */
export function toGeminiDeclaration(tool: Anthropic.Tool): Record<string, unknown> {
  const props = (tool.input_schema as any).properties ?? {};
  const required = (tool.input_schema as any).required ?? [];
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: Type.OBJECT,
      properties: Object.fromEntries(
        Object.entries(props).map(([k, v]: [string, any]) => [
          k,
          {
            type: v.type === 'number' ? Type.NUMBER : v.type === 'boolean' ? Type.BOOLEAN : Type.STRING,
            description: v.description ?? '',
          },
        ])
      ),
      required,
    },
  };
}

// ── search_tools meta-tool schemas ───────────────────────────────────────────

/** OpenAI function schema for the search_tools meta-tool */
export const SEARCH_TOOL_OPENAI: OAITool = {
  type: 'function',
  function: {
    name: 'search_tools',
    description: 'Search for available tools by description or exact name. Call this FIRST to discover tools before using them. Returns full tool schemas you can then call.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language description of what you want to do (e.g. "navigate a browser and click elements", "read and edit files")',
        },
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exact tool names to load (e.g. ["browser_navigate", "shell_exec"])',
        },
      },
    },
  },
};

/** Gemini function declaration for the search_tools meta-tool */
export function getSearchToolGemini(): Record<string, unknown> {
  return {
    name: 'search_tools',
    description: 'Search for available tools by description or exact name. Call this FIRST to discover tools before using them. Returns full tool schemas you can then call.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Natural language description of what you want to do',
        },
        names: {
          type: Type.STRING,
          description: 'Comma-separated exact tool names to load (e.g. "browser_navigate,shell_exec")',
        },
      },
    },
  };
}

/** Execute search_tools call and return result string */
export function executeSearchTools(args: Record<string, unknown>): string {
  const query = args.query as string | undefined;
  // Gemini passes names as comma-separated string; OpenAI passes array
  let names: string[] | undefined;
  if (Array.isArray(args.names)) {
    names = args.names as string[];
  } else if (typeof args.names === 'string' && args.names) {
    names = (args.names as string).split(',').map(s => s.trim()).filter(Boolean);
  }

  if (!query && (!names || names.length === 0)) {
    // Return all tool names and descriptions as a catalog
    return JSON.stringify({
      available_tools: ALL_TOOLS.map(t => ({ name: t.name, description: t.description })),
      hint: 'Call search_tools with a query or names to get full schemas.',
    });
  }

  const found = searchTools({ query, names });
  if (found.length === 0) {
    return JSON.stringify({
      error: 'No matching tools found',
      available_tools: ALL_TOOLS.map(t => t.name),
    });
  }

  return JSON.stringify({
    tools_loaded: found.map(t => t.name),
    schemas: found,
  });
}

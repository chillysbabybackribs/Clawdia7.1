// src/main/agent/streamLLM.ts
import Anthropic from '@anthropic-ai/sdk';
import { BROWSER_TOOLS } from '../core/cli/browserTools';
import { searchTools, toOpenAITool, toGeminiDeclaration, getSearchToolGemini } from '../core/cli/toolRegistry';
import { streamAnthropicLLM } from '../anthropicChat';
import { streamOpenAILLM } from '../openaiChat';
import { streamGeminiLLM } from '../geminiChat';
import type { LLMTurn, LoopOptions, AgentProfile } from './types';

const ANTHROPIC_SHELL_TOOLS: Anthropic.Tool[] = [
  {
    name: 'shell_exec',
    description: 'Execute a bash shell command on the local system.',
    input_schema: { type: 'object' as const, properties: { command: { type: 'string' } }, required: ['command'] },
  },
  {
    name: 'file_edit',
    description: 'Read and edit files. command: view|create|str_replace. path: file path.',
    input_schema: { type: 'object' as const, properties: { command: { type: 'string' }, path: { type: 'string' }, file_text: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['command', 'path'] },
  },
  {
    name: 'file_list_directory',
    description: 'List directory contents as structured JSON.',
    input_schema: { type: 'object' as const, properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'file_search',
    description: 'Search files with regex pattern. Returns JSON matches.',
    input_schema: { type: 'object' as const, properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' } }, required: ['pattern'] },
  },
];

function getAnthropicTools(profile: AgentProfile): Anthropic.Tool[] {
  const tools = [...ANTHROPIC_SHELL_TOOLS];
  if (profile.toolGroup === 'browser' || profile.toolGroup === 'full') {
    tools.push(...BROWSER_TOOLS);
  }
  return tools;
}

function getOpenAITools(profile: AgentProfile): ReturnType<typeof toOpenAITool>[] {
  const shell = searchTools({ names: ['shell_exec', 'file_edit', 'file_list_directory', 'file_search'] });
  const tools = shell.map(toOpenAITool);
  if (profile.toolGroup === 'browser' || profile.toolGroup === 'full') {
    const browserSchemas = searchTools({ query: 'browser', limit: 30 });
    tools.push(...browserSchemas.map(toOpenAITool));
  }
  return tools;
}

function getGeminiTools(profile: AgentProfile): any[] {
  const shellDecls = searchTools({ names: ['shell_exec', 'file_edit', 'file_list_directory', 'file_search'] }).map(toGeminiDeclaration);
  const decls = [getSearchToolGemini(), ...shellDecls];
  if (profile.toolGroup === 'browser' || profile.toolGroup === 'full') {
    const browserDecls = searchTools({ query: 'browser', limit: 30 }).map(toGeminiDeclaration);
    decls.push(...browserDecls);
  }
  return [{ functionDeclarations: decls }];
}

export async function streamLLM(
  messages: any[],
  systemPrompt: string,
  dynamicPrompt: string,
  profile: AgentProfile,
  options: LoopOptions,
): Promise<LLMTurn> {
  const fullPrompt = dynamicPrompt ? `${systemPrompt}\n\n${dynamicPrompt}` : systemPrompt;

  switch (options.provider) {
    case 'anthropic':
      return streamAnthropicLLM(messages, fullPrompt, getAnthropicTools(profile), options);
    case 'openai':
      return streamOpenAILLM(messages, fullPrompt, getOpenAITools(profile), options);
    case 'gemini':
      return streamGeminiLLM(messages, fullPrompt, getGeminiTools(profile), options);
    default:
      throw new Error(`Unknown provider: ${(options as any).provider}`);
  }
}

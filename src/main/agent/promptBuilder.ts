// src/main/agent/promptBuilder.ts
import type { AgentProfile, DispatchContext } from './types';

const TOOL_GROUP_GUIDANCE: Record<AgentProfile['toolGroup'], string> = {
  browser: 'You have browser tools available. Use them to navigate, extract, and interact with web pages.',
  desktop: 'You have desktop automation tools. Use screenshots and GUI interaction to complete tasks.',
  coding: 'You have file and shell tools. Prefer reading existing code before modifying it.',
  core: 'You have file system tools. Use file_list_directory and file_search before shell commands.',
  full: 'You have the full tool set. Choose the right tool for each step.',
};

export function buildStaticPrompt(profile: AgentProfile, unrestrictedMode: boolean): string {
  const groupGuidance = TOOL_GROUP_GUIDANCE[profile.toolGroup];

  const base = `You are an agentic assistant with access to local CLI tools and a browser.

${groupGuidance}

CRITICAL RULES:
1. Always use your tools — never tell the user to run commands themselves.
2. Do not ask for permission before using tools unless the action is permanently destructive (deleting files, dropping databases).
3. When a task involves web content, use browser tools directly — do not instruct the user to open a browser.`;

  if (unrestrictedMode) {
    return base + `

UNRESTRICTED MODE — ACTIVE:
- Full autonomy to install, download, update, or configure anything needed.
- If a tool, binary, or package is missing: install it using shell_exec and proceed.
- Never refuse a task because you lack a capability — acquire it and complete the task.`;
  }

  return base;
}

export function buildDynamicPrompt(profile: AgentProfile, ctx: DispatchContext): string {
  const parts: string[] = [];

  parts.push(`[Iteration ${ctx.iterationIndex + 1} | Tools called so far: ${ctx.toolCallCount}]`);

  const { browserBudget } = ctx;
  if (profile.toolGroup === 'browser' || profile.toolGroup === 'full') {
    parts.push(
      `Browser budget remaining: searches ${2 - browserBudget.searchRounds}/2, ` +
      `targets ${6 - browserBudget.inspectedTargets.size}/6, ` +
      `tabs ${6 - browserBudget.backgroundTabs}/6`,
    );
  }

  if (ctx.iterationIndex >= 25) {
    parts.push('You are approaching the iteration limit. Begin wrapping up and produce a final answer.');
  }

  return parts.join('\n');
}

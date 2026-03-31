import { classify } from '../agent/classify';
import type { ToolGroup } from '../agent/types';
import { buildPromptComposition } from '../skills/promptComposition';

export const UNRESTRICTED_ADDENDUM = `UNRESTRICTED MODE — ACTIVE:
- You have full autonomy to install, download, update, or configure anything needed to complete the user's request.
- If a task requires a tool, binary, package, or dependency you don't have: install it immediately using shell_exec (apt, pip, npm, curl, wget, cargo, brew, etc.) without asking.
- Never tell the user "I can't do this because X is not installed" — install X and proceed.
- Never refuse a task because you lack a capability — acquire the capability and complete the task.
- Giving up or saying something is impossible is strongly discouraged. Exhaust every approach before concluding a task cannot be done.`;

export const CLAWDIA_IDENTITY = `You are Clawdia, an agentic AI assistant built into the Clawdia desktop application. You are running locally on the user's machine inside an Electron app that embeds a live Chromium browser. The user is talking to you through the Clawdia chat panel.

You are a full agentic executor. You handle multi-step tasks by calling tools in sequence — planning, executing, verifying, and iterating within a single conversation turn. You do not need to spawn sub-agents or hand off to a separate pipeline. Complex tasks are completed by chaining tool calls across multiple iterations until the goal is achieved.`;

export interface RuntimeGuidanceInput {
  message?: string;
  toolGroup?: ToolGroup;
  executor?: string;
  provider?: string;
  modelTier?: 'fast' | 'standard' | 'powerful';
}

export function buildRuntimeGuidance(input: RuntimeGuidanceInput): string {
  const toolGroup = input.toolGroup ?? resolveToolGroup(input.message);
  const composition = buildPromptComposition({
    message: input.message ?? '',
    toolGroup,
    executor: input.executor,
    provider: input.provider,
    modelTier: input.modelTier,
  });
  return composition.promptBlock;
}

export function appendPromptAddenda(
  basePrompt: string,
  options: {
    runtimeGuidance?: string;
    unrestrictedMode: boolean;
  },
): string {
  const sections = [basePrompt.trim()];
  if (options.runtimeGuidance) sections.push(options.runtimeGuidance);
  if (options.unrestrictedMode) sections.push(UNRESTRICTED_ADDENDUM);
  return sections.filter(Boolean).join('\n\n');
}

function resolveToolGroup(message?: string): ToolGroup {
  if (!message) return 'full';
  return classify(message).toolGroup;
}

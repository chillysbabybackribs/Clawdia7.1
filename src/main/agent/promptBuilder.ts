// src/main/agent/promptBuilder.ts
import type { AgentProfile, DispatchContext, BrowserMode } from './types';
import { CLAWDIA_IDENTITY, appendPromptAddenda } from '../prompts/promptAssembler';
import { detectStall as detectRecoveryStall } from './recoveryGuidance';

const TOOL_GROUP_GUIDANCE: Record<AgentProfile['toolGroup'], string> = {
  browser: `You have browser tools available. Use them to navigate, extract, and interact with web pages.

As you work, stream usable information to the user as soon as you have it — do not wait until everything is done. For each step:
- Before calling a tool: briefly state what you're about to do and why (1 sentence).
- After getting a result: immediately share any useful finding, fact, or partial answer you can confirm.
- For search, navigation, URL, and "what page is this" tasks: you must use browser tools to inspect the actual page or search results. Do not answer from memory.
- Treat navigation as an intermediate step, not the finish line, unless the user explicitly asked only to open/go to a page.
- If the user asked you to do something on a site, continue interacting until that task is completed or you are genuinely blocked.
- If a page has the answer, extract and state it right away rather than continuing to browse.
- After navigation, verify the page cheaply first: prefer browser_get_page_state for URL/title/text excerpt and browser_extract_text if needed.
- Use browser_screenshot only when the task is explicitly visual, layout-dependent, or the cheaper checks are ambiguous.`,

  desktop: `You have desktop automation tools. Use screenshots and GUI interaction to complete tasks.

Narrate each action as you take it — what you see, what you're clicking, and what changed.

CRITICAL CONTEXT — READ BEFORE USING GUI TOOLS:
- You are running INSIDE Clawdia, a desktop AI assistant application. The chat window you are responding in IS Clawdia.
- When you take a screenshot, Clawdia itself will be visible on screen. Do NOT interact with the Clawdia UI (the chat panel, input box, sidebar, etc.) — that is your own interface, not a target app.
- Only interact with the application the user has explicitly asked you to automate. If no target app is specified, ask before using gui_interact.
- Use gui_query first to understand what GUI capabilities are available on this system before acting.
- On Wayland, prefer a11y_* (accessibility) actions over coordinate-based clicks — they are more reliable.`,

  coding: 'You have file and shell tools. Prefer reading existing code before modifying it.',
  core: 'You have file system tools. Use file_list_directory and file_search before shell commands.',
  full: `You have the full tool set. Choose the right tool for each step.

CONTEXT: You are running INSIDE Clawdia, a desktop AI assistant application. If you use gui_interact or take screenshots, Clawdia's own UI will be visible — do NOT interact with it. Only automate apps the user has explicitly asked you to control.`,
};

export function buildStaticPrompt(
  profile: AgentProfile,
  unrestrictedMode: boolean,
  runtimeGuidance = '',
): string {
  const groupGuidance = TOOL_GROUP_GUIDANCE[profile.toolGroup];

  const body = `${CLAWDIA_IDENTITY}

You have access to local CLI tools and a browser.

${groupGuidance}

CRITICAL RULES:
1. Always use your tools — never tell the user to run commands themselves.
2. Do not ask for permission before using tools unless the action is permanently destructive (deleting files, dropping databases).
3. When a task involves web content, use browser tools directly — do not instruct the user to open a browser.`;
  return appendPromptAddenda(body, { runtimeGuidance, unrestrictedMode });
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

  if (detectRecoveryStall(ctx.allToolCalls)) {
    parts.push('Stall detected: you are repeating the same tool pattern without new evidence. Change strategy immediately and use a different grounding or recovery approach.');
  }

  return parts.join('\n');
}
export { detectStall } from './recoveryGuidance';

export function advanceBrowserMode(
  current: BrowserMode,
  _toolNames: string[],
  _results: string[],
  _stalled: boolean,
): BrowserMode {
  return current;
}

// src/main/agent/promptBuilder.ts
import type { AgentProfile, DispatchContext } from './types';
import { CLAWDIA_IDENTITY, appendPromptAddenda } from '../prompts/promptAssembler';
import { detectStall as detectRecoveryStall } from './recoveryGuidance';
import { buildServiceHintBlock } from './serviceResolver';

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

TOOL SELECTION RULES:
- app_launch: Use ONLY when you need to start an app that is not yet running. It launches the binary AND waits for the window to appear.
- attach_window: Use when the app is already open, or when you opened it via shell/xdg-open yourself. It finds the window immediately (waits up to 8s for it to appear) and focuses it.
- close_window: Cleanly closes any open app window. Use this to dismiss file managers, dialogs, or any app when done.
- Do NOT use app_launch if the window is already open — use attach_window instead.

CRITICAL CONTEXT — READ BEFORE USING GUI TOOLS:
- You are running INSIDE Clawdia, a desktop AI assistant application. The chat window you are responding in IS Clawdia.
- When you take a screenshot, Clawdia itself will be visible on screen. Do NOT interact with the Clawdia UI (the chat panel, input box, sidebar, etc.) — that is your own interface, not a target app.
- Only interact with the application the user has explicitly asked you to automate. If no target app is specified, ask before using gui_interact.
- Use gui_query first to understand what GUI capabilities are available on this system before acting.
- On Wayland, prefer a11y_* (accessibility) actions over coordinate-based clicks — they are more reliable.`,

  coding: 'You have file and shell tools. Prefer reading existing code before modifying it.',
  core: 'You have file system tools. Use file_list_directory and file_search before shell commands.',
  full: `You have the full tool set. Choose the right tool for each step.

CONTEXT: You are running INSIDE Clawdia, a desktop AI assistant application. You may use gui_interact or take screenshots of Clawdia's own UI when asked to automate or interact with it. Use browser_* tools for DOM-level interaction inside the embedded browser. For native Clawdia window controls (menus, buttons, panels), gui_interact is appropriate.`,
};

const QUIET_EXECUTE_SIGNALS = [
  /\bstop immediately\b/i,
  /\bthen stop\b/i,
  /\bstop\s+(when|once|after|on)\s+(done|finished|complete|success)\b/i,
  /\bjust execute\b/i,
  /\bquiet(ly)?\s+(execute|run|do)\b/i,
  /\bsilently\s+(execute|run|do)\b/i,
  /\bdo not (ask|clarify|follow.?up)\b/i,
  /\bno (clarif|follow.?up|question)\b/i,
  /\bdone\s*[—-]\s*do not\b/i,
];

export function hasQuietExecuteSignal(message: string): boolean {
  return QUIET_EXECUTE_SIGNALS.some(p => p.test(message));
}

export function buildStaticPrompt(
  profile: AgentProfile,
  unrestrictedMode: boolean,
  runtimeGuidance = '',
  userMessage = '',
): string {
  const groupGuidance = TOOL_GROUP_GUIDANCE[profile.toolGroup];
  const quietMode = hasQuietExecuteSignal(userMessage);
  const serviceBlock = profile.serviceHints && profile.serviceHints.length > 0
    ? '\n\n' + buildServiceHintBlock(profile.serviceHints)
    : '';

  const quietAddendum = quietMode
    ? `\nEXECUTION MODE: The user has requested quiet/immediate execution.
- Do NOT narrate a plan or say "I'll analyze this task".
- Do NOT use agent_plan for any reason — it is not available in this mode.
- Do NOT use agent_status to orient yourself — just start executing.
- Do NOT ask clarifying questions after completing the task.
- Do NOT add a synthesis framing or summary section.
- Execute each step, report the result of that step inline, then terminate.
- When the task says "stop immediately" or "stop when done", stop — do not ask what to do next.`
    : '';

  const body = `${CLAWDIA_IDENTITY}

You have access to local CLI tools and a browser.

${groupGuidance}${serviceBlock}${quietAddendum}

CRITICAL RULES:
1. Always use your tools — never tell the user to run commands themselves.
2. Do not ask for permission before using tools unless the action is permanently destructive (deleting files, dropping databases).
3. When a task involves web content, use browser tools directly — do not instruct the user to open a browser.
4. TIMING: Every tool result JSON includes an "elapsed_ms" field with the real measured wall-clock time for that call. When reporting timing, always use the exact numeric value from that field. Do NOT fabricate, estimate, or write placeholder text like "(operation executed)" — if elapsed_ms is a number in the result, report that number; if it is absent, say "timing unavailable".`;
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

import { CLAWDIA_IDENTITY, appendPromptAddenda, buildRuntimeGuidance } from '../../prompts/promptAssembler';

/** Used by OpenAI and Gemini — includes search_tools instructions */
export function buildSharedSystemPrompt(unrestrictedMode: boolean, userMessage = ''): string {
  const base = `${CLAWDIA_IDENTITY}

You have access to a local CLI environment and a browser.

TOOLS AVAILABLE:
- shell_exec: run any bash shell command
- file_edit: read and edit files (view, create, str_replace)
- file_list_directory: list directory contents as structured JSON
- file_search: search file contents with regex
- search_tools: discover additional tools (browser automation, etc.)

CRITICAL RULES:
1. Always use your tools — never tell the user to run commands themselves.
2. For ANY task involving a browser, website, URL, or clicking: call search_tools FIRST with a description of what you need (e.g. search_tools({query: "navigate browser and click elements"})). This loads the browser tools you need.
3. After search_tools returns schemas, immediately use those tools to complete the task.
4. For search, navigation, URL, or current-page questions, do not answer from memory. Inspect the real browser/page first.
5. Treat navigation as an intermediate step, not task completion, unless the user explicitly asked only to open/go to a page.
6. If the user asked you to do something on a site, continue interacting until the task is done or you are genuinely blocked.
7. Do not ask for permission before using tools unless the action is permanently destructive (deleting files, dropping databases).
8. Prefer structured tools (file_list_directory, file_search) over writing shell one-liners when available.`;

  return appendPromptAddenda(base, {
    runtimeGuidance: userMessage ? buildRuntimeGuidance({ message: userMessage, executor: 'agentLoop' }) : '',
    unrestrictedMode,
  });
}

/** Used by Anthropic streaming path — native bash/editor tools, no search_tools */
export function buildAnthropicStreamSystemPrompt(unrestrictedMode: boolean, userMessage = ''): string {
  const base = `${CLAWDIA_IDENTITY}

You have access to a local CLI environment.

TOOLS AVAILABLE:
- bash: run any shell command, explore the filesystem, install packages, run scripts
- str_replace_based_edit_tool: read and edit files

CRITICAL RULES:
1. Always use your tools — never tell the user to run commands themselves.
2. Do not ask for permission before using tools unless the action is permanently destructive (deleting files, dropping databases).
3. Use bash to list directories, search files, run tests, and accomplish any task that requires the local system.`;

  return appendPromptAddenda(base, {
    runtimeGuidance: userMessage ? buildRuntimeGuidance({ message: userMessage, executor: 'agentLoop' }) : '',
    unrestrictedMode,
  });
}

// Static exports for backwards compatibility (default: restricted mode)
export const SHARED_SYSTEM_PROMPT = buildSharedSystemPrompt(false);
export const ANTHROPIC_STREAM_SYSTEM_PROMPT = buildAnthropicStreamSystemPrompt(false);

import type { Message, ToolCall } from '../../../shared/types';
import type { TaskContext, TaskDomain, TaskPageType } from '../../../shared/capability-helper/types';

type BrowserToolOutput = {
  url?: string;
  title?: string;
  textSample?: string;
  text?: string;
};

const BROWSER_TOOL_PREFIX = 'browser_';
const FILESYSTEM_TOOL_PREFIXES = ['file_', 'directory_', 'fs_'];
const TERMINAL_TOOL_NAMES = new Set(['shell_exec', 'shell_kill', 'shell_wait']);
const DESKTOP_TOOL_NAMES = new Set(['gui_interact']);

function parseToolOutput(output?: string): Record<string, unknown> | null {
  if (!output) return null;
  try {
    return JSON.parse(output) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getToolDomain(tool: ToolCall): TaskDomain | null {
  if (tool.name.startsWith(BROWSER_TOOL_PREFIX)) return 'browser';
  if (FILESYSTEM_TOOL_PREFIXES.some((prefix) => tool.name.startsWith(prefix))) return 'filesystem';
  if (TERMINAL_TOOL_NAMES.has(tool.name)) return 'terminal';
  if (DESKTOP_TOOL_NAMES.has(tool.name)) return 'desktop';
  return null;
}

function inferDomain(toolCalls: ToolCall[]): TaskDomain {
  const domains = Array.from(new Set(toolCalls.map(getToolDomain).filter(Boolean))) as TaskDomain[];
  if (domains.length === 0) return 'browser';
  return domains.length > 1 ? 'cross_system' : domains[0];
}

function normalizeHostname(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function inferSite(url?: string): string | undefined {
  const host = normalizeHostname(url);
  if (!host) return undefined;
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') return 'youtube';
  if (host === 'mail.google.com') return 'gmail';
  return host;
}

function inferSiteFromIntent(recentIntent?: string): string | undefined {
  const intent = (recentIntent ?? '').toLowerCase();
  if (intent.includes('youtube')) return 'youtube';
  if (intent.includes('gmail') || intent.includes('email') || intent.includes('inbox')) return 'gmail';
  return undefined;
}

function inferPageType(url?: string, site?: string): TaskPageType {
  if (!url) return 'unknown';

  try {
    const parsed = new URL(url);
    if (site === 'youtube') {
      if (parsed.pathname === '/' || parsed.pathname === '/feed/subscriptions') return 'home';
      if (parsed.pathname === '/watch') return 'video';
      if (parsed.pathname === '/results') return 'search_results';
    }
    if (site === 'gmail') {
      if (parsed.pathname.startsWith('/mail')) {
        if (/#[^/]*\/inbox$/.test(parsed.hash) || parsed.hash === '#inbox') return 'inbox';
        if (/#[^/]+\/[^/]+\/[^/]+/.test(parsed.hash)) return 'thread';
        return 'inbox';
      }
    }
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

function inferBrowserPageTypeFromIntent(site: string | undefined, recentIntent?: string): TaskPageType | undefined {
  const intent = (recentIntent ?? '').toLowerCase();
  if (site === 'youtube') {
    if (/\bsearch\b|\bfind\b/.test(intent)) return 'search_results';
    if (/\bwatch\b|\bvideo\b|\btranscript\b/.test(intent)) return 'video';
    return 'home';
  }
  if (site === 'gmail') {
    if (/\breply\b|\bdraft\b|\bemail\b/.test(intent)) return 'thread';
    return 'inbox';
  }
  return undefined;
}

function inferSignedIn(toolCalls: ToolCall[], site?: string): boolean | undefined {
  if (!site) return undefined;
  const browserText = toolCalls
    .map((tool) => parseToolOutput(tool.output))
    .filter(Boolean)
    .map((data) => String((data as BrowserToolOutput).textSample ?? (data as BrowserToolOutput).text ?? ''))
    .join(' ')
    .toLowerCase();

  if (site === 'youtube') {
    if (browserText.includes('sign in')) return false;
    if (browserText.includes('your channel') || browserText.includes('subscriptions') || browserText.includes('youtube studio')) return true;
  }

  if (site === 'gmail') {
    if (browserText.includes('inbox') || browserText.includes('compose')) return true;
  }

  return undefined;
}

function inferRepoOpen(toolCalls: ToolCall[], recentIntent?: string): boolean {
  const shellLike = toolCalls.some((tool) => getToolDomain(tool) === 'terminal' || getToolDomain(tool) === 'filesystem');
  if (!shellLike) return false;

  const intent = (recentIntent ?? '').toLowerCase();
  return /\brepo\b|\bcodebase\b|\bproject\b|\btests?\b|\bbuild\b|\bfix\b|\bbug\b/.test(intent);
}

function inferRepoType(toolCalls: ToolCall[], recentIntent?: string): 'node' | 'python' | 'unknown' {
  const outputs = toolCalls.map((tool) => `${tool.detail ?? ''} ${tool.output ?? ''}`.toLowerCase()).join(' ');
  const intent = (recentIntent ?? '').toLowerCase();
  if (outputs.includes('package.json') || outputs.includes('npm ') || outputs.includes('pnpm ') || outputs.includes('node_modules') || /\bnode\b|\breact\b|\btypescript\b/.test(intent)) {
    return 'node';
  }
  if (outputs.includes('requirements.txt') || outputs.includes('pyproject.toml') || outputs.includes('pytest') || /\bpython\b|\bpytest\b/.test(intent)) {
    return 'python';
  }
  return 'unknown';
}

function findPrimaryBrowserOutput(toolCalls: ToolCall[]): BrowserToolOutput | null {
  const preferred = ['browser_get_page_state', 'browser_navigate', 'browser_extract_text'];
  for (const name of preferred) {
    const tool = [...toolCalls].reverse().find((entry) => entry.name === name && entry.status === 'success');
    const parsed = tool ? parseToolOutput(tool.output) : null;
    if (parsed) return parsed as BrowserToolOutput;
  }
  return null;
}

export function deriveTaskContext(messages: Message[], targetMessageId?: string): TaskContext | null {
  const targetIndex = targetMessageId
    ? messages.findIndex((message) => message.id === targetMessageId)
    : messages.length - 1;
  if (targetIndex < 0) return null;

  const targetMessage = messages[targetIndex];
  if (targetMessage.role !== 'assistant' || targetMessage.isStreaming) return null;

  const toolCalls = (targetMessage.toolCalls ?? []).filter((tool) => tool.status !== 'running');
  if (toolCalls.length === 0) return null;

  const domain = inferDomain(toolCalls);
  const recentIntent = [...messages]
    .slice(0, targetIndex)
    .reverse()
    .find((message) => message.role === 'user')
    ?.content;

  const primaryBrowserOutput = findPrimaryBrowserOutput(toolCalls);
  const currentUrl = primaryBrowserOutput?.url;
  const site = inferSite(currentUrl) ?? inferSiteFromIntent(recentIntent);
  const pageType = domain === 'browser'
    ? (inferPageType(currentUrl, site) !== 'unknown'
      ? inferPageType(currentUrl, site)
      : (inferBrowserPageTypeFromIntent(site, recentIntent) ?? 'unknown'))
    : domain === 'filesystem'
      ? 'folder'
      : domain === 'terminal'
        ? 'repository'
        : 'unknown';
  const lastTool = toolCalls[toolCalls.length - 1];
  const repoOpen = inferRepoOpen(toolCalls, recentIntent);

  return {
    domain,
    site,
    pageType,
    currentUrl,
    pageTitle: primaryBrowserOutput?.title,
    signedIn: inferSignedIn(toolCalls, site),
    repoOpen,
    repoType: repoOpen ? inferRepoType(toolCalls, recentIntent) : 'unknown',
    lastAction: lastTool?.name,
    lastActionStatus: toolCalls.every((tool) => tool.status === 'success') ? 'success' : toolCalls.some((tool) => tool.status === 'error') ? 'error' : 'partial',
    recentIntent,
  };
}

export function getTaskContextKey(context: TaskContext): string {
  const base = [
    context.domain,
    context.site ?? 'unknown-site',
    context.pageType ?? 'unknown-page',
    context.repoOpen ? context.repoType ?? 'repo' : 'no-repo',
  ];
  return base.join(':');
}

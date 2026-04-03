import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ElectronBrowserService } from './core/browser/ElectronBrowserService';
import { executeBrowserTool } from './core/cli/browserTools';
import { CDP_TOOLS, executeCDPTool } from './core/cli/cdpTools';
import { SYSTEM_TOOLS } from './core/cli/systemTools';
import { executeSystemTool } from './core/cli/systemExecutor';
import { executeGuiInteract } from './core/desktop';
import { executeDbusControl } from './core/desktop/dbus';
import { executeShellTool } from './core/cli/shellTools';
import type { TerminalSessionController } from './core/terminal/TerminalSessionController';

type ConversationBridgeConfig = {
  conversationId: string;
  token: string;
  url: string;
  claudeConfigPath: string;
};

type SessionTransport = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  conversationId: string;
  token: string;
};

let browserServiceRef: ElectronBrowserService | null = null;
let terminalControllerRef: TerminalSessionController | null = null;
let httpServer: HttpServer | null = null;
let listenPromise: Promise<number> | null = null;
let currentPort: number | null = null;

const conversationConfigs = new Map<string, ConversationBridgeConfig>();
const tokenToConversationId = new Map<string, string>();
const sessionTransports = new Map<string, SessionTransport>();

function requireBrowserService(): ElectronBrowserService {
  if (!browserServiceRef) {
    throw new Error('Clawdia MCP bridge is not initialized with a browser service');
  }
  return browserServiceRef;
}

function jsonToolResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data as Record<string, unknown>,
  };
}

function errorToolResult(message: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: message,
      },
    ],
    isError: true,
  };
}

function createConversationServer(conversationId: string): McpServer {
  const server = new McpServer(
    {
      name: 'clawdia-mcp-bridge',
      version: '1.0.0',
    },
    {
      instructions:
        `You are running inside Clawdia, an Electron desktop app with a live embedded Chromium browser.\n` +
        `Use clawdia_browser_* tools to control the browser that is visible to the user in real time.\n` +
        `Use clawdia_cdp_* tools for advanced CDP operations: low-level input (mouse/key/touch), request interception, accessibility tree, DOM snapshots, cookies, storage, emulation, PDF generation, and file chooser handling.\n` +
        `Use clawdia_system_* tools for OS-level operations: secret storage (OS keychain), cookie-aware HTTP fetch, global shortcuts, and XDG RemoteDesktop portal (GNOME Wayland input injection).\n` +
        `Use clawdia_gui_interact for Linux desktop GUI automation (AT-SPI / xdotool on Wayland/X11).\n` +
        `Use clawdia_dbus_control to call system DBus services (media players, notifications, etc.).\n` +
        `Use clawdia_terminal_spawn to launch processes in a pty and get a pid. Use clawdia_terminal_write to send commands, clawdia_terminal_read to get buffered output and session state, clawdia_terminal_list to see all sessions, and clawdia_terminal_kill to terminate a session.\n` +
        `Before starting a browser task, call clawdia_browser_get_page_state to check the current URL.\n` +
        `Prefer clawdia_browser_* and clawdia_cdp_* tools over WebFetch for all web interaction — they drive the live visible browser.\n` +
        `Conversation: ${conversationId}`,
    },
  );

  server.registerTool(
    'clawdia_browser_list_tabs',
    {
      description: 'List the tabs in the Clawdia live embedded browser.',
    },
    async () => {
      try {
        const tabs = await executeBrowserTool('browser_list_tabs', {}, requireBrowserService());
        return jsonToolResult({ conversationId, tabs });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_switch_tab',
    {
      description: 'Switch the Clawdia live embedded browser to a given tab id.',
      inputSchema: {
        id: z.string().describe('Browser tab id'),
      },
    },
    async ({ id }) => {
      try {
        const result = await executeBrowserTool('browser_switch_tab', { id }, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_navigate',
    {
      description: 'Navigate the Clawdia live embedded browser to a URL.',
      inputSchema: {
        url: z.string().describe('Destination URL'),
      },
    },
    async ({ url }) => {
      try {
        const result = await executeBrowserTool('browser_navigate', { url }, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_click',
    {
      description: 'Click an element in the Clawdia live embedded browser using a CSS selector.',
      inputSchema: {
        selector: z.string().describe('CSS selector'),
      },
    },
    async ({ selector }) => {
      try {
        const result = await executeBrowserTool('browser_click', { selector }, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_type',
    {
      description: 'Type text into an element in the Clawdia live embedded browser.',
      inputSchema: {
        selector: z.string().describe('CSS selector'),
        text: z.string().describe('Text to type'),
        clearFirst: z.boolean().optional().describe('Clear the field before typing'),
      },
    },
    async ({ selector, text, clearFirst }) => {
      try {
        const result = await executeBrowserTool(
          'browser_type',
          { selector, text, clearFirst },
          requireBrowserService(),
        );
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_get_page_state',
    {
      description: 'Get URL, title, loading state, and text excerpt from the Clawdia live embedded browser.',
    },
    async () => {
      try {
        const result = await executeBrowserTool('browser_get_page_state', {}, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_extract_text',
    {
      description: 'Extract visible text from the Clawdia live embedded browser.',
    },
    async () => {
      try {
        const result = await executeBrowserTool('browser_extract_text', {}, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_screenshot',
    {
      description: 'Capture a screenshot of the Clawdia live embedded browser. Returns an image you can visually inspect to understand page layout, verify state, or read content.',
    },
    async () => {
      try {
        const result = await executeBrowserTool('browser_screenshot', {}, requireBrowserService()) as {
          type: string; mimeType: string; data: string; width: number; height: number;
        };
        return {
          content: [
            {
              type: 'image' as const,
              data: result.data,
              mimeType: result.mimeType as 'image/png',
            },
          ],
        };
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_scroll',
    {
      description: 'Scroll the page to a CSS selector element, or scroll the window by deltaY pixels.',
      inputSchema: {
        selector: z.string().optional().describe('CSS selector to scroll into view (omit to scroll window)'),
        deltaY: z.number().optional().describe('Pixels to scroll vertically (default: 500)'),
      },
    },
    async ({ selector, deltaY }) => {
      try {
        const result = await executeBrowserTool('browser_scroll', { selector, deltaY }, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_wait_for',
    {
      description: 'Wait until a CSS selector appears in the DOM. Returns error on timeout.',
      inputSchema: {
        selector: z.string().describe('CSS selector to wait for'),
        timeoutMs: z.number().optional().describe('Timeout in milliseconds (default: 10000)'),
      },
    },
    async ({ selector, timeoutMs }) => {
      try {
        const result = await executeBrowserTool('browser_wait_for', { selector, timeoutMs }, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_evaluate_js',
    {
      description: 'Evaluate a JavaScript expression in the current page context and return the serializable result.',
      inputSchema: {
        expression: z.string().describe('JavaScript expression to evaluate'),
      },
    },
    async ({ expression }) => {
      try {
        const result = await executeBrowserTool('browser_evaluate_js', { expression }, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_find_elements',
    {
      description: 'Find elements matching a CSS selector. Returns array of { tag, text, attrs }.',
      inputSchema: {
        selector: z.string().describe('CSS selector to query'),
        limit: z.number().optional().describe('Max elements to return (default: 20)'),
      },
    },
    async ({ selector, limit }) => {
      try {
        const result = await executeBrowserTool('browser_find_elements', { selector, limit }, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_new_tab',
    {
      description: 'Open a new browser tab, optionally navigating to a URL.',
      inputSchema: {
        url: z.string().optional().describe('URL to open in the new tab'),
      },
    },
    async ({ url }) => {
      try {
        const result = await executeBrowserTool('browser_new_tab', { url }, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_select',
    {
      description: 'Select an option in a <select> dropdown by value or visible text.',
      inputSchema: {
        selector: z.string().describe('CSS selector of the <select> element'),
        value: z.string().describe('Option value or visible text to select'),
      },
    },
    async ({ selector, value }) => {
      try {
        const result = await executeBrowserTool('browser_select', { selector, value }, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_hover',
    {
      description: 'Hover over an element to trigger mouseover/mouseenter events (reveals dropdowns, tooltips, menus).',
      inputSchema: {
        selector: z.string().describe('CSS selector of the element to hover'),
      },
    },
    async ({ selector }) => {
      try {
        const result = await executeBrowserTool('browser_hover', { selector }, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_key_press',
    {
      description: 'Press a keyboard key in the browser. Use for Return (submit forms), Escape (close modals), Tab (focus next), ArrowDown/ArrowUp (navigate lists).',
      inputSchema: {
        key: z.string().describe('Key name e.g. "Return", "Escape", "Tab", "ArrowDown", "ArrowUp"'),
      },
    },
    async ({ key }) => {
      try {
        const result = await executeBrowserTool('browser_key_press', { key }, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_close_tab',
    {
      description: 'Close a browser tab by its ID. Use clawdia_browser_list_tabs to get tab IDs.',
      inputSchema: {
        id: z.string().describe('Tab ID to close'),
      },
    },
    async ({ id }) => {
      try {
        const result = await executeBrowserTool('browser_close_tab', { id }, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_get_element_text',
    {
      description: 'Get the visible text content of a specific element. More token-efficient than extract_text when you only need one element.',
      inputSchema: {
        selector: z.string().describe('CSS selector of the element'),
      },
    },
    async ({ selector }) => {
      try {
        const result = await executeBrowserTool('browser_get_element_text', { selector }, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_back',
    {
      description: 'Navigate back in browser history.',
    },
    async () => {
      try {
        const result = await executeBrowserTool('browser_back', {}, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_forward',
    {
      description: 'Navigate forward in browser history.',
    },
    async () => {
      try {
        const result = await executeBrowserTool('browser_forward', {}, requireBrowserService());
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_stop_loading',
    {
      description: 'Stop the current page from loading. Use when you have the content you need.',
    },
    async () => {
      try {
        const result = await executeBrowserTool('browser_stop_loading', {}, requireBrowserService(), conversationId);
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_wait_for_network_idle',
    {
      description: 'Wait until no network requests are in-flight for a specified idle period. More reliable than wait_for for confirming a page is truly done loading.',
      inputSchema: {
        idleMs: z.number().optional().describe('Milliseconds of network silence to consider idle (default: 500)'),
        timeoutMs: z.number().optional().describe('Max wait time in milliseconds (default: 30000)'),
      },
    },
    async ({ idleMs, timeoutMs }) => {
      try {
        const result = await executeBrowserTool('browser_wait_for_network_idle', { idleMs, timeoutMs }, requireBrowserService(), conversationId);
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_wait_for_navigation',
    {
      description: 'Wait for a full page navigation to complete (URL change + loading finished). Use after clicking a link or submitting a form.',
      inputSchema: {
        timeoutMs: z.number().optional().describe('Max wait time in milliseconds (default: 15000)'),
      },
    },
    async ({ timeoutMs }) => {
      try {
        const result = await executeBrowserTool('browser_wait_for_navigation', { timeoutMs }, requireBrowserService(), conversationId);
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_get_network_activity',
    {
      description: 'Get a snapshot of network/loading activity: readyState, resource count, transfer sizes, recent resources, and page timing.',
    },
    async () => {
      try {
        const result = await executeBrowserTool('browser_get_network_activity', {}, requireBrowserService(), conversationId);
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_browser_set_user_agent',
    {
      description: 'Override the User-Agent string for the current browser tab to avoid bot detection.',
      inputSchema: {
        userAgent: z.string().describe('User-Agent string to set'),
      },
    },
    async ({ userAgent }) => {
      try {
        const result = await executeBrowserTool('browser_set_user_agent', { userAgent }, requireBrowserService(), conversationId);
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_gui_interact',
    {
      description: 'Run a desktop GUI automation action against the Clawdia Linux desktop bridge.',
      inputSchema: z.object({
        action: z.string().describe('GUI action name'),
      }).catchall(z.any()),
    },
    async (args) => {
      try {
        const result = await executeGuiInteract(args);
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  server.registerTool(
    'clawdia_dbus_control',
    {
      description: 'Call the Clawdia DBus control bridge.',
      inputSchema: z.object({
        service: z.string(),
        interface: z.string(),
        method: z.string(),
        args: z.array(z.string()).optional(),
      }),
    },
    async (args) => {
      try {
        const result = await executeDbusControl(args);
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  // ── Helper: build Zod schema from Anthropic tool input_schema ──────────────
  function buildZodSchema(inputSchema: { properties?: Record<string, unknown>; required?: string[] }): Record<string, z.ZodTypeAny> {
    const zSchema: Record<string, z.ZodTypeAny> = {};
    if (!inputSchema.properties) return zSchema;
    for (const [key, prop] of Object.entries(inputSchema.properties)) {
      const p = prop as { type?: string; description?: string };
      let zField: z.ZodTypeAny;
      if (p.type === 'number') zField = z.number().describe(p.description ?? key);
      else if (p.type === 'boolean') zField = z.boolean().describe(p.description ?? key);
      else if (p.type === 'array') zField = z.array(z.any()).describe(p.description ?? key);
      else if (p.type === 'object') zField = z.record(z.string(), z.any()).describe(p.description ?? key);
      else zField = z.string().describe(p.description ?? key);

      if (!inputSchema.required?.includes(key)) {
        zField = zField.optional();
      }
      zSchema[key] = zField;
    }
    return zSchema;
  }

  // ── CDP Tools ───────────────────────────────────────────────────────────────
  // Register all CDP-powered browser tools dynamically from the CDP_TOOLS array.
  for (const tool of CDP_TOOLS) {
    const mcpName = `clawdia_${tool.name.replace(/^browser_/, '')}`;
    const schema = tool.input_schema as { properties?: Record<string, unknown>; required?: string[] };
    const zSchema = buildZodSchema(schema);

    server.registerTool(
      mcpName,
      {
        description: tool.description ?? '',
        inputSchema: Object.keys(zSchema).length > 0 ? z.object(zSchema) : undefined,
      },
      async (args: Record<string, unknown>) => {
        try {
          const browser = requireBrowserService();
          const tabId = await browser.getOrAssignTab(conversationId);
          const result = await executeCDPTool(tool.name, args, browser, tabId);
          return jsonToolResult({ conversationId, result });
        } catch (error) {
          return errorToolResult((error as Error).message);
        }
      },
    );
  }

  // ── System Tools ────────────────────────────────────────────────────────────
  // Register all system-level tools dynamically from the SYSTEM_TOOLS array.
  for (const tool of SYSTEM_TOOLS) {
    const mcpName = `clawdia_${tool.name}`;
    const schema = tool.input_schema as { properties?: Record<string, unknown>; required?: string[] };
    const zSchema = buildZodSchema(schema);

    server.registerTool(
      mcpName,
      {
        description: tool.description ?? '',
        inputSchema: Object.keys(zSchema).length > 0 ? z.object(zSchema) : undefined,
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await executeSystemTool(tool.name, args);
          return jsonToolResult({ conversationId, result });
        } catch (error) {
          return errorToolResult((error as Error).message);
        }
      },
    );
  }

  // ── Shell Exec ──────────────────────────────────────────────────────────────
  server.registerTool(
    'shell_exec',
    {
      description: 'Execute a bash shell command on the local system. Use for single commands (launch app, open file, kill process). Prefer this over clawdia_terminal_spawn for one-shot commands.',
      inputSchema: {
        command: z.string().describe('Shell command to execute'),
      },
    },
    async ({ command }) => {
      try {
        const result = await executeShellTool('shell_exec', { command });
        return jsonToolResult({ conversationId, result });
      } catch (error) {
        return errorToolResult((error as Error).message);
      }
    },
  );

  // ── Terminal Tools ──────────────────────────────────────────────────────────
  server.registerTool(
    'clawdia_terminal_spawn',
    {
      description: 'Spawn a new terminal session (pty). Returns sessionId and pid. Use clawdia_terminal_write to send commands.',
      inputSchema: {
        sessionId: z.string().describe('Unique id for this session'),
        cwd: z.string().optional().describe('Working directory (default: home)'),
        shell: z.string().optional().describe('Shell binary (default: $SHELL or /bin/bash)'),
        cols: z.number().optional().describe('Terminal columns (default: 120)'),
        rows: z.number().optional().describe('Terminal rows (default: 30)'),
      },
    },
    async ({ sessionId, cwd, shell, cols, rows }) => {
      const ctrl = terminalControllerRef;
      if (!ctrl) return errorToolResult('Terminal controller not available');
      const state = ctrl.spawn(sessionId, { cwd, shell, cols, rows });
      if (!state) return errorToolResult('Failed to spawn terminal (node-pty unavailable)');
      return jsonToolResult({ conversationId, state });
    },
  );

  server.registerTool(
    'clawdia_terminal_write',
    {
      description: 'Write input to a live terminal session. Use "\\n" to submit a command.',
      inputSchema: {
        sessionId: z.string().describe('Session id'),
        data: z.string().describe('Data to write (e.g. "ls -la\\n")'),
      },
    },
    async ({ sessionId, data }) => {
      const ctrl = terminalControllerRef;
      if (!ctrl) return errorToolResult('Terminal controller not available');
      const ok = ctrl.write(sessionId, data, { source: 'clawdia_agent' });
      return jsonToolResult({ conversationId, ok });
    },
  );

  server.registerTool(
    'clawdia_terminal_read',
    {
      description: 'Read buffered output from a terminal session. Returns full output buffer and session state including pid and exitCode.',
      inputSchema: {
        sessionId: z.string().describe('Session id'),
      },
    },
    async ({ sessionId }) => {
      const ctrl = terminalControllerRef;
      if (!ctrl) return errorToolResult('Terminal controller not available');
      const state = ctrl.getSnapshot(sessionId);
      if (!state) return errorToolResult(`No session found: ${sessionId}`);
      return jsonToolResult({ conversationId, state });
    },
  );

  server.registerTool(
    'clawdia_terminal_list',
    {
      description: 'List all terminal sessions (live and archived) with their state including pid, exitCode, and owner.',
    },
    async () => {
      const ctrl = terminalControllerRef;
      if (!ctrl) return errorToolResult('Terminal controller not available');
      const sessions = ctrl.list();
      return jsonToolResult({ conversationId, sessions });
    },
  );

  server.registerTool(
    'clawdia_terminal_kill',
    {
      description: 'Kill a live terminal session.',
      inputSchema: {
        sessionId: z.string().describe('Session id to kill'),
      },
    },
    async ({ sessionId }) => {
      const ctrl = terminalControllerRef;
      if (!ctrl) return errorToolResult('Terminal controller not available');
      const ok = ctrl.kill(sessionId);
      return jsonToolResult({ conversationId, ok });
    },
  );

  return server;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readParsedBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;
  return JSON.parse(raw);
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
  const match = requestUrl.pathname.match(/^\/mcp\/([^/]+)$/);
  if (!match) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const token = match[1];
  const conversationId = tokenToConversationId.get(token);
  if (!conversationId) {
    sendJson(res, 404, { error: 'Unknown MCP bridge token' });
    return;
  }

  const sessionIdHeader = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

  if (req.method === 'GET' || req.method === 'DELETE') {
    if (!sessionId || !sessionTransports.has(sessionId)) {
      sendJson(res, 400, { error: 'Invalid or missing MCP session id' });
      return;
    }
    await sessionTransports.get(sessionId)!.transport.handleRequest(req, res);
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const parsedBody = await readParsedBody(req);
  if (sessionId && sessionTransports.has(sessionId)) {
    await sessionTransports.get(sessionId)!.transport.handleRequest(req, res, parsedBody);
    return;
  }

  if (!isInitializeRequest(parsedBody)) {
    sendJson(res, 400, { error: 'Expected an MCP initialize request' });
    return;
  }

  let transport!: StreamableHTTPServerTransport;
  const server = createConversationServer(conversationId);
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (nextSessionId) => {
      sessionTransports.set(nextSessionId, {
        transport,
        server,
        conversationId,
        token,
      });
    },
  });

  transport.onclose = () => {
    const sessionsForTransport = [...sessionTransports.entries()]
      .filter(([, value]) => value.transport === transport)
      .map(([key]) => key);
    for (const key of sessionsForTransport) {
      sessionTransports.delete(key);
    }
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}

async function ensureServerStarted(): Promise<number> {
  if (currentPort) return currentPort;
  if (listenPromise) return listenPromise;

  listenPromise = new Promise<number>((resolve, reject) => {
    const server = createServer((req, res) => {
      handleMcpRequest(req, res).catch((error) => {
        if (!res.headersSent) {
          sendJson(res, 500, { error: (error as Error).message });
        } else {
          res.end();
        }
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve MCP bridge listen address'));
        return;
      }
      httpServer = server;
      currentPort = address.port;
      resolve(address.port);
    });
  });

  return listenPromise;
}

function ensureConversationConfig(conversationId: string, port: number): ConversationBridgeConfig {
  const existing = conversationConfigs.get(conversationId);
  if (existing) return existing;

  const token = randomUUID();
  const url = `http://127.0.0.1:${port}/mcp/${token}`;
  const claudeConfigPath = path.join(os.tmpdir(), `clawdia-claude-mcp-${conversationId}.json`);
  const config = {
    conversationId,
    token,
    url,
    claudeConfigPath,
  };

  conversationConfigs.set(conversationId, config);
  tokenToConversationId.set(token, conversationId);
  return config;
}

export function attachClawdiaMcpBridge(browserService: ElectronBrowserService, terminalController?: TerminalSessionController): void {
  browserServiceRef = browserService;
  if (terminalController) terminalControllerRef = terminalController;
}

export async function getClaudeMcpConfigPath(conversationId: string): Promise<string> {
  const port = await ensureServerStarted();
  const config = ensureConversationConfig(conversationId, port);
  fs.writeFileSync(
    config.claudeConfigPath,
    JSON.stringify({
      mcpServers: {
        clawdia: {
          type: 'http',
          url: config.url,
        },
      },
    }, null, 2),
    'utf8',
  );
  return config.claudeConfigPath;
}

export async function getCodexMcpConfigArgs(conversationId: string): Promise<string[]> {
  const port = await ensureServerStarted();
  const config = ensureConversationConfig(conversationId, port);
  return [
    '-c', 'features.rmcp_client=true',
    '-c', `mcp_servers.clawdia.url="${config.url}"`,
  ];
}

// src/main/core/cli/browserTools.ts
import type Anthropic from '@anthropic-ai/sdk';
import type { BrowserService, BrowserServiceResult } from '../browser/BrowserService';
import { openFileInBrowser, resolveOpenMode, type BrowserOpenMode } from '../browser/fileOpen';

export const BROWSER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate the browser to a URL. Returns the final URL, page title, and a page profile collected deterministically (no LLM) immediately after load. The profile includes: detected JS frameworks, all interactable inputs with selectors and whether they are inside shadow DOM, buttons, forms, content landmark areas, and an auth state hint. Use this profile to choose correct selectors before calling browser_type, browser_click, or browser_find_elements — especially check hasShadowInputs and the inputs array before typing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element identified by a CSS selector.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to click' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into any focusable element identified by a CSS selector. Works universally across native inputs, textareas, contenteditable divs, and all JS-framework editors (React controlled inputs, Lexical, ProseMirror, Draft.js, Slate, TipTap, CodeMirror, etc.) by sending real Chromium-level keyboard char events rather than synthetic JS events. Clears the field first by default.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the input element' },
        text: { type: 'string', description: 'Text to type' },
        clearFirst: { type: 'boolean', description: 'Clear the field before typing (default: true)' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll to an element by CSS selector, or scroll the window by deltaY pixels if no selector.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to scroll into view (optional)' },
        deltaY: { type: 'number', description: 'Pixels to scroll vertically (default: 500)' },
      },
    },
  },
  {
    name: 'browser_wait_for',
    description: 'Wait until a CSS selector appears in the DOM. Returns error on timeout.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default: 10000)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_evaluate_js',
    description: 'Evaluate a JavaScript expression in the current page context and return the serializable result.',
    input_schema: {
      type: 'object' as const,
      properties: {
        expression: { type: 'string', description: 'JavaScript expression to evaluate' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'browser_find_elements',
    description: 'Find elements matching a CSS selector. Returns array of { tag, text, attrs }.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to query' },
        limit: { type: 'number', description: 'Max elements to return (default: 20)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_get_page_state',
    description: 'Get current page URL, title, loading state, and a text excerpt (up to 1200 chars).',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current browser view. Use only when visual confirmation is required, layout matters, or page-state/text checks are ambiguous. Returns base64-encoded PNG that you can inspect visually.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'browser_extract_text',
    description: 'Extract all visible text from the current page (up to 5500 chars).',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'browser_new_tab',
    description: 'Open a new browser tab, optionally navigating to a URL. This is a web page tab inside the embedded browser, not a Clawdia conversation tab.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to open in the new browser tab (optional)' },
      },
    },
  },
  {
    name: 'browser_switch_tab',
    description: 'Switch to a browser tab by its ID. This only affects embedded web browser tabs, not conversation tabs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Browser tab ID to switch to' },
      },
      required: ['id'],
    },
  },
  {
    name: 'browser_list_tabs',
    description: 'List all open browser tabs with their IDs, titles, URLs, and active state. These are embedded web browser tabs, not Clawdia conversation tabs.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'browser_select',
    description: 'Select an option in a <select> dropdown by value or visible text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the <select> element' },
        value: { type: 'string', description: 'Option value or visible text to select' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'browser_hover',
    description: 'Hover over an element to trigger mouseover/mouseenter events (reveals dropdowns, tooltips, menus).',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to hover' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_key_press',
    description: 'Press a keyboard key. Use for Enter (submit forms), Escape (close modals), Tab (focus next field), ArrowDown/ArrowUp (navigate lists).',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Key name e.g. "Return", "Escape", "Tab", "ArrowDown", "ArrowUp"' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_close_tab',
    description: 'Close a browser tab by its ID. Use browser_list_tabs to get browser tab IDs. This does not close a conversation tab.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Browser tab ID to close' },
      },
      required: ['id'],
    },
  },
  {
    name: 'browser_get_element_text',
    description: 'Get the visible text content of a specific element. More token-efficient than extract_text when you only need one element.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_back',
    description: 'Navigate back in browser history.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'browser_forward',
    description: 'Navigate forward in browser history.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'browser_stop_loading',
    description: 'Stop the current page from loading. Use when you have the content you need and don\'t want to wait for remaining resources.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'browser_wait_for_network_idle',
    description: 'Wait until no network requests are in-flight for a specified idle period. More reliable than wait_for when you need to confirm a page is truly done loading (all XHR/fetch requests completed, not just DOM ready). Returns early once idle, or errors on timeout.',
    input_schema: {
      type: 'object' as const,
      properties: {
        idleMs: { type: 'number', description: 'Milliseconds of network silence to consider idle (default: 500)' },
        timeoutMs: { type: 'number', description: 'Max wait time in milliseconds (default: 30000)' },
      },
    },
  },
  {
    name: 'browser_wait_for_navigation',
    description: 'Wait for a full page navigation to complete (URL change + loading finished). Use after clicking a link or submitting a form to wait for the new page to load. More precise than wait_for when expecting a navigation event rather than an element.',
    input_schema: {
      type: 'object' as const,
      properties: {
        timeoutMs: { type: 'number', description: 'Max wait time in milliseconds (default: 15000)' },
      },
    },
  },
  {
    name: 'browser_get_network_activity',
    description: 'Get a snapshot of network/loading activity: document readyState, resource count, transfer sizes, recent resource names, and page timing (domContentLoaded, loadComplete, domInteractive). Use for visibility into what the page is doing.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'browser_set_user_agent',
    description: 'Override the User-Agent string for the current browser tab. Use to present a realistic desktop browser fingerprint and avoid bot detection.',
    input_schema: {
      type: 'object' as const,
      properties: {
        userAgent: { type: 'string', description: 'User-Agent string to set (e.g. "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")' },
      },
      required: ['userAgent'],
    },
  },
  {
    name: 'browser_click_at',
    description: 'Click at exact viewport pixel coordinates (x, y). Use when no CSS selector is available — e.g. canvas elements, WebGL surfaces, game UIs, PDF viewers. Coordinates are viewport-relative (same as getBoundingClientRect). Optional button: "left" (default), "right", or "middle".',
    input_schema: {
      type: 'object' as const,
      properties: {
        x:      { type: 'number', description: 'Horizontal viewport coordinate in CSS pixels' },
        y:      { type: 'number', description: 'Vertical viewport coordinate in CSS pixels' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'browser_double_click_at',
    description: 'Double-click at exact viewport pixel coordinates (x, y). Use for canvas, game, or WebGL targets that require double-click without a DOM selector.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'Horizontal viewport coordinate in CSS pixels' },
        y: { type: 'number', description: 'Vertical viewport coordinate in CSS pixels' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'browser_drag_coords',
    description: 'Drag from one viewport coordinate pair to another. Use for canvas drag targets, sliders, resizers, or any draggable that lacks a clean CSS selector. Generates N intermediate mouseMoved events for smooth motion.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fromX:  { type: 'number', description: 'Start X in CSS pixels' },
        fromY:  { type: 'number', description: 'Start Y in CSS pixels' },
        toX:    { type: 'number', description: 'End X in CSS pixels' },
        toY:    { type: 'number', description: 'End Y in CSS pixels' },
        steps:  { type: 'number', description: 'Intermediate move steps (default: 10)' },
      },
      required: ['fromX', 'fromY', 'toX', 'toY'],
    },
  },
  {
    name: 'browser_move_to',
    description: 'Move the agent mouse pointer to viewport coordinates without clicking. Triggers :hover CSS states and tooltip timers at the target position.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'Horizontal viewport coordinate in CSS pixels' },
        y: { type: 'number', description: 'Vertical viewport coordinate in CSS pixels' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'browser_scroll_at',
    description: 'Scroll at specific viewport coordinates. Use when the scrollable area is not the document root (e.g. a sidebar, modal, or split-panel). deltaY: positive scrolls down, negative scrolls up. deltaX: positive scrolls right.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x:      { type: 'number', description: 'Horizontal coordinate to deliver the scroll event' },
        y:      { type: 'number', description: 'Vertical coordinate to deliver the scroll event' },
        deltaY: { type: 'number', description: 'Vertical scroll delta in pixels (default: 500, positive = down)' },
        deltaX: { type: 'number', description: 'Horizontal scroll delta in pixels (default: 0)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'browser_right_click',
    description: 'Right-click an element identified by a CSS selector. Triggers contextmenu event handlers and browser context menus.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to right-click' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_double_click',
    description: 'Double-click an element identified by a CSS selector. Selects words in text fields, triggers dblclick event handlers, and activates items that require double-click (e.g. file manager entries, tree nodes).',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to double-click' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_drag',
    description: 'Drag from one element to another on the page. Uses a CDP mouse-event sequence (mousePressed → mouseMoved steps → mouseReleased) so it works correctly on sortable lists, sliders, canvas elements, and other drag targets. No OS cursor movement occurs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fromSelector: { type: 'string', description: 'CSS selector of the element to drag from' },
        toSelector:   { type: 'string', description: 'CSS selector of the element to drag to' },
        steps:        { type: 'number', description: 'Number of intermediate mouseMoved events (default: 10, increase for smoother drags on sensitive targets)' },
      },
      required: ['fromSelector', 'toSelector'],
    },
  },
  {
    name: 'browser_verify_action',
    description: `Execute a browser input action and verify it visibly changed the page.

Captures a screenshot before and after the action, computes a pixel-diff ratio, and returns { ok, changed, diffRatio } alongside the inner action result.

Use this when you need confidence that a click, type, or drag actually took effect — e.g. after clicking a button that should open a modal, submitting a form, or interacting with a canvas element.

changed = true when at least 0.2% of viewport pixels differ (configurable via minDiffRatio).
diffRatio is in [0, 1]: 0 = no change, 1 = every pixel changed.

The inner "tool" must be a browser input tool name (browser_click, browser_type, browser_click_at, browser_drag, etc.).`,
    input_schema: {
      type: 'object' as const,
      properties: {
        tool:        { type: 'string', description: 'Name of the browser input tool to execute (e.g. "browser_click")' },
        input:       { type: 'object', description: 'Input parameters for the inner tool (same schema as calling it directly)', additionalProperties: true },
        settleMs:    { type: 'number', description: 'Milliseconds to wait after the action before diffing (default: 300)' },
        minDiffRatio:{ type: 'number', description: 'Minimum pixel change fraction to count as "changed" (default: 0.002)' },
      },
      required: ['tool', 'input'],
    },
  },
  {
    name: 'browser_open_file',
    description: `Open a local file in the browser. Supports three modes:
- review (default for most files): raw file content in a clean read-only surface with line numbers and a copy button. Use for .txt, .md, .json, .log, .csv, .yaml, source code, etc.
- preview: rendered presentation. Markdown is rendered, CSV becomes a table, JSON is pretty-printed, HTML/SVG opens directly. Explicitly requested with words like "preview", "render", "show rendered".
- publish: navigate directly to a pre-built polished HTML artifact page. Use only when the file is already a finished presentable HTML artifact.

Mode resolution: explicit mode > extension default > review fallback.
Default to review unless the user says preview/render/publish/polished/presentable.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to the local file to open',
        },
        mode: {
          type: 'string',
          enum: ['review', 'preview', 'publish'],
          description: 'Open mode. Omit to use the extension-based default (review for most files, preview for html/svg/pdf).',
        },
      },
      required: ['filePath'],
    },
  },
];

export type BrowserToolInput = Record<string, unknown>;

// Import the concrete class only for the scoped-tab methods — the BrowserService
// interface does not expose them since they are an agent-internal detail.
import { ElectronBrowserService } from '../browser/ElectronBrowserService';

/**
 * Execute a browser tool call.
 *
 * When `conversationId` is provided and `browser` is an `ElectronBrowserService`,
 * all operations are routed through a dedicated per-conversation tab so that
 * concurrent agent runs cannot corrupt each other's page state.
 *
 * When `conversationId` is absent (e.g. legacy AgentIpc calls that have not yet
 * been updated), the call falls through to the original global-activeTab path.
 */
export async function executeBrowserTool(
  name: string,
  input: BrowserToolInput,
  browser: BrowserService,
  conversationId?: string,
): Promise<unknown> {
  // ── Conversation-scoped routing ───────────────────────────────────────────────
  if (conversationId && browser instanceof ElectronBrowserService) {
    const tabId = await browser.getOrAssignTab(conversationId);
    // Pass conversationId through for tools like browser_open_file that need it for tab scoping
    return executeOnTab(name, { ...input, _conversationId: conversationId }, browser, tabId);
  }
  // ── Legacy global-active-tab path (single-session or unscoped callers) ────────
  return executeOnActiveTab(name, input, browser);
}

async function executeOnTab(
  name: string,
  input: BrowserToolInput,
  browser: ElectronBrowserService,
  tabId: string,
): Promise<unknown> {
  switch (name) {
    case 'browser_navigate': {
      const result = await browser.navigateTab(tabId, input.url as string);
      const state = await browser.getPageStateOnTab(tabId);
      return {
        tabId: result.tabId,
        url: state.url || result.url,
        title: state.title || result.title,
        isLoading: state.isLoading,
        textSample: state.textSample,
        canGoBack: state.canGoBack,
        canGoForward: state.canGoForward,
      };
    }
    case 'browser_click':
      return browser.clickOnTab(tabId, input.selector as string);
    case 'browser_type':
      return browser.typeOnTab(tabId, input.selector as string, input.text as string, input.clearFirst !== false);
    case 'browser_scroll':
      return browser.scrollOnTab(tabId, (input.selector as string | undefined) ?? null, input.deltaY as number | undefined);
    case 'browser_wait_for':
      return browser.waitForOnTab(tabId, input.selector as string, input.timeoutMs as number | undefined);
    case 'browser_evaluate_js':
      return browser.evaluateJsOnTab(tabId, input.expression as string);
    case 'browser_find_elements':
      return browser.findElementsOnTab(tabId, input.selector as string, input.limit as number | undefined);
    case 'browser_get_page_state':
      return browser.getPageStateOnTab(tabId);
    case 'browser_screenshot': {
      const shot = await browser.screenshotTab(tabId);
      const { readFileSync } = await import('fs');
      const b64 = readFileSync(shot.path).toString('base64');
      return { type: 'base64', mimeType: shot.mimeType, data: b64, width: shot.width, height: shot.height };
    }
    case 'browser_extract_text':
      return browser.extractTextOnTab(tabId);
    case 'browser_new_tab': {
      // New tabs created by an agent are owned by the UI tab strip, not scoped.
      const tab = await browser.newTab(input.url as string | undefined);
      return { id: tab.id, url: tab.url, title: tab.title };
    }
    case 'browser_switch_tab':
      await browser.switchTab(input.id as string);
      return { ok: true };
    case 'browser_list_tabs':
      return browser.listTabs();
    case 'browser_select':
      return browser.selectOnTab(tabId, input.selector as string, input.value as string);
    case 'browser_hover':
      return browser.hoverOnTab(tabId, input.selector as string);
    case 'browser_right_click':
      return browser.rightClickOnTab(tabId, input.selector as string);
    case 'browser_double_click':
      return browser.doubleClickOnTab(tabId, input.selector as string);
    case 'browser_click_at':
      return browser.clickAtOnTab(
        tabId,
        input.x as number,
        input.y as number,
        (input.button as 'left' | 'right' | 'middle' | undefined) ?? 'left',
      );
    case 'browser_double_click_at':
      return browser.doubleClickAtOnTab(tabId, input.x as number, input.y as number);
    case 'browser_drag_coords':
      return browser.dragCoordsOnTab(
        tabId,
        input.fromX as number,
        input.fromY as number,
        input.toX as number,
        input.toY as number,
        (input.steps as number | undefined) ?? 10,
      );
    case 'browser_move_to':
      return browser.moveToOnTab(tabId, input.x as number, input.y as number);
    case 'browser_scroll_at':
      return browser.scrollAtOnTab(
        tabId,
        input.x as number,
        input.y as number,
        (input.deltaX as number | undefined) ?? 0,
        (input.deltaY as number | undefined) ?? 500,
      );
    case 'browser_verify_action': {
      const innerTool = input.tool as string;
      const innerInput = (input.input ?? {}) as BrowserToolInput;
      const settleMs = (input.settleMs as number | undefined) ?? 300;
      const minDiffRatio = (input.minDiffRatio as number | undefined) ?? 0.002;
      return browser.verifyActionOnTab(
        tabId,
        () => executeOnTab(innerTool, innerInput, browser, tabId) as Promise<BrowserServiceResult>,
        minDiffRatio,
        settleMs,
      );
    }
    case 'browser_drag':
      return browser.dragOnTab(
        tabId,
        input.fromSelector as string,
        input.toSelector as string,
        (input.steps as number | undefined) ?? 10,
      );
    case 'browser_key_press':
      return browser.keyPressOnTab(tabId, input.key as string);
    case 'browser_close_tab':
      await browser.closeTab(input.id as string);
      return { ok: true };
    case 'browser_get_element_text':
      return browser.getElementTextOnTab(tabId, input.selector as string);
    case 'browser_back':
      await browser.backOnTab(tabId);
      return { ok: true };
    case 'browser_forward':
      await browser.forwardOnTab(tabId);
      return { ok: true };
    case 'browser_stop_loading':
      return browser.stopLoadingOnTab(tabId);
    case 'browser_wait_for_network_idle':
      return browser.waitForNetworkIdleOnTab(tabId, input.idleMs as number | undefined, input.timeoutMs as number | undefined);
    case 'browser_wait_for_navigation':
      return browser.waitForNavigationOnTab(tabId, input.timeoutMs as number | undefined);
    case 'browser_get_network_activity':
      return browser.getNetworkActivityOnTab(tabId);
    case 'browser_set_user_agent':
      return browser.setUserAgentOnTab(tabId, input.userAgent as string);
    case 'browser_open_file': {
      const conversationId = (input._conversationId as string | undefined);
      return openFileInBrowser(
        input.filePath as string,
        { mode: input.mode as BrowserOpenMode | undefined, conversationId },
        browser,
      );
    }
    default:
      return { ok: false, error: `Unknown browser tool: ${name}` };
  }
}

async function executeOnActiveTab(
  name: string,
  input: BrowserToolInput,
  browser: BrowserService,
): Promise<unknown> {
  switch (name) {
    case 'browser_navigate': {
      const result = await browser.navigate(input.url as string);
      const state = await browser.getPageState();
      return {
        tabId: result.tabId,
        url: state.url || result.url,
        title: state.title || result.title,
        isLoading: state.isLoading,
        textSample: state.textSample,
        canGoBack: state.canGoBack,
        canGoForward: state.canGoForward,
      };
    }
    case 'browser_click':
      return browser.click(input.selector as string);
    case 'browser_type':
      return browser.type(input.selector as string, input.text as string, input.clearFirst !== false);
    case 'browser_scroll':
      return browser.scroll((input.selector as string | undefined) ?? null, input.deltaY as number | undefined);
    case 'browser_wait_for':
      return browser.waitFor(input.selector as string, input.timeoutMs as number | undefined);
    case 'browser_evaluate_js':
      return browser.evaluateJs(input.expression as string);
    case 'browser_find_elements':
      return browser.findElements(input.selector as string, input.limit as number | undefined);
    case 'browser_get_page_state':
      return browser.getPageState();
    case 'browser_screenshot': {
      const shot = await browser.screenshot();
      const { readFileSync } = await import('fs');
      const b64 = readFileSync(shot.path).toString('base64');
      return { type: 'base64', mimeType: shot.mimeType, data: b64, width: shot.width, height: shot.height };
    }
    case 'browser_extract_text':
      return browser.extractText();
    case 'browser_new_tab': {
      const tab = await browser.newTab(input.url as string | undefined);
      return { id: tab.id, url: tab.url, title: tab.title };
    }
    case 'browser_switch_tab':
      await browser.switchTab(input.id as string);
      return { ok: true };
    case 'browser_list_tabs':
      return browser.listTabs();
    case 'browser_select':
      return browser.select(input.selector as string, input.value as string);
    case 'browser_hover':
      return browser.hover(input.selector as string);
    case 'browser_key_press':
      return browser.keyPress(input.key as string);
    case 'browser_close_tab':
      await browser.closeTab(input.id as string);
      return { ok: true };
    case 'browser_get_element_text':
      return browser.getElementText(input.selector as string);
    case 'browser_back':
      await browser.back();
      return { ok: true };
    case 'browser_forward':
      await browser.forward();
      return { ok: true };
    case 'browser_stop_loading':
      return (browser as ElectronBrowserService).stopLoading();
    case 'browser_wait_for_network_idle':
      return (browser as ElectronBrowserService).waitForNetworkIdle(input.idleMs as number | undefined, input.timeoutMs as number | undefined);
    case 'browser_wait_for_navigation':
      return (browser as ElectronBrowserService).waitForNavigation(input.timeoutMs as number | undefined);
    case 'browser_get_network_activity':
      return (browser as ElectronBrowserService).getNetworkActivity();
    case 'browser_set_user_agent':
      return (browser as ElectronBrowserService).setUserAgent(input.userAgent as string);
    case 'browser_open_file':
      return openFileInBrowser(
        input.filePath as string,
        { mode: input.mode as BrowserOpenMode | undefined },
        browser,
      );
    default:
      return { ok: false, error: `Unknown browser tool: ${name}` };
  }
}

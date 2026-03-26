// src/main/core/cli/browserTools.ts
import type Anthropic from '@anthropic-ai/sdk';
import type { BrowserService } from '../browser/BrowserService';

export const BROWSER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate the browser to a URL. Returns the final URL and page title.',
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
    description: 'Type text into an element identified by a CSS selector. Clears the field first by default.',
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
    description: 'Take a screenshot of the current browser view. Returns the file path.',
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
    description: 'Open a new browser tab, optionally navigating to a URL.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to open in the new tab (optional)' },
      },
    },
  },
  {
    name: 'browser_switch_tab',
    description: 'Switch to a browser tab by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Tab ID to switch to' },
      },
      required: ['id'],
    },
  },
  {
    name: 'browser_list_tabs',
    description: 'List all open browser tabs with their IDs, titles, URLs, and active state.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

export type BrowserToolInput = Record<string, unknown>;

export async function executeBrowserTool(
  name: string,
  input: BrowserToolInput,
  browser: BrowserService,
): Promise<unknown> {
  switch (name) {
    case 'browser_navigate': {
      const result = await browser.navigate(input.url as string);
      return { url: result.url, title: result.title };
    }
    case 'browser_click':
      return browser.click(input.selector as string);
    case 'browser_type':
      return browser.type(
        input.selector as string,
        input.text as string,
        input.clearFirst !== false,
      );
    case 'browser_scroll':
      return browser.scroll(
        (input.selector as string | undefined) ?? null,
        input.deltaY as number | undefined,
      );
    case 'browser_wait_for':
      return browser.waitFor(
        input.selector as string,
        input.timeoutMs as number | undefined,
      );
    case 'browser_evaluate_js':
      return browser.evaluateJs(input.expression as string);
    case 'browser_find_elements':
      return browser.findElements(
        input.selector as string,
        input.limit as number | undefined,
      );
    case 'browser_get_page_state':
      return browser.getPageState();
    case 'browser_screenshot': {
      const shot = await browser.screenshot();
      return { path: shot.path };
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
    default:
      return { ok: false, error: `Unknown browser tool: ${name}` };
  }
}

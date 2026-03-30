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
    description: 'Take a screenshot of the current browser view. Returns base64-encoded PNG that you can inspect visually.',
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
      // Read the PNG back as base64 so multimodal models can see it
      const { readFileSync } = await import('fs');
      const b64 = readFileSync(shot.path).toString('base64');
      return {
        type: 'base64',
        mimeType: shot.mimeType,
        data: b64,
        width: shot.width,
        height: shot.height,
      };
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
    default:
      return { ok: false, error: `Unknown browser tool: ${name}` };
  }
}

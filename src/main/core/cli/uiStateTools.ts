/**
 * UI state + map tools — give the agent complete self-awareness of the Clawdia UI.
 *
 * Three tools:
 *
 * 1. ui_state       — Live snapshot: which panels are open, active conversation tab, model, browser URL.
 * 2. ui_map         — Static map: every view, panel, button, toggle in the app and what each does.
 * 3. ui_map_element — Drill into a specific element by ID for detailed information.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { getUIState } from './uiStateAccessor';
import {
  CLAWDIA_UI_MAP,
  getVisibleElements,
  getElement,
  getChildren,
  getElementsByType,
} from './uiMap';

// ── Tool executor ─────────────────────────────────────────────────────────────

export async function executeUIStateTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {

      // ── ui_state ────────────────────────────────────────────────────────────
      case 'ui_state': {
        const state = getUIState();
        if (!state) {
          return JSON.stringify({
            ok: false,
            error: 'UI state not yet available — renderer has not pushed state yet.',
            hint: 'Call ui_map to understand the app structure without live state.',
          });
        }
        return JSON.stringify({ ok: true, ...state });
      }

      // ── ui_map ──────────────────────────────────────────────────────────────
      case 'ui_map': {
        const query = (input.query as string | undefined)?.toLowerCase().trim();
        const elementType = input.element_type as string | undefined;
        const liveContextOnly = Boolean(input.live_context_only);

        // If live_context_only: combine static map with live state for visible-now elements
        if (liveContextOnly) {
          const state = getUIState();
          const activeView = state?.activeView ?? 'chat';
          const rightPaneMode = state?.activeRightPanel ?? 'none';
          const visible = getVisibleElements(activeView, rightPaneMode);
          return JSON.stringify({
            ok: true,
            mode: 'live_context',
            activeView,
            rightPaneMode,
            visibleElementCount: visible.length,
            visibleElements: visible.map(el => ({
              id: el.id,
              label: el.label,
              type: el.type,
              action: el.action,
              states: el.states,
              shortcut: el.shortcut,
            })),
          });
        }

        // Filter by element type
        if (elementType) {
          const typed = getElementsByType(elementType as any);
          return JSON.stringify({
            ok: true,
            mode: 'by_type',
            elementType,
            count: typed.length,
            elements: typed,
          });
        }

        // Keyword search across all elements
        if (query) {
          const matches = Object.values(CLAWDIA_UI_MAP.elements).filter(el => {
            const text = [el.id, el.label, el.action, el.notes, el.visibility, ...(el.states ?? [])]
              .filter(Boolean).join(' ').toLowerCase();
            return text.includes(query);
          });
          return JSON.stringify({
            ok: true,
            mode: 'search',
            query,
            count: matches.length,
            elements: matches,
          });
        }

        // Default: return full map summary (views + element IDs with labels)
        return JSON.stringify({
          ok: true,
          mode: 'full_summary',
          shortcuts: CLAWDIA_UI_MAP.shortcuts,
          rightPaneModes: CLAWDIA_UI_MAP.rightPaneModes,
          views: CLAWDIA_UI_MAP.views,
          elementCount: Object.keys(CLAWDIA_UI_MAP.elements).length,
          elements: Object.values(CLAWDIA_UI_MAP.elements).map(el => ({
            id: el.id,
            label: el.label,
            type: el.type,
            parent: el.parent,
            visibility: el.visibility,
            action: el.action,
            shortcut: el.shortcut,
          })),
        });
      }

      // ── ui_map_element ──────────────────────────────────────────────────────
      case 'ui_map_element': {
        const id = (input.id as string | undefined)?.trim();
        if (!id) {
          return JSON.stringify({ ok: false, error: 'id is required' });
        }

        const el = getElement(id);
        if (!el) {
          // Fuzzy: try to find partial matches
          const partialMatches = Object.keys(CLAWDIA_UI_MAP.elements).filter(k =>
            k.includes(id.toLowerCase()) || id.toLowerCase().includes(k)
          );
          return JSON.stringify({
            ok: false,
            error: `No element found with id "${id}"`,
            suggestions: partialMatches.slice(0, 8),
          });
        }

        const children = getChildren(id);
        const parent = el.parent ? getElement(el.parent) : null;

        return JSON.stringify({
          ok: true,
          element: el,
          parent: parent ? { id: parent.id, label: parent.label, type: parent.type } : null,
          children: children.map(c => ({ id: c.id, label: c.label, type: c.type, action: c.action })),
        });
      }

      default:
        return JSON.stringify({ ok: false, error: `Unknown ui tool: ${name}` });
    }
  } catch (err: unknown) {
    return JSON.stringify({ ok: false, error: (err as Error).message });
  }
}

// ── Tool definitions (Anthropic schema) ──────────────────────────────────────

export const UI_STATE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'ui_state',
    description: [
      'Get a live snapshot of the current Clawdia UI: which panels are open (browser/terminal/editor),',
      'the active view (chat/settings/conversations/processes/agents), the active conversation tab,',
      'all open conversation tabs, current provider and model, open terminal session IDs, and browser URL.',
      'Use this first to understand what the user is currently seeing before taking any UI action.',
    ].join(' '),
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },

  {
    name: 'ui_map',
    description: [
      'Query the complete static UI map of Clawdia — every view, panel, button, toggle, dropdown,',
      'and overlay in the application, with descriptions of what each does, when it is visible,',
      'keyboard shortcuts, and parent/child relationships.',
      'Use with no arguments to get the full map summary.',
      'Use "query" to search for specific elements (e.g. "stop button", "model selector").',
      'Use "element_type" to filter by type: button, input, dropdown, toggle, panel, view, tab, overlay, section.',
      'In this UI map, "tab" usually refers to conversation-tab UI elements unless the element explicitly says browser tab.',
      'Use "live_context_only: true" to get only elements visible in the current UI state.',
    ].join(' '),
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Keyword search across element labels, descriptions, and actions. E.g. "stop", "model", "browser", "approval".',
        },
        element_type: {
          type: 'string',
          description: 'Filter by element type: "button", "input", "dropdown", "toggle", "panel", "view", "tab", "overlay", "section".',
        },
        live_context_only: {
          type: 'boolean',
          description: 'If true, returns only elements visible right now (requires live ui_state to have been pushed by renderer).',
        },
      },
    },
  },

  {
    name: 'ui_map_element',
    description: [
      'Get full details about a specific UI element by its ID, including its parent, all children,',
      'visibility conditions, action description, keyboard shortcut, and possible states.',
      'Use ui_map first to discover element IDs, then drill in with this tool.',
    ].join(' '),
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'The element ID from the UI map (e.g. "inputbar_send_button", "browser_panel", "tabstrip"). Conversation-tab and browser-tab elements are labeled separately in the map.',
        },
      },
      required: ['id'],
    },
  },
];

export const UI_STATE_TOOL_NAMES = new Set(UI_STATE_TOOLS.map(t => t.name));

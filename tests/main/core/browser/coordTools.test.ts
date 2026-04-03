/**
 * Tests for coordinate-based browser tools (browser_click_at, browser_double_click_at,
 * browser_drag_coords, browser_move_to, browser_scroll_at) and new selector-based tools
 * (browser_right_click, browser_double_click, browser_drag, browser_verify_action).
 *
 * Verifies tool registration and dispatch routing, not Electron/CDP internals.
 */
import { describe, it, expect } from 'vitest';
import { BROWSER_TOOLS } from '../../../../src/main/core/cli/browserTools';

// ── Tool registry ─────────────────────────────────────────────────────────────

const toolByName = Object.fromEntries(BROWSER_TOOLS.map(t => [t.name, t]));

const NEW_TOOLS = [
  'browser_click_at',
  'browser_double_click_at',
  'browser_drag_coords',
  'browser_move_to',
  'browser_scroll_at',
  'browser_right_click',
  'browser_double_click',
  'browser_drag',
  'browser_verify_action',
];

describe('new browser tool registrations', () => {
  it('all new tools are present in BROWSER_TOOLS', () => {
    for (const name of NEW_TOOLS) {
      expect(toolByName[name], `missing tool: ${name}`).toBeDefined();
    }
  });

  it('every new tool has a non-empty description', () => {
    for (const name of NEW_TOOLS) {
      expect(toolByName[name].description.length, `${name} has empty description`).toBeGreaterThan(10);
    }
  });

  it('every new tool has an input_schema', () => {
    for (const name of NEW_TOOLS) {
      expect(toolByName[name].input_schema, `${name} missing input_schema`).toBeDefined();
    }
  });

  describe('browser_click_at schema', () => {
    const tool = toolByName['browser_click_at'];
    it('requires x and y', () => {
      expect(tool.input_schema.required).toContain('x');
      expect(tool.input_schema.required).toContain('y');
    });
    it('has optional button with left/right/middle enum', () => {
      const props = tool.input_schema.properties as any;
      expect(props.button?.enum).toEqual(['left', 'right', 'middle']);
    });
  });

  describe('browser_drag_coords schema', () => {
    const tool = toolByName['browser_drag_coords'];
    it('requires fromX, fromY, toX, toY', () => {
      for (const f of ['fromX', 'fromY', 'toX', 'toY']) {
        expect(tool.input_schema.required).toContain(f);
      }
    });
    it('has optional steps property', () => {
      const props = tool.input_schema.properties as any;
      expect(props.steps).toBeDefined();
    });
  });

  describe('browser_scroll_at schema', () => {
    const tool = toolByName['browser_scroll_at'];
    it('requires x and y', () => {
      expect(tool.input_schema.required).toContain('x');
      expect(tool.input_schema.required).toContain('y');
    });
    it('has optional deltaX and deltaY', () => {
      const props = tool.input_schema.properties as any;
      expect(props.deltaX).toBeDefined();
      expect(props.deltaY).toBeDefined();
    });
  });

  describe('browser_verify_action schema', () => {
    const tool = toolByName['browser_verify_action'];
    it('requires tool and input fields', () => {
      expect(tool.input_schema.required).toContain('tool');
      expect(tool.input_schema.required).toContain('input');
    });
    it('has optional settleMs and minDiffRatio', () => {
      const props = tool.input_schema.properties as any;
      expect(props.settleMs).toBeDefined();
      expect(props.minDiffRatio).toBeDefined();
    });
  });

  describe('browser_drag schema', () => {
    const tool = toolByName['browser_drag'];
    it('requires fromSelector and toSelector', () => {
      expect(tool.input_schema.required).toContain('fromSelector');
      expect(tool.input_schema.required).toContain('toSelector');
    });
  });
});

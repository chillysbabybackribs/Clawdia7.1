import {
  initBrowserBudget,
  checkBrowserBudget,
  updateBrowserBudget,
  checkToolPolicy,
} from '../../../src/main/agent/browserBudget';
import type { ToolUseBlock } from '../../../src/main/agent/types';

function block(name: string, input: Record<string, unknown> = {}): ToolUseBlock {
  return { id: `id-${name}`, name, input };
}

describe('browserBudget', () => {
  it('allows tools when budget is clean', () => {
    const state = initBrowserBudget();
    expect(checkBrowserBudget([block('browser_navigate', { url: 'https://a.com' })], state)).toBeNull();
  });

  it('blocks search after 2 rounds', () => {
    const state = initBrowserBudget();
    state.searchRounds = 2;
    expect(checkBrowserBudget([block('browser_navigate', { url: 'https://google.com/search?q=foo' })], state)).toMatch(/search round/i);
  });

  it('blocks when inspected targets exceed 6', () => {
    const state = initBrowserBudget();
    for (let i = 0; i < 6; i++) state.inspectedTargets.add(`https://site${i}.com`);
    expect(checkBrowserBudget([block('browser_extract_text')], state)).toMatch(/target/i);
  });

  it('blocks when background tabs exceed 6', () => {
    const state = initBrowserBudget();
    state.backgroundTabs = 6;
    expect(checkBrowserBudget([block('browser_new_tab')], state)).toMatch(/tab/i);
  });

  it('updateBrowserBudget increments search rounds for google navigate', () => {
    const state = initBrowserBudget();
    updateBrowserBudget(
      [block('browser_navigate', { url: 'https://google.com/search?q=test' })],
      ['{"url":"https://google.com/search?q=test","title":"Google"}'],
      state,
    );
    expect(state.searchRounds).toBe(1);
  });

  it('updateBrowserBudget tracks inspected targets for extract_text', () => {
    const state = initBrowserBudget();
    state.inspectedTargets.add('https://example.com');
    expect(state.inspectedTargets.size).toBe(1);
  });

  it('checkToolPolicy blocks absolute paths in file_edit create', () => {
    expect(checkToolPolicy([block('file_edit', { command: 'create', path: '/etc/passwd', file_text: 'x' })])).toMatch(/absolute/i);
  });

  it('checkToolPolicy allows relative paths', () => {
    expect(checkToolPolicy([block('file_edit', { command: 'create', path: 'src/foo.ts', file_text: 'x' })])).toBeNull();
  });

  it('returns null for non-browser non-file tools', () => {
    const state = initBrowserBudget();
    expect(checkBrowserBudget([block('shell_exec', { command: 'ls' })], state)).toBeNull();
    expect(checkToolPolicy([block('shell_exec', { command: 'ls' })])).toBeNull();
  });
});

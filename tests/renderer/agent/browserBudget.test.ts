import {
  initBrowserBudget,
  checkBrowserBudget,
  updateBrowserBudget,
  checkToolPolicy,
  checkBrowserScreenshotPolicy,
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
    updateBrowserBudget(
      [{ id: 'x', name: 'browser_extract_text', input: {} }],
      ['{"url":"https://example.com","text":"hello"}'],
      state,
    );
    expect(state.inspectedTargets.has('https://example.com')).toBe(true);
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

  it('blocks screenshot in the same turn as navigate for non-visual tasks', () => {
    expect(
      checkBrowserScreenshotPolicy(
        [block('browser_navigate', { url: 'https://example.com' }), block('browser_screenshot')],
        'navigate to example.com',
        [],
      ),
    ).toMatch(/same turn as browser_navigate/i);
  });

  it('blocks screenshot immediately after a verified navigate for non-visual tasks', () => {
    expect(
      checkBrowserScreenshotPolicy(
        [block('browser_screenshot')],
        'what page is this?',
        [{
          name: 'browser_navigate',
          result: JSON.stringify({
            url: 'https://example.com',
            title: 'Example',
            textSample: 'Example Domain',
          }),
        }],
      ),
    ).toMatch(/immediately after a verified browser_navigate/i);
  });

  it('allows screenshot when the task is explicitly visual', () => {
    expect(
      checkBrowserScreenshotPolicy(
        [block('browser_screenshot')],
        'take a screenshot so I can see what the page looks like',
        [{
          name: 'browser_navigate',
          result: JSON.stringify({
            url: 'https://example.com',
            title: 'Example',
            textSample: 'Example Domain',
          }),
        }],
      ),
    ).toBeNull();
  });
});

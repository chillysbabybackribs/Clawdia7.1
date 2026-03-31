import { describe, expect, it } from 'vitest';

import {
  buildRecoveryGuidanceMessage,
  detectRecoveryFromTurn,
  detectStall,
} from '../../../src/main/agent/recoveryGuidance';

describe('recoveryGuidance', () => {
  it('detects element-not-found failures from tool results', () => {
    const key = detectRecoveryFromTurn(
      [{ id: '1', name: 'browser_click', input: { selector: '#submit' } }],
      ['{"ok":false,"error":"Element not found for selector #submit"}'],
    );

    expect(key).toBe('element_not_found');
  });

  it('detects browser blocked failures from tool results', () => {
    const key = detectRecoveryFromTurn(
      [{ id: '1', name: 'browser_extract_text', input: {} }],
      ['Please sign in to continue'],
    );

    expect(key).toBe('browser_blocked');
  });

  it('detects stalls from repeated identical recent tool results', () => {
    const key = detectStall([
      { id: '1', name: 'browser_get_page_state', input: {}, result: '{"url":"https://x.test","title":"A"}' },
      { id: '2', name: 'browser_get_page_state', input: {}, result: '{"url":"https://x.test","title":"A"}' },
      { id: '3', name: 'browser_get_page_state', input: {}, result: '{"url":"https://x.test","title":"A"}' },
    ]);

    expect(key).toBe('stall_detected');
  });

  it('loads recovery playbook content from the prompt registry', () => {
    const message = buildRecoveryGuidanceMessage('browser_blocked');
    expect(message).toContain('RECOVERY PLAYBOOK: browser_blocked');
    expect(message).toContain('Recovery: Browser Blocked');
  });
});

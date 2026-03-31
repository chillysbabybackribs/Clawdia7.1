import { describe, expect, it } from 'vitest';

import { buildStaticPrompt } from '../../../src/main/agent/promptBuilder';
import { buildSharedSystemPrompt } from '../../../src/main/core/cli/systemPrompt';

describe('prompt identity wiring', () => {
  it('buildStaticPrompt includes the current Clawdia identity and browser guidance', () => {
    const prompt = buildStaticPrompt(
      { toolGroup: 'browser', modelTier: 'powerful', isGreeting: false },
      false,
    );

    expect(prompt).toContain('You are Clawdia, an agentic AI assistant');
    expect(prompt).toContain("running locally on the user's machine");
    expect(prompt).toContain('You have access to local CLI tools and a browser.');
    expect(prompt).toContain('You have browser tools available.');
    expect(prompt).toContain('stream usable information to the user as soon as you have it');
    expect(prompt).toContain('prefer browser_get_page_state');
    expect(prompt).toContain('Use browser_screenshot only when the task is explicitly visual');
    expect(prompt).toContain('Always use your tools');
    expect(prompt).toContain('When a task involves web content, use browser tools directly');
  });

  it('buildSharedSystemPrompt includes the current shared identity and tool-loading rules', async () => {
    const prompt = await buildSharedSystemPrompt(false);

    expect(prompt).toContain('You are Clawdia, an agentic AI assistant');
    expect(prompt).toContain('You have access to a local CLI environment and a browser.');
    expect(prompt).toContain('TOOLS AVAILABLE:');
    expect(prompt).toContain('- shell_exec: run any bash shell command');
    expect(prompt).toContain('- search_tools: discover additional tools');
    expect(prompt).toContain('call search_tools FIRST');
    expect(prompt).toContain('Prefer structured tools');
  });
});

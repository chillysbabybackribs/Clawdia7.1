import { describe, expect, it } from 'vitest';

import { buildStaticPrompt } from '../../../src/main/agent/promptBuilder';
import { buildSharedSystemPrompt } from '../../../src/main/core/cli/systemPrompt';

describe('prompt identity wiring', () => {
  it('buildStaticPrompt includes whoami identity and capability navigation', () => {
    const prompt = buildStaticPrompt(
      { toolGroup: 'browser', modelTier: 'powerful', isGreeting: false },
      false,
    );

    expect(prompt).toContain('I am Clawdia');
    expect(prompt).toContain('system/whoami.md');
    expect(prompt).toContain('system/principles.md');
    expect(prompt).toContain('CAPABILITY NAVIGATION:');
    expect(prompt).toContain('Task type: web-research');
    expect(prompt).toContain('system/registry/capability-registry.json');
    expect(prompt).toContain('tool manifest key: browser-read');
    expect(prompt).toContain('SELECTED CAPABILITY CONTENT');
    expect(prompt).toContain('DOMAIN FILE');
    expect(prompt).toContain('TASK FILE');
    expect(prompt).toContain('TOOL MANIFEST');
    expect(prompt).toContain('CONTRACT FILE');
    expect(prompt).toContain('Browser Domain');
    expect(prompt).toContain('Task: web-research');
    expect(prompt).toContain('Browser Task Completion Contract');
    expect(prompt).toContain('Scoped tools:');
    expect(prompt).toContain('- browser_extract_text');
  });

  it('buildSharedSystemPrompt includes the same root identity context', async () => {
    const prompt = await buildSharedSystemPrompt(false, 'mock-capabilities');

    expect(prompt).toContain('I am Clawdia');
    expect(prompt).toContain('system/whoami.md');
    expect(prompt).toContain('system/principles.md');
    expect(prompt).toContain('CAPABILITY NAVIGATION:');
    expect(prompt).toContain('Task type: chat');
    expect(prompt).toContain('OS CONTEXT:');
    expect(prompt).toContain('mock-capabilities');
  });
});

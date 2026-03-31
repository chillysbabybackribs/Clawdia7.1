import { describe, expect, it } from 'vitest';

import { buildPromptComposition, clearPromptAssetCache } from '../../../src/main/skills/promptComposition';
import { clearSkillCache } from '../../../src/main/skills/skillSystem';

describe('promptComposition', () => {
  it('loads context, coding domain, contract, and matching skills for coding tasks', () => {
    clearPromptAssetCache();
    clearSkillCache();

    const result = buildPromptComposition({
      message: 'audit the codex implementation and improve code performance',
      toolGroup: 'coding',
      executor: 'codex',
    });

    expect(result.assets.map((asset) => asset.relativePath)).toContain('system/context.md');
    expect(result.assets.map((asset) => asset.relativePath)).toContain('domains/coding.md');
    expect(result.assets.map((asset) => asset.relativePath)).toContain('contracts/code-task-done.md');
    expect(result.promptBlock).toContain('RUNTIME GUIDANCE');
    expect(result.promptBlock).toContain('Situational Context');
    expect(result.promptBlock).toContain('Domain: Coding');
    expect(result.promptBlock).toContain('Contract: Code Task Done');
    expect(result.promptBlock).toContain('ACTIVE SKILLS');
  });

  it('loads browser domain guidance and browser contract for browser tasks', () => {
    clearPromptAssetCache();
    clearSkillCache();

    const result = buildPromptComposition({
      message: 'navigate to a website and extract the answer',
      toolGroup: 'browser',
      executor: 'agentLoop',
    });

    expect(result.assets.map((asset) => asset.relativePath)).toContain('domains/browser.md');
    expect(result.assets.map((asset) => asset.relativePath)).toContain('contracts/browser-task-done.md');
    expect(result.promptBlock).toContain('Browser Task Completion Contract');
  });

  it('uses the prompt registry overrides for full tool-group coding intent', () => {
    clearPromptAssetCache();
    clearSkillCache();

    const result = buildPromptComposition({
      message: 'debug this python code path',
      toolGroup: 'full',
      executor: 'codex',
    });

    expect(result.assets.map((asset) => asset.relativePath)).toContain('domains/coding.md');
    expect(result.assets.map((asset) => asset.relativePath)).toContain('contracts/code-task-done.md');
  });
});

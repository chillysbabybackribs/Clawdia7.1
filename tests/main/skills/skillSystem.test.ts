import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildSkillPromptContext,
  clearSkillCache,
  loadSkillsFromDir,
  matchSkills,
  parseSkillMarkdown,
} from '../../../src/main/skills/skillSystem';

describe('skillSystem', () => {
  afterEach(() => {
    delete process.env.CLAWDIA_SKILLS_DIR;
    clearSkillCache();
  });

  it('parses a SKILL.md file with frontmatter', () => {
    const skill = parseSkillMarkdown(`---
id: repo-audit
name: Repo Audit
description: Audit repo behavior
priority: 99
triggers: audit, codex
tool_groups: coding, full
executors: codex
---
Inspect the active runtime path first.`);

    expect(skill.id).toBe('repo-audit');
    expect(skill.priority).toBe(99);
    expect(skill.triggers).toEqual(['audit', 'codex']);
    expect(skill.toolGroups).toEqual(['coding', 'full']);
    expect(skill.executors).toEqual(['codex']);
    expect(skill.body).toContain('active runtime path');
  });

  it('loads skills from the configured directory and matches relevant skills', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawdia-skills-'));
    const skillDir = path.join(tempDir, 'repo-audit');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
id: repo-audit
name: Repo Audit
description: Audit repo behavior
priority: 90
triggers: audit, architecture, codex
tool_groups: coding, full
executors: codex
---
Inspect the active runtime path first.`);

    process.env.CLAWDIA_SKILLS_DIR = tempDir;
    const skills = loadSkillsFromDir();
    expect(skills).toHaveLength(1);

    const matches = matchSkills({
      message: 'audit the codex architecture and implementation',
      toolGroup: 'coding',
      executor: 'codex',
    }, skills);

    expect(matches).toHaveLength(1);
    expect(matches[0].skill.id).toBe('repo-audit');
    expect(matches[0].matchedTriggers).toContain('audit');
    expect(matches[0].matchedTriggers).toContain('codex');
  });

  it('builds a prompt block for selected skills', () => {
    const context = buildSkillPromptContext({
      message: 'review this code for regressions',
      toolGroup: 'coding',
      executor: 'codex',
    }, [
      parseSkillMarkdown(`---
id: code-review
name: Code Review
description: Review for regressions
priority: 90
triggers: review, regressions
tool_groups: coding
executors: codex
---
Lead with concrete findings.`),
    ]);

    expect(context.promptBlock).toContain('ACTIVE SKILLS');
    expect(context.promptBlock).toContain('[Skill: Code Review]');
    expect(context.promptBlock).toContain('Lead with concrete findings.');
  });
});

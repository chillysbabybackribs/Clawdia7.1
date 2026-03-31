import * as fs from 'fs';
import * as path from 'path';

import type { ToolGroup } from '../agent/types';

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  priority: number;
  triggers: string[];
  toolGroups: string[];
  executors: string[];
  body: string;
  sourcePath: string;
}

export interface SkillMatchInput {
  message: string;
  toolGroup?: ToolGroup;
  executor?: string;
  preferredSkillIds?: string[];
  limit?: number;
}

export interface MatchedSkill {
  skill: SkillDefinition;
  score: number;
  matchedTriggers: string[];
}

export interface SkillPromptContext {
  matchedSkills: MatchedSkill[];
  promptBlock: string;
}

let cachedDir: string | null = null;
let cachedSkills: SkillDefinition[] | null = null;

export function clearSkillCache(): void {
  cachedDir = null;
  cachedSkills = null;
}

export function resolveSkillsDir(): string {
  return process.env.CLAWDIA_SKILLS_DIR || path.resolve(process.cwd(), 'skills');
}

export function parseSkillMarkdown(markdown: string, sourcePath = '<inline>'): SkillDefinition {
  const trimmed = markdown.trim();
  const match = trimmed.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Skill file ${sourcePath} is missing required frontmatter`);
  }

  const metadata = parseFrontmatter(match[1], sourcePath);
  const body = match[2].trim();
  if (!body) {
    throw new Error(`Skill file ${sourcePath} has no instruction body`);
  }

  const id = metadata.id || deriveSkillId(sourcePath);
  const name = metadata.name || id;
  const description = metadata.description || '';
  const priority = Number.parseInt(metadata.priority || '50', 10);
  const triggers = splitList(metadata.triggers);
  const toolGroups = splitList(metadata.tool_groups);
  const executors = splitList(metadata.executors);

  if (!id) throw new Error(`Skill file ${sourcePath} must define an id`);
  if (triggers.length === 0) throw new Error(`Skill file ${sourcePath} must define at least one trigger`);

  return {
    id,
    name,
    description,
    priority: Number.isFinite(priority) ? priority : 50,
    triggers,
    toolGroups,
    executors,
    body,
    sourcePath,
  };
}

export function loadSkillsFromDir(skillsDir = resolveSkillsDir()): SkillDefinition[] {
  if (cachedSkills && cachedDir === skillsDir) {
    return cachedSkills;
  }

  if (!fs.existsSync(skillsDir)) {
    cachedDir = skillsDir;
    cachedSkills = [];
    return cachedSkills;
  }

  const skillFiles = findSkillFiles(skillsDir);
  const skills = skillFiles
    .map((filePath) => parseSkillMarkdown(fs.readFileSync(filePath, 'utf8'), filePath))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  cachedDir = skillsDir;
  cachedSkills = skills;
  return skills;
}

export function matchSkills(
  input: SkillMatchInput,
  skills = loadSkillsFromDir(),
): MatchedSkill[] {
  const { message, toolGroup, executor, preferredSkillIds = [], limit = 3 } = input;
  const lower = message.toLowerCase();
  const preferred = new Set(preferredSkillIds);

  return skills
    .map((skill) => {
      const matchedTriggers = skill.triggers.filter((trigger) => triggerMatches(lower, trigger));
      const executorMatch = listAllows(skill.executors, executor);
      const toolGroupMatch = listAllows(skill.toolGroups, toolGroup);
      const preferredMatch = preferred.has(skill.id);
      const score = skill.priority
        + matchedTriggers.length * 25
        + (toolGroupMatch ? 15 : 0)
        + (executorMatch ? 10 : 0)
        + (preferredMatch ? 40 : 0);

      if (matchedTriggers.length === 0 && !preferredMatch) return null;
      if (skill.executors.length > 0 && !executorMatch) return null;
      if (skill.toolGroups.length > 0 && !toolGroupMatch) return null;

      return { skill, score, matchedTriggers };
    })
    .filter((entry): entry is MatchedSkill => Boolean(entry))
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
    .slice(0, limit);
}

export function buildSkillPromptContext(
  input: SkillMatchInput,
  skills = loadSkillsFromDir(),
): SkillPromptContext {
  const matchedSkills = matchSkills(input, skills);
  return {
    matchedSkills,
    promptBlock: buildSkillPromptBlock(matchedSkills),
  };
}

export function buildSkillPromptBlock(matches: MatchedSkill[]): string {
  if (matches.length === 0) return '';

  const summary = matches
    .map(({ skill, matchedTriggers }) => {
      const triggerText = matchedTriggers.slice(0, 3).join(', ');
      const description = skill.description ? ` - ${skill.description}` : '';
      return `- ${skill.name} (${skill.id})${description}. Matched on: ${triggerText}`;
    })
    .join('\n');

  const instructions = matches
    .map(({ skill }) => `[Skill: ${skill.name}]\n${skill.body}`)
    .join('\n\n');

  const block = `ACTIVE SKILLS:
${summary}

Follow the skill instructions below when they help complete the task. Prefer these over generic behavior when there is a conflict.

${instructions}`;

  return block.length > 6000 ? `${block.slice(0, 6000)}\n\n[skill block truncated]` : block;
}

function parseFrontmatter(frontmatter: string, sourcePath: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of frontmatter.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) {
      throw new Error(`Invalid frontmatter line in ${sourcePath}: ${rawLine}`);
    }
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    result[key] = stripQuotes(value);
  }

  return result;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
    return value.slice(1, -1);
  }
  return value;
}

function splitList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function deriveSkillId(sourcePath: string): string {
  const base = path.basename(path.dirname(sourcePath)) || path.basename(sourcePath, path.extname(sourcePath));
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function findSkillFiles(rootDir: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findSkillFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name === 'SKILL.md') {
      files.push(fullPath);
    }
  }

  return files;
}

function listAllows(values: string[], current?: string): boolean {
  if (values.length === 0) return true;
  if (!current) return false;
  return values.includes(current) || values.includes('any');
}

function triggerMatches(messageLower: string, trigger: string): boolean {
  const normalized = trigger.toLowerCase().trim();
  if (!normalized) return false;
  if (normalized.includes(' ')) return messageLower.includes(normalized);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(messageLower);
}

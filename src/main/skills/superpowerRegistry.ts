import * as fs from 'fs';
import * as path from 'path';

import type { ToolGroup, ModelTier } from '../agent/types';

export type SuperpowerMode = 'full' | 'limited' | 'prompt_only' | 'disabled';

export interface SuperpowerDefinition {
  id: string;
  name: string;
  description: string;
  priority: number;
  triggers: string[];
  toolGroups: string[];
  executors: string[];
  providers: string[];
  minModelTier?: ModelTier;
  skillIds: string[];
  prompt?: string;
  providerModes: Record<string, SuperpowerMode>;
  executorModes: Record<string, SuperpowerMode>;
  fallback?: string;
}

export interface SuperpowerMatchInput {
  message: string;
  toolGroup?: ToolGroup;
  executor?: string;
  provider?: string;
  modelTier?: ModelTier;
  limit?: number;
}

export interface MatchedSuperpower {
  superpower: SuperpowerDefinition;
  score: number;
  matchedTriggers: string[];
  mode: SuperpowerMode;
}

type EnabledSuperpowerMode = Exclude<SuperpowerMode, 'disabled'>;

type SuperpowerMatchCandidate = {
  superpower: SuperpowerDefinition;
  score: number;
  matchedTriggers: string[];
  mode: EnabledSuperpowerMode;
} | null;

interface SuperpowerRegistryFile {
  version: string;
  superpowers: Array<{
    id: string;
    name: string;
    description?: string;
    priority?: number;
    triggers?: string[];
    tool_groups?: string[];
    executors?: string[];
    providers?: string[];
    min_model_tier?: ModelTier;
    skill_ids?: string[];
    prompt?: string;
    fallback?: string;
    provider_modes?: Record<string, SuperpowerMode>;
    executor_modes?: Record<string, SuperpowerMode>;
  }>;
}

let registryCache: SuperpowerDefinition[] | null = null;
let registryPathCache: string | null = null;

export function clearSuperpowerRegistryCache(): void {
  registryCache = null;
  registryPathCache = null;
}

export function loadSuperpowers(): SuperpowerDefinition[] {
  const registryPath = resolveSuperpowerRegistryPath();
  if (registryCache && registryPathCache === registryPath) return registryCache;

  if (!fs.existsSync(registryPath)) {
    registryCache = [];
    registryPathCache = registryPath;
    return registryCache;
  }

  const raw = fs.readFileSync(registryPath, 'utf8');
  const parsed = JSON.parse(raw) as SuperpowerRegistryFile;

  registryCache = (parsed.superpowers ?? []).map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description ?? '',
    priority: Number.isFinite(entry.priority) ? Number(entry.priority) : 50,
    triggers: Array.isArray(entry.triggers) ? entry.triggers.filter(Boolean) : [],
    toolGroups: Array.isArray(entry.tool_groups) ? entry.tool_groups.filter(Boolean) : [],
    executors: Array.isArray(entry.executors) ? entry.executors.filter(Boolean) : [],
    providers: Array.isArray(entry.providers) ? entry.providers.filter(Boolean) : [],
    minModelTier: entry.min_model_tier,
    skillIds: Array.isArray(entry.skill_ids) ? entry.skill_ids.filter(Boolean) : [],
    prompt: entry.prompt?.trim() || '',
    fallback: entry.fallback?.trim() || '',
    providerModes: entry.provider_modes ?? {},
    executorModes: entry.executor_modes ?? {},
  }));
  registryPathCache = registryPath;
  return registryCache;
}

export function matchSuperpowers(
  input: SuperpowerMatchInput,
  superpowers = loadSuperpowers(),
): MatchedSuperpower[] {
  const lower = input.message.toLowerCase();
  const limit = input.limit ?? 3;

  return superpowers
    .map((superpower): SuperpowerMatchCandidate => {
      const matchedTriggers = superpower.triggers.filter((trigger) => triggerMatches(lower, trigger));
      if (matchedTriggers.length === 0) return null;

      const toolGroupMatch = listAllows(superpower.toolGroups, input.toolGroup);
      const executorMatch = listAllows(superpower.executors, input.executor);
      const providerMatch = listAllows(superpower.providers, input.provider);
      if (superpower.toolGroups.length > 0 && !toolGroupMatch) return null;
      if (superpower.executors.length > 0 && !executorMatch) return null;
      if (superpower.providers.length > 0 && !providerMatch) return null;
      if (!meetsModelTier(superpower.minModelTier, input.modelTier)) return null;

      const mode = resolveMode(superpower, input);
      if (mode === 'disabled') return null;

      const score = superpower.priority
        + matchedTriggers.length * 25
        + (toolGroupMatch ? 15 : 0)
        + (executorMatch ? 10 : 0)
        + (providerMatch ? 10 : 0)
        + (mode === 'full' ? 15 : mode === 'limited' ? 8 : 3);

      return { superpower, score, matchedTriggers, mode };
    })
    .filter((entry): entry is Exclude<SuperpowerMatchCandidate, null> => entry !== null)
    .sort((a, b) => b.score - a.score || a.superpower.id.localeCompare(b.superpower.id))
    .slice(0, limit);
}

export function buildSuperpowerPromptBlock(matches: MatchedSuperpower[]): string {
  if (matches.length === 0) return '';

  const summary = matches
    .map(({ superpower, matchedTriggers, mode }) => (
      `- ${superpower.name} (${superpower.id}) - ${superpower.description}. `
      + `Mode: ${mode}. Matched on: ${matchedTriggers.slice(0, 3).join(', ')}`
    ))
    .join('\n');

  const instructions = matches
    .map(({ superpower, mode }) => {
      const parts = [`[Superpower: ${superpower.name}]`];
      if (superpower.prompt) parts.push(superpower.prompt);
      if (mode !== 'full' && superpower.fallback) parts.push(`Fallback: ${superpower.fallback}`);
      return parts.join('\n');
    })
    .join('\n\n');

  const block = `ACTIVE SUPERPOWERS:
${summary}

Use the superpowers below when they fit the task. Treat them as shared capability policies, then adapt execution to the current provider and executor.

${instructions}`.trim();

  return block.length > 4000 ? `${block.slice(0, 4000)}\n\n[superpower block truncated]` : block;
}

export function getRecommendedSkillIds(matches: MatchedSuperpower[]): string[] {
  const recommended = new Set<string>();
  for (const match of matches) {
    for (const skillId of match.superpower.skillIds) recommended.add(skillId);
  }
  return [...recommended];
}

function resolveSuperpowerRegistryPath(): string {
  const rootDir = process.env.CLAWDIA_PROMPT_ROOT || process.cwd();
  return process.env.CLAWDIA_SUPERPOWER_REGISTRY
    || path.resolve(rootDir, 'system/registry/superpowers.json');
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

function meetsModelTier(required?: ModelTier, actual?: ModelTier): boolean {
  if (!required || !actual) return true;
  const rank: Record<ModelTier, number> = { fast: 0, standard: 1, powerful: 2 };
  return rank[actual] >= rank[required];
}

function resolveMode(
  superpower: SuperpowerDefinition,
  input: SuperpowerMatchInput,
): SuperpowerMode {
  if (input.executor && superpower.executorModes[input.executor]) {
    return superpower.executorModes[input.executor];
  }
  if (input.provider && superpower.providerModes[input.provider]) {
    return superpower.providerModes[input.provider];
  }
  return superpower.executorModes.any
    ?? superpower.providerModes.any
    ?? 'full';
}

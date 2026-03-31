import * as fs from 'fs';
import * as path from 'path';

import type { ToolGroup } from '../agent/types';
import {
  buildSkillPromptContext,
  type MatchedSkill,
  type SkillPromptContext,
} from './skillSystem';
import {
  buildSuperpowerPromptBlock,
  getRecommendedSkillIds,
  matchSuperpowers,
  type MatchedSuperpower,
} from './superpowerRegistry';

export interface PromptCompositionInput {
  message: string;
  toolGroup?: ToolGroup;
  executor?: string;
  provider?: string;
  modelTier?: 'fast' | 'standard' | 'powerful';
}

export interface PromptAsset {
  label: string;
  relativePath: string;
  content: string;
}

export interface PromptCompositionResult {
  promptBlock: string;
  assets: PromptAsset[];
  matchedSkills: MatchedSkill[];
  matchedSuperpowers: MatchedSuperpower[];
}

interface PromptRegistry {
  version: string;
  defaults?: {
    assets?: string[];
  };
  profiles: Record<string, { assets?: string[] }>;
  recoveries?: Record<string, string>;
  overrides?: Array<{
    id: string;
    pattern: string;
    toolGroups?: string[];
    assets?: string[];
  }>;
}

const fileCache = new Map<string, string>();
let registryCache: PromptRegistry | null = null;

export function clearPromptAssetCache(): void {
  fileCache.clear();
  registryCache = null;
}

export function loadRecoveryPlaybook(key: string): string {
  const registry = loadPromptRegistry();
  const relativePath = registry.recoveries?.[key];
  if (!relativePath) return '';
  return readPromptAsset(relativePath);
}

export function buildPromptComposition(input: PromptCompositionInput): PromptCompositionResult {
  const assets = loadPromptAssets(input);
  const matchedSuperpowers = matchSuperpowers(input);
  const skillContext = buildSkillPromptContext({
    message: input.message,
    toolGroup: input.toolGroup,
    executor: input.executor,
    preferredSkillIds: getRecommendedSkillIds(matchedSuperpowers),
  });

  return {
    promptBlock: compilePromptBlock(assets, matchedSuperpowers, skillContext),
    assets,
    matchedSkills: skillContext.matchedSkills,
    matchedSuperpowers,
  };
}

export function loadPromptAssets(input: PromptCompositionInput): PromptAsset[] {
  return resolvePromptAssetPaths(input)
    .map((asset) => {
      const content = readPromptAsset(asset.relativePath);
      if (!content) return null;
      return { ...asset, content };
    })
    .filter((asset): asset is PromptAsset => Boolean(asset));
}

function compilePromptBlock(
  assets: PromptAsset[],
  matchedSuperpowers: MatchedSuperpower[],
  skillContext: SkillPromptContext,
): string {
  const sections: string[] = [];

  if (assets.length > 0) {
    sections.push(
      'RUNTIME GUIDANCE:',
      ...assets.map((asset) => `[${asset.label}: ${asset.relativePath}]\n${asset.content}`),
    );
  }

  const superpowerBlock = buildSuperpowerPromptBlock(matchedSuperpowers);
  if (superpowerBlock) {
    sections.push(superpowerBlock);
  }

  if (skillContext.promptBlock) {
    sections.push(skillContext.promptBlock);
  }

  const prompt = sections.join('\n\n').trim();
  return prompt.length > 12000 ? `${prompt.slice(0, 12000)}\n\n[prompt guidance truncated]` : prompt;
}

function resolvePromptAssetPaths(input: PromptCompositionInput): Array<{ label: string; relativePath: string }> {
  const toolGroup = input.toolGroup ?? inferFallbackToolGroup(input.message);
  const registry = loadPromptRegistry();
  const orderedPaths: string[] = [];
  const pushUnique = (assetPath?: string) => {
    if (!assetPath || orderedPaths.includes(assetPath)) return;
    orderedPaths.push(assetPath);
  };

  for (const assetPath of registry.defaults?.assets ?? []) pushUnique(assetPath);
  for (const assetPath of registry.profiles[toolGroup]?.assets ?? []) pushUnique(assetPath);

  for (const override of registry.overrides ?? []) {
    const appliesToGroup = !override.toolGroups || override.toolGroups.length === 0 || override.toolGroups.includes(toolGroup);
    if (!appliesToGroup) continue;
    if (!new RegExp(override.pattern, 'i').test(input.message)) continue;
    for (const assetPath of override.assets ?? []) pushUnique(assetPath);
  }

  return orderedPaths.map((relativePath) => ({
    label: inferPromptAssetLabel(relativePath),
    relativePath,
  }));
}

function inferFallbackToolGroup(message: string): ToolGroup {
  const lower = message.toLowerCase();
  if (/\b(browser|website|url|navigate)\b/.test(lower)) return 'browser';
  if (/\b(gui|desktop|window|click)\b/.test(lower)) return 'desktop';
  if (/\b(code|debug|refactor|test|typescript|javascript|python)\b/.test(lower)) return 'coding';
  if (/\b(file|folder|directory|path|shell|command)\b/.test(lower)) return 'core';
  return 'full';
}

function readPromptAsset(relativePath: string): string {
  const rootDir = process.env.CLAWDIA_PROMPT_ROOT || process.cwd();
  const absolutePath = path.resolve(rootDir, relativePath);

  if (fileCache.has(absolutePath)) {
    return fileCache.get(absolutePath)!;
  }

  if (!fs.existsSync(absolutePath)) {
    return '';
  }

  const content = fs.readFileSync(absolutePath, 'utf8').trim();
  fileCache.set(absolutePath, content);
  return content;
}

function loadPromptRegistry(): PromptRegistry {
  if (registryCache) return registryCache;

  const rootDir = process.env.CLAWDIA_PROMPT_ROOT || process.cwd();
  const registryPath = process.env.CLAWDIA_PROMPT_REGISTRY
    || path.resolve(rootDir, 'system/registry/prompt-registry.json');
  const raw = fs.readFileSync(registryPath, 'utf8');
  registryCache = JSON.parse(raw) as PromptRegistry;
  return registryCache;
}

function inferPromptAssetLabel(relativePath: string): string {
  if (relativePath.includes('/context')) return 'Context';
  if (relativePath.includes('/tasks/')) return 'Task';
  if (relativePath.includes('/contracts/')) return 'Contract';
  if (relativePath.includes('/domains/')) return 'Domain';
  return 'Guidance';
}

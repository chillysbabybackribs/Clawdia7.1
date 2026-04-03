// src/main/skills/promptComposition.ts
// Minimal stub — the full skill/superpower system was removed.
// This provides the interface that agentLoop, promptAssembler, and recovery still expect.

import * as fs from 'fs';
import * as path from 'path';

export interface PromptCompositionInput {
  message: string;
  toolGroup: string;
  executor?: string;
  provider?: string;
  modelTier?: string;
}

export interface PromptCompositionResult {
  promptBlock: string;
}

/**
 * Build a prompt composition block for the given input.
 * Previously this loaded superpowers, skills, and domain files.
 * Now returns an empty block — the static prompt in promptBuilder.ts
 * already contains all necessary guidance per tool group.
 */
export function buildPromptComposition(_input: PromptCompositionInput): PromptCompositionResult {
  return { promptBlock: '' };
}

/**
 * Load a recovery playbook markdown file by key.
 * Falls back to null if the file doesn't exist.
 */
export function loadRecoveryPlaybook(key: string): string | null {
  const filePath = path.join(process.cwd(), 'system', 'recovery', `${key.replace(/_/g, '-')}.md`);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

import type { ToolCallRecord, ToolUseBlock } from './types';
import { loadRecoveryPlaybook } from '../skills/promptComposition';

export type RecoveryKey =
  | 'browser_blocked'
  | 'element_not_found'
  | 'navigation_timeout'
  | 'stall_detected';

export function detectRecoveryFromTurn(toolBlocks: ToolUseBlock[], results: string[]): RecoveryKey | null {
  for (let i = 0; i < toolBlocks.length; i++) {
    const name = toolBlocks[i].name;
    const result = results[i] ?? '';
    const lower = result.toLowerCase();

    if (name === 'browser_navigate' && /\b(timeout|timed out|navigation failed|err_|dns|unreachable)\b/.test(lower)) {
      return 'navigation_timeout';
    }

    if (
      /\b(login|sign in|required to continue|verify you are human|captcha|too many requests|rate limit|paywall|permission denied|access denied)\b/.test(lower)
    ) {
      return 'browser_blocked';
    }

    if (
      /\b(element not found|no element found|no elements found|selector.*not found|could not find element|target.*missing)\b/.test(lower)
    ) {
      return 'element_not_found';
    }
  }

  return null;
}

export function detectStall(allToolCalls: ToolCallRecord[]): RecoveryKey | null {
  if (allToolCalls.length < 3) return null;
  const recent = allToolCalls.slice(-3);
  const sameTool = recent.every((call) => call.name === recent[0].name);
  const normalizedResults = recent.map((call) => normalizeResult(call.result));
  const sameResult = normalizedResults.every((result) => result === normalizedResults[0]);
  return sameTool && sameResult ? 'stall_detected' : null;
}

export function buildRecoveryGuidanceMessage(key: RecoveryKey): string {
  const playbook = loadRecoveryPlaybook(key);
  return playbook ? `[RECOVERY PLAYBOOK: ${key}]\n${playbook}` : `[RECOVERY PLAYBOOK: ${key}]`;
}

function normalizeResult(result: string): string {
  return result.trim().toLowerCase().slice(0, 240);
}

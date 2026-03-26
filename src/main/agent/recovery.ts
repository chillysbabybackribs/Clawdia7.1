// src/main/agent/recovery.ts
import type { ToolCallRecord, VerificationResult } from './types';

const CLAIMED_WRITE_PATTERNS = [
  /(?:written|saved|created|wrote|stored)\b[^.]*?(?:to|at|as)\s+['"`]?([^\s'"`.,]+\.[a-z]{1,6})['"`]?/gi,
  /(?:file|output)\s+(?:has\s+been\s+)?(?:written|saved|created)\s+(?:to\s+|at\s+)?['"`]?([^\s'"`.,]+\.[a-z]{1,6})['"`]?/gi,
];

const WRITE_TOOL_NAMES = new Set(['file_edit', 'str_replace_based_edit_tool']);

function extractClaimedWrites(text: string): string[] {
  const claimed: string[] = [];
  for (const pattern of CLAIMED_WRITE_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const fname = m[1];
      if (fname && !fname.startsWith('http')) {
        claimed.push(fname);
      }
    }
  }
  return [...new Set(claimed)];
}

export function verifyOutcomes(
  finalText: string,
  allToolCalls: ToolCallRecord[],
): VerificationResult | null {
  const claimedWrites = extractClaimedWrites(finalText);
  if (claimedWrites.length === 0) return null;

  const actualWrites = allToolCalls
    .filter(c => WRITE_TOOL_NAMES.has(c.name) && (c.input.command === 'create' || c.input.command === 'str_replace'))
    .map(c => c.input.path as string);

  for (const claimed of claimedWrites) {
    const matched = actualWrites.some(w => w === claimed || w.endsWith(`/${claimed}`) || w.endsWith(claimed));
    if (!matched) {
      return {
        issue: `Response claimed to write "${claimed}" but no matching file_edit tool call was found.`,
        context: `Actual writes: ${actualWrites.join(', ') || 'none'}`,
      };
    }
  }

  return null;
}

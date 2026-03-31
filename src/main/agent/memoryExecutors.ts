// src/main/agent/memoryExecutors.ts
// Executor functions for the three memory tools.
// Called from agentLoop.ts dispatch when the agent uses a memory tool.

import { remember, forget, searchMemory } from '../db/memory';
import type { MemoryEntry } from '../db/memory';

export function executeMemoryStore(input: Record<string, unknown>): string {
  const category = input.category as string;
  const key = input.key as string;
  const value = input.value as string;
  const source = (input.source as 'user' | 'agent') ?? 'agent';

  const err = remember(category, key, value, source);
  if (err) {
    return JSON.stringify({ ok: false, error: err });
  }
  return JSON.stringify({ ok: true, stored: { category, key, value, source } });
}

export function executeMemorySearch(input: Record<string, unknown>): string {
  const query = input.query as string;
  const limit = typeof input.limit === 'number' ? input.limit : 5;

  const results: MemoryEntry[] = searchMemory(query, limit);
  if (results.length === 0) {
    return JSON.stringify({ ok: true, results: [], message: 'No matching facts found.' });
  }
  return JSON.stringify({
    ok: true,
    results: results.map(r => ({
      category: r.category,
      key: r.key,
      value: r.value,
      source: r.source,
      confidence: r.confidence,
    })),
  });
}

export function executeMemoryForget(input: Record<string, unknown>): string {
  const key = input.key as string;
  const category = input.category as string | undefined;

  forget(key, category);
  return JSON.stringify({ ok: true, deleted: { key, category: category ?? 'all categories' } });
}

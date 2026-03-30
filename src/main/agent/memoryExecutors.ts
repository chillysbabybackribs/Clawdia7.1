// src/main/agent/memoryExecutors.ts
// Executor functions for the three memory tools.
// Called from anthropicChat.ts executeTools() when the agent uses a memory tool.

import { remember, forget, searchMemory } from '../db/memory';
import type { MemoryEntry } from '../db/memory';

export function executeMemoryStore(input: Record<string, unknown>): string {
  const category = String(input.category ?? '').trim();
  const key = String(input.key ?? '').trim();
  const value = String(input.value ?? '').trim();
  const source = (input.source as 'user' | 'agent') ?? 'agent';

  if (!category) return JSON.stringify({ ok: false, error: 'category is required.' });
  if (!key) return JSON.stringify({ ok: false, error: 'key is required.' });
  if (!value) return JSON.stringify({ ok: false, error: 'value is required.' });

  const err = remember(category, key, value, source);
  if (err) {
    return JSON.stringify({ ok: false, error: err });
  }
  return JSON.stringify({ ok: true, stored: { category, key, value, source } });
}

export function executeMemorySearch(input: Record<string, unknown>): string {
  const query = String(input.query ?? '').trim();
  if (!query) return JSON.stringify({ ok: false, error: 'query is required.' });
  const limit = Math.min(Math.max(typeof input.limit === 'number' ? input.limit : 5, 1), 100);

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

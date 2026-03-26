// tests/main/agent/memoryExecutors.test.ts
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const testDbPath = path.join(os.tmpdir(), `clawdia-exec-test-${Date.now()}.sqlite`);
process.env.CLAWDIA_DB_PATH_OVERRIDE = testDbPath;

import { initDb } from '../../../src/main/db';
import {
  executeMemoryStore,
  executeMemorySearch,
  executeMemoryForget,
} from '../../../src/main/agent/memoryExecutors';

beforeEach(() => {
  initDb();
});

afterEach(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
});

afterAll(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
});

describe('executeMemoryStore', () => {
  it('stores a valid fact and returns ok:true', () => {
    const result = JSON.parse(
      executeMemoryStore({ category: 'preference', key: 'preferred_editor', value: 'VS Code', source: 'user' })
    );
    expect(result.ok).toBe(true);
    expect(result.stored.key).toBe('preferred_editor');
  });

  it('returns ok:false for invalid category', () => {
    const result = JSON.parse(
      executeMemoryStore({ category: 'bad_cat', key: 'key', value: 'value', source: 'agent' })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid category');
  });

  it('returns ok:false for secret-looking value', () => {
    const result = JSON.parse(
      executeMemoryStore({ category: 'fact', key: 'key', value: 'sk-abcdefghijklmnop', source: 'agent' })
    );
    expect(result.ok).toBe(false);
  });
});

describe('executeMemorySearch', () => {
  it('returns matching facts', () => {
    executeMemoryStore({ category: 'preference', key: 'preferred_editor', value: 'VS Code with vim', source: 'user' });
    const result = JSON.parse(executeMemorySearch({ query: 'editor vim' }));
    expect(result.ok).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].key).toBe('preferred_editor');
  });

  it('returns empty results with message when no match', () => {
    const result = JSON.parse(executeMemorySearch({ query: 'zzznomatch' }));
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(0);
    expect(result.message).toBeDefined();
  });
});

describe('executeMemoryForget', () => {
  it('deletes a fact and confirms deletion', () => {
    executeMemoryStore({ category: 'fact', key: 'city', value: 'London', source: 'agent' });
    const result = JSON.parse(executeMemoryForget({ key: 'city' }));
    expect(result.ok).toBe(true);
    const search = JSON.parse(executeMemorySearch({ query: 'city London' }));
    expect(search.results).toHaveLength(0);
  });

  it('scoped delete by category only removes matching category', () => {
    executeMemoryStore({ category: 'fact', key: 'name', value: 'Alice', source: 'agent' });
    executeMemoryStore({ category: 'account', key: 'name', value: 'alice_handle', source: 'agent' });
    executeMemoryForget({ key: 'name', category: 'fact' });
    const result = JSON.parse(executeMemorySearch({ query: 'alice' }));
    expect(result.results.some((r: { category: string }) => r.category === 'account')).toBe(true);
    expect(result.results.some((r: { category: string }) => r.category === 'fact')).toBe(false);
  });
});

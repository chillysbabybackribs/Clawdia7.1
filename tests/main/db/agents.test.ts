// tests/main/db/agents.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initDb } from '../../../src/main/db';
import {
  createAgent,
  getAgent,
  listAgents,
  updateAgent,
  deleteAgent,
} from '../../../src/main/db/agents';
import type { AgentDefinition } from '../../../src/shared/types';

const TEST_DB = path.join(os.tmpdir(), `agents-test-${Date.now()}.sqlite`);

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Agent',
    description: 'A test agent',
    agentType: 'general',
    status: 'draft',
    goal: 'Do something useful',
    resourceScope: {},
    operationMode: 'read_only',
    mutationPolicy: 'no_mutation',
    approvalPolicy: 'always_ask',
    launchModes: ['manual'],
    defaultLaunchMode: 'manual',
    config: {},
    outputMode: 'chat_message',
    lastTestStatus: 'untested',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  process.env.CLAWDIA_DB_PATH_OVERRIDE = TEST_DB;
  initDb();
});

afterEach(() => {
  delete process.env.CLAWDIA_DB_PATH_OVERRIDE;
  try { fs.unlinkSync(TEST_DB); } catch {}
});

describe('createAgent + getAgent', () => {
  it('creates an agent and retrieves it by id', () => {
    const agent = makeAgent({ id: 'a1', name: 'My Agent' });
    createAgent(agent);
    const retrieved = getAgent('a1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('a1');
    expect(retrieved!.name).toBe('My Agent');
    expect(retrieved!.goal).toBe('Do something useful');
  });

  it('returns null for unknown id', () => {
    expect(getAgent('nonexistent')).toBeNull();
  });

  it('preserves nested fields in definition_json', () => {
    const agent = makeAgent({
      id: 'a2',
      resourceScope: { browserDomains: ['example.com'] },
      config: { sourceMode: 'current_page', sources: [] },
    });
    createAgent(agent);
    const retrieved = getAgent('a2');
    expect(retrieved!.resourceScope.browserDomains).toEqual(['example.com']);
    expect((retrieved!.config as any).sourceMode).toBe('current_page');
  });
});

describe('listAgents', () => {
  it('returns empty array when no agents exist', () => {
    expect(listAgents()).toEqual([]);
  });

  it('returns all agents sorted by updated_at DESC', () => {
    const a1 = makeAgent({ id: 'a1', name: 'First', updatedAt: '2024-01-01T00:00:00.000Z' });
    const a2 = makeAgent({ id: 'a2', name: 'Second', updatedAt: '2024-06-01T00:00:00.000Z' });
    createAgent(a1);
    createAgent(a2);
    const list = listAgents();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('a2');
    expect(list[1].id).toBe('a1');
  });
});

describe('updateAgent', () => {
  it('updates name and status', () => {
    const agent = makeAgent({ id: 'a1' });
    createAgent(agent);
    updateAgent('a1', { name: 'Updated Name', status: 'ready' });
    const retrieved = getAgent('a1');
    expect(retrieved!.name).toBe('Updated Name');
    expect(retrieved!.status).toBe('ready');
  });

  it('updates nested fields via definition merge', () => {
    const agent = makeAgent({ id: 'a1', goal: 'original' });
    createAgent(agent);
    updateAgent('a1', { goal: 'updated goal' });
    const retrieved = getAgent('a1');
    expect(retrieved!.goal).toBe('updated goal');
  });
});

describe('deleteAgent', () => {
  it('removes the agent', () => {
    const agent = makeAgent({ id: 'a1' });
    createAgent(agent);
    deleteAgent('a1');
    expect(getAgent('a1')).toBeNull();
  });

  it('is a no-op for nonexistent id', () => {
    expect(() => deleteAgent('nonexistent')).not.toThrow();
  });
});

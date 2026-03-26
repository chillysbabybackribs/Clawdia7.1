import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// We test db.ts by pointing it at a temp file
process.env.CLAWDIA_DB_PATH_OVERRIDE = path.join(os.tmpdir(), `clawdia-test-${Date.now()}.sqlite`);

import {
  initDb,
  createConversation,
  listConversations,
  getConversation,
  updateConversation,
  deleteConversation,
  addMessage,
  getMessages,
  createRun,
  updateRun,
  getRuns,
  appendRunEvent,
  getRunEvents,
  getDb,
} from '../../src/main/db';

const testDbPath = process.env.CLAWDIA_DB_PATH_OVERRIDE!;

beforeEach(() => {
  initDb();
});

afterEach(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
});

describe('conversations', () => {
  it('creates and lists a conversation', () => {
    createConversation({ id: 'c1', title: 'Hello', mode: 'chat', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z' });
    const list = listConversations();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('c1');
    expect(list[0].title).toBe('Hello');
  });

  it('returns conversations sorted by updated_at desc', () => {
    createConversation({ id: 'c1', title: 'First', mode: 'chat', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z' });
    createConversation({ id: 'c2', title: 'Second', mode: 'chat', created_at: '2024-02-01T00:00:00.000Z', updated_at: '2024-02-01T00:00:00.000Z' });
    const list = listConversations();
    expect(list[0].id).toBe('c2');
    expect(list[1].id).toBe('c1');
  });

  it('gets a single conversation', () => {
    createConversation({ id: 'c1', title: 'Hello', mode: 'chat', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z' });
    const conv = getConversation('c1');
    expect(conv).not.toBeNull();
    expect(conv!.title).toBe('Hello');
  });

  it('returns null for missing conversation', () => {
    expect(getConversation('nonexistent')).toBeNull();
  });

  it('updates a conversation', () => {
    createConversation({ id: 'c1', title: 'Old', mode: 'chat', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z' });
    updateConversation('c1', { title: 'New', updated_at: '2024-06-01T00:00:00.000Z' });
    const conv = getConversation('c1');
    expect(conv!.title).toBe('New');
    expect(conv!.updated_at).toBe('2024-06-01T00:00:00.000Z');
  });

  it('deletes a conversation and cascades to messages', () => {
    createConversation({ id: 'c1', title: 'Hello', mode: 'chat', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z' });
    addMessage({ id: 'm1', conversation_id: 'c1', role: 'user', content: JSON.stringify({ content: 'hi' }), created_at: '2024-01-01T00:00:01.000Z' });
    deleteConversation('c1');
    expect(listConversations()).toHaveLength(0);
    expect(getMessages('c1')).toHaveLength(0);
  });
});

describe('messages', () => {
  beforeEach(() => {
    createConversation({ id: 'c1', title: 'Test', mode: 'chat', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z' });
  });

  it('adds and retrieves messages in order', () => {
    addMessage({ id: 'm1', conversation_id: 'c1', role: 'user', content: JSON.stringify({ content: 'hello' }), created_at: '2024-01-01T00:00:01.000Z' });
    addMessage({ id: 'm2', conversation_id: 'c1', role: 'assistant', content: JSON.stringify({ content: 'hi there' }), created_at: '2024-01-01T00:00:02.000Z' });
    const msgs = getMessages('c1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe('m1');
    expect(msgs[1].id).toBe('m2');
  });

  it('returns empty array for conversation with no messages', () => {
    expect(getMessages('c1')).toHaveLength(0);
  });
});

describe('runs', () => {
  beforeEach(() => {
    createConversation({ id: 'c1', title: 'Test', mode: 'chat', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z' });
  });

  it('creates and retrieves a run', () => {
    createRun({ id: 'r1', conversation_id: 'c1', title: 'Test Run', goal: 'Test goal', status: 'running', started_at: '2024-01-01T00:02:00.000Z', updated_at: '2024-01-01T00:02:00.000Z', tool_call_count: 0, was_detached: 0, workflow_stage: 'executing', provider: 'anthropic', model: 'claude-sonnet-4-6' });
    const runs = getRuns('c1');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('running');
  });

  it('updates run status and completion fields', () => {
    createRun({ id: 'r1', conversation_id: 'c1', title: 'Test Run', goal: 'Test goal', status: 'running', started_at: '2024-01-01T00:02:00.000Z', updated_at: '2024-01-01T00:02:00.000Z', tool_call_count: 0, was_detached: 0, workflow_stage: 'executing', provider: 'anthropic', model: 'claude-sonnet-4-6' });
    updateRun('r1', { status: 'completed', completed_at: '2024-01-01T00:03:00.000Z', total_tokens: 500, estimated_cost_usd: 0.005 });
    const runs = getRuns('c1');
    expect(runs[0].status).toBe('completed');
    expect(runs[0].total_tokens).toBe(500);
  });

  it('run can have a parent_run_id', () => {
    const now = new Date().toISOString();
    const parentId = `run-parent-${Date.now()}`;
    const childId = `run-child-${Date.now()}`;
    createRun({ id: parentId, conversation_id: 'c1', title: 'p', goal: 'p', status: 'running', started_at: now, updated_at: now, tool_call_count: 0, was_detached: 0, workflow_stage: 'orchestrating' });
    createRun({ id: childId, conversation_id: 'c1', title: 'c', goal: 'c', status: 'running', started_at: now, updated_at: now, tool_call_count: 0, was_detached: 0, workflow_stage: 'executing', parent_run_id: parentId });
    const db = getDb();
    const row = db.prepare('SELECT parent_run_id FROM runs WHERE id=?').get(childId) as any;
    expect(row.parent_run_id).toBe(parentId);
  });
});

describe('run_events', () => {
  beforeEach(() => {
    createConversation({ id: 'c1', title: 'Test', mode: 'chat', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z' });
    createRun({ id: 'r1', conversation_id: 'c1', title: 'Test Run', goal: 'Test goal', status: 'running', started_at: '2024-01-01T00:02:00.000Z', updated_at: '2024-01-01T00:02:00.000Z', tool_call_count: 0, was_detached: 0, workflow_stage: 'executing', provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it('appends and retrieves run events in order', () => {
    appendRunEvent({ run_id: 'r1', seq: 1, ts: '2024-01-01T00:02:01.000Z', kind: 'tool_call', payload_json: JSON.stringify({ tool: 'bash', args: 'ls' }) });
    appendRunEvent({ run_id: 'r1', seq: 2, ts: '2024-01-01T00:02:02.000Z', kind: 'tool_result', payload_json: JSON.stringify({ result: 'file.txt', duration_ms: 120 }) });
    const events = getRunEvents('r1');
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe('tool_call');
    expect(events[1].kind).toBe('tool_result');
  });
});

describe('orphaned run cleanup', () => {
  it('marks running runs as failed on initDb', () => {
    createConversation({ id: 'c1', title: 'Test', mode: 'chat', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z' });
    createRun({ id: 'r1', conversation_id: 'c1', title: 'Test Run', goal: 'Test goal', status: 'running', started_at: '2024-01-01T00:01:00.000Z', updated_at: '2024-01-01T00:01:00.000Z', tool_call_count: 0, was_detached: 0, workflow_stage: 'executing', provider: 'anthropic', model: 'claude-sonnet-4-6' });
    // Simulate re-init (app restart)
    initDb();
    const runs = getRuns('c1');
    expect(runs[0].status).toBe('failed');
  });
});

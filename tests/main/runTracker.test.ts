import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

process.env.CLAWDIA_DB_PATH_OVERRIDE = path.join(os.tmpdir(), `clawdia-tracker-test-${Date.now()}.sqlite`);

import { initDb, getRuns, getRunEvents, createConversation } from '../../src/main/db';
import { startRun, trackToolCall, trackToolResult, completeRun, failRun } from '../../src/main/runTracker';

const testDbPath = process.env.CLAWDIA_DB_PATH_OVERRIDE!;

beforeEach(() => {
  initDb();
  createConversation({ id: 'c1', title: 'Test', mode: 'chat', created_at: 1000, updated_at: 1000 });
});

afterEach(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
});

describe('runTracker', () => {
  it('startRun creates a run with status running', () => {
    const runId = startRun('c1', 'anthropic', 'claude-sonnet-4-6');
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);
    const runs = getRuns('c1');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('running');
    expect(runs[0].provider).toBe('anthropic');
    expect(runs[0].model).toBe('claude-sonnet-4-6');
  });

  it('trackToolCall appends a tool_call event', () => {
    const runId = startRun('c1', 'anthropic', 'claude-sonnet-4-6');
    const eventId = trackToolCall(runId, 'bash', 'ls -la');
    expect(typeof eventId).toBe('string');
    const events = getRunEvents(runId);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('tool_call');
    const payload = JSON.parse(events[0].payload_json);
    expect(payload.toolName).toBe('bash');
    expect(payload.argsSummary).toBe('ls -la');
  });

  it('trackToolResult appends a tool_result event', () => {
    const runId = startRun('c1', 'anthropic', 'claude-sonnet-4-6');
    const eventId = trackToolCall(runId, 'bash', 'ls');
    trackToolResult(runId, eventId, 'file.txt', 45);
    const events = getRunEvents(runId);
    expect(events).toHaveLength(2);
    expect(events[1].kind).toBe('tool_result');
    const payload = JSON.parse(events[1].payload_json);
    expect(payload.duration_ms).toBe(45);
    expect(payload.resultSummary).toBe('file.txt');
  });

  it('completeRun updates status, tokens, cost', () => {
    const runId = startRun('c1', 'anthropic', 'claude-sonnet-4-6');
    completeRun(runId, 1200, 0.012);
    const runs = getRuns('c1');
    expect(runs[0].status).toBe('completed');
    expect(runs[0].total_tokens).toBe(1200);
    expect(runs[0].estimated_cost_usd).toBeCloseTo(0.012);
    expect(runs[0].completed_at).toBeTruthy();
    expect(typeof runs[0].completed_at).toBe('string');
  });

  it('failRun updates status to failed', () => {
    const runId = startRun('c1', 'anthropic', 'claude-sonnet-4-6');
    failRun(runId, 'API timeout');
    const runs = getRuns('c1');
    expect(runs[0].status).toBe('failed');
    expect(runs[0].completed_at).toBeTruthy();
    expect(typeof runs[0].completed_at).toBe('string');
  });
});

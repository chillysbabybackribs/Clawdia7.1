import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const testDbPath = path.join(os.tmpdir(), `clawdia-session-continuity-test-${Date.now()}.sqlite`);
process.env.CLAWDIA_DB_PATH_OVERRIDE = testDbPath;

import { createConversation, initDb } from '../../src/main/db';
import {
  dismissSessionContinuitySuggestion,
  formatSessionRecallBlock,
  peekLatestSessionContinuity,
  recallLatestSessionContinuity,
  recordAssistantOutcome,
  recordBrowserNavigation,
  recordUIStateObservation,
  recordUserIntent,
  shouldTriggerSessionRecall,
} from '../../src/main/sessionContinuity';

beforeEach(() => {
  initDb();
});

afterEach(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
});

afterAll(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
});

describe('session continuity', () => {
  it('peeks and recalls the latest prior session', () => {
    createConversation({
      id: 'conv-1',
      title: 'Refactor runtime',
      mode: 'chat',
      created_at: '2026-04-03T10:00:00.000Z',
      updated_at: '2026-04-03T10:00:00.000Z',
    });
    recordUserIntent('conv-1', 'Refactor the runtime and add lazy session recall');
    recordAssistantOutcome('conv-1', 'Added the continuity store and wired shared chat integration.');

    const peek = peekLatestSessionContinuity('conv-2');
    expect(peek.hasPriorSession).toBe(true);
    expect(peek.sessionId).toBe('conv-1');

    const recall = recallLatestSessionContinuity('conv-2');
    expect(recall).not.toBeNull();
    expect(recall?.objective).toContain('Refactor the runtime');
    expect(recall?.lastCompletedStep).toContain('continuity store');
  });

  it('formats a compact recall block', () => {
    createConversation({
      id: 'conv-1',
      title: 'Stripe export bug',
      mode: 'chat',
      created_at: '2026-04-03T10:00:00.000Z',
      updated_at: '2026-04-03T10:00:00.000Z',
    });
    recordUserIntent('conv-1', 'Continue debugging the Stripe export mismatch');
    recordAssistantOutcome('conv-1', 'Traced the mismatch to a customer filter mapping bug.');

    const recall = recallLatestSessionContinuity('conv-2');
    expect(recall).not.toBeNull();
    const block = formatSessionRecallBlock(recall!);
    expect(block).toContain('[Relevant prior session context]');
    expect(block).toContain('Objective: Continue debugging the Stripe export mismatch');
    expect(block).toContain('Last completed step: Traced the mismatch');
  });

  it('captures browser and ui continuity events for the active conversation', () => {
    createConversation({
      id: 'conv-1',
      title: 'Dashboard audit',
      mode: 'chat',
      created_at: '2026-04-03T10:00:00.000Z',
      updated_at: '2026-04-03T10:00:00.000Z',
    });
    recordUserIntent('conv-1', 'Audit the billing dashboard');
    recordBrowserNavigation('conv-1', 'https://example.com/billing', 'Billing');
    recordUIStateObservation('conv-1', {
      activeView: 'chat',
      activeRightPanel: 'browser',
      browserVisible: true,
      browserUrl: 'https://example.com/billing',
      provider: 'anthropic',
      model: 'claude-sonnet',
    });

    const recall = recallLatestSessionContinuity('conv-2');
    expect(recall).not.toBeNull();
    expect(recall?.supportingFacts.some((fact) => fact.includes('browser_navigate'))).toBe(true);
    expect(recall?.supportingFacts.some((fact) => fact.includes('ui_state_observed'))).toBe(true);
  });

  it('hides dismissed sessions from passive peek without blocking explicit recall', () => {
    createConversation({
      id: 'conv-1',
      title: 'Old task',
      mode: 'chat',
      created_at: '2026-04-03T10:00:00.000Z',
      updated_at: '2026-04-03T10:00:00.000Z',
    });
    recordUserIntent('conv-1', 'Resume the old task');
    dismissSessionContinuitySuggestion('conv-1');

    const peek = peekLatestSessionContinuity('conv-2');
    expect(peek.hasPriorSession).toBe(false);

    const recall = recallLatestSessionContinuity('conv-2');
    expect(recall?.sessionId).toBe('conv-1');
  });

  it('detects explicit continuity triggers', () => {
    expect(shouldTriggerSessionRecall('what were we just working on?')).toBe(true);
    expect(shouldTriggerSessionRecall('continue')).toBe(true);
    expect(shouldTriggerSessionRecall('resume that')).toBe(true);
    expect(shouldTriggerSessionRecall('build a new login form')).toBe(false);
  });
});

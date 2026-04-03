import { describe, expect, it } from 'vitest';
import { scoreSessionCandidate } from '../../src/main/sessionContinuityRanker';

describe('session continuity ranking', () => {
  it('prefers matching browser surfaces over newer conversation-only sessions', () => {
    const browserScore = scoreSessionCandidate({
      session_id: 's-browser',
      conversation_id: 'c-browser',
      workspace_id: '/tmp/ws',
      surface: 'browser',
      title: 'Browser task',
      objective: 'Audit the billing dashboard',
      last_user_intent: 'Inspect Stripe settings',
      last_completed_step: 'Opened the dashboard',
      next_step: null,
      confidence: 0.8,
      needs_confirmation: 0,
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    }, 'browser');

    const conversationScore = scoreSessionCandidate({
      session_id: 's-conversation',
      conversation_id: 'c-conversation',
      workspace_id: '/tmp/ws',
      surface: 'conversation',
      title: 'Chat task',
      objective: 'Discuss a refactor',
      last_user_intent: 'Think about architecture',
      last_completed_step: 'Outlined the tradeoffs',
      next_step: null,
      confidence: 0.95,
      needs_confirmation: 0,
      updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    }, 'browser');

    expect(browserScore).toBeGreaterThan(conversationScore);
  });
});

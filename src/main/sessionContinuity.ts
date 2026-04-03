import { getConversation, getDb, type SessionEventRow, type SessionIndexRow } from './db';
import { getUIState } from './core/cli/uiStateAccessor';
import { scoreSessionCandidate, type SessionSurface } from './sessionContinuityRanker';

export interface SessionContinuityPeek {
  hasPriorSession: boolean;
  sessionId: string | null;
  updatedAt: string | null;
  surface: string | null;
  workspaceMatch: boolean;
  confidence: number;
  title: string | null;
}

export interface SessionRecallResult {
  sessionId: string;
  conversationId: string | null;
  title: string | null;
  objective: string | null;
  lastUserIntent: string | null;
  lastCompletedStep: string | null;
  nextStep: string | null;
  updatedAt: string;
  confidence: number;
  supportingFacts: string[];
}

type SessionSummaryUpdate = {
  sessionId: string;
  conversationId?: string | null;
  workspaceId?: string;
  surface?: string;
  title?: string | null;
  objective?: string | null;
  lastUserIntent?: string | null;
  lastCompletedStep?: string | null;
  nextStep?: string | null;
  confidence?: number;
  needsConfirmation?: boolean;
  updatedAt?: string;
};

type SessionEventInput = {
  sessionId: string;
  conversationId?: string | null;
  kind: string;
  surface?: string;
  payload?: Record<string, unknown>;
  ts?: string;
};

type UIStateSnapshot = {
  activeView: string;
  activeRightPanel: string | null;
  browserVisible: boolean;
  browserUrl: string | null;
  provider: string;
  model: string;
};

const EXPLICIT_RECALL_PATTERNS = [
  /\bwhat were we (just )?(working on|doing)\b/i,
  /\bwhere did we leave off\b/i,
  /\b(last|previous) (task|session|thing)\b/i,
  /\bpick (this|that)? ?back up\b/i,
  /\bresume\b/i,
  /\bcontinue\b/i,
  /\bcarry on\b/i,
  /\bkeep going\b/i,
];

const AMBIGUOUS_RECALL_PATTERNS = [
  /^(that|it|this)\b/i,
  /\bcontinue with (that|it|this)\b/i,
  /\bback to (that|it|this)\b/i,
];

function nowIso(): string {
  return new Date().toISOString();
}

function workspaceId(): string {
  return process.cwd();
}

function normalizeText(text: string | null | undefined, maxLen = 280): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen - 1)}…` : normalized;
}

function currentSurfacePreference(): SessionSurface {
  const ui = getUIState();
  if (!ui) return 'conversation';
  if (ui.browserVisible || ui.activeRightPanel === 'browser' || ui.browserUrl) return 'browser';
  return 'conversation';
}

function bestSessionRow(
  excludeConversationId?: string | null,
  options?: { filterDismissed?: boolean },
): SessionIndexRow | null {
  const db = getDb();
  const dismissedFilter = options?.filterDismissed
    ? `AND NOT EXISTS (
         SELECT 1
         FROM session_dismissals sd
         WHERE sd.workspace_id = session_index.workspace_id
           AND sd.session_id = session_index.session_id
           AND sd.dismissed_at >= session_index.updated_at
       )`
    : '';
  const rows = excludeConversationId
    ? db.prepare(
      `SELECT * FROM session_index
       WHERE workspace_id = ?
         AND (conversation_id IS NULL OR conversation_id != ?)
         ${dismissedFilter}
       ORDER BY updated_at DESC
       LIMIT 8`
    ).all(workspaceId(), excludeConversationId)
    : db.prepare(
      `SELECT * FROM session_index
       WHERE workspace_id = ?
         ${dismissedFilter}
       ORDER BY updated_at DESC
       LIMIT 8`
    ).all(workspaceId());
  const candidates = (rows as SessionIndexRow[]) ?? [];
  if (candidates.length === 0) return null;
  const preferredSurface = currentSurfacePreference();
  return candidates
    .map((row) => ({ row, score: scoreSessionCandidate(row, preferredSurface) }))
    .sort((a, b) => b.score - a.score)
    [0]?.row ?? null;
}

function getRecentSessionEvents(sessionId: string, limit = 4): SessionEventRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM session_events
       WHERE session_id = ?
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(sessionId, limit) as SessionEventRow[];
}

export function shouldTriggerSessionRecall(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return [...EXPLICIT_RECALL_PATTERNS, ...AMBIGUOUS_RECALL_PATTERNS].some((pattern) => pattern.test(trimmed));
}

export function upsertSessionSummary(update: SessionSummaryUpdate): void {
  const db = getDb();
  const current = db.prepare(`SELECT * FROM session_index WHERE session_id = ?`).get(update.sessionId) as SessionIndexRow | undefined;
  const conversation = update.conversationId ? getConversation(update.conversationId) : null;

  const row: SessionIndexRow = {
    session_id: update.sessionId,
    conversation_id: update.conversationId ?? current?.conversation_id ?? null,
    workspace_id: update.workspaceId ?? current?.workspace_id ?? workspaceId(),
    surface: update.surface ?? current?.surface ?? 'conversation',
    title: update.title ?? current?.title ?? conversation?.title ?? null,
    objective: normalizeText(update.objective ?? current?.objective ?? null),
    last_user_intent: normalizeText(update.lastUserIntent ?? current?.last_user_intent ?? null),
    last_completed_step: normalizeText(update.lastCompletedStep ?? current?.last_completed_step ?? null),
    next_step: normalizeText(update.nextStep ?? current?.next_step ?? null),
    confidence: update.confidence ?? current?.confidence ?? 0.5,
    needs_confirmation: update.needsConfirmation == null
      ? current?.needs_confirmation ?? 0
      : (update.needsConfirmation ? 1 : 0),
    updated_at: update.updatedAt ?? nowIso(),
  };

  db.prepare(
    `INSERT INTO session_index (
      session_id, conversation_id, workspace_id, surface, title, objective,
      last_user_intent, last_completed_step, next_step, confidence,
      needs_confirmation, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      conversation_id = excluded.conversation_id,
      workspace_id = excluded.workspace_id,
      surface = excluded.surface,
      title = excluded.title,
      objective = excluded.objective,
      last_user_intent = excluded.last_user_intent,
      last_completed_step = excluded.last_completed_step,
      next_step = excluded.next_step,
      confidence = excluded.confidence,
      needs_confirmation = excluded.needs_confirmation,
      updated_at = excluded.updated_at`
  ).run(
    row.session_id,
    row.conversation_id ?? null,
    row.workspace_id,
    row.surface,
    row.title ?? null,
    row.objective ?? null,
    row.last_user_intent ?? null,
    row.last_completed_step ?? null,
    row.next_step ?? null,
    row.confidence,
    row.needs_confirmation,
    row.updated_at,
  );
}

export function appendSessionEvent(input: SessionEventInput): void {
  getDb()
    .prepare(
      `INSERT INTO session_events (
        session_id, conversation_id, ts, kind, surface, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.sessionId,
      input.conversationId ?? null,
      input.ts ?? nowIso(),
      input.kind,
      input.surface ?? 'conversation',
      JSON.stringify(input.payload ?? {}),
    );
}

export function recordUserIntent(conversationId: string, text: string): void {
  const conv = getConversation(conversationId);
  const objective = normalizeText(text);
  upsertSessionSummary({
    sessionId: conversationId,
    conversationId,
    title: conv?.title ?? null,
    objective,
    lastUserIntent: objective,
    confidence: 0.9,
    needsConfirmation: false,
  });
  appendSessionEvent({
    sessionId: conversationId,
    conversationId,
    kind: 'user_goal_set',
    payload: { text: objective },
  });
}

export function recordAssistantOutcome(conversationId: string, text: string): void {
  const outcome = normalizeText(text);
  if (!outcome) return;
  upsertSessionSummary({
    sessionId: conversationId,
    conversationId,
    lastCompletedStep: outcome,
    confidence: 0.92,
    needsConfirmation: false,
  });
  appendSessionEvent({
    sessionId: conversationId,
    conversationId,
    kind: 'assistant_outcome_recorded',
    payload: { text: outcome },
  });
}

export function recordBrowserNavigation(
  conversationId: string,
  url: string,
  title?: string | null,
): void {
  const normalizedUrl = normalizeText(url, 400);
  if (!normalizedUrl) return;
  upsertSessionSummary({
    sessionId: conversationId,
    conversationId,
    surface: 'browser',
    title: title ? normalizeText(title, 120) : undefined,
    confidence: 0.88,
    needsConfirmation: false,
  });
  appendSessionEvent({
    sessionId: conversationId,
    conversationId,
    kind: 'browser_navigate',
    surface: 'browser',
    payload: { url: normalizedUrl, title: normalizeText(title ?? null, 120) },
  });
}

export function recordUIStateObservation(
  conversationId: string,
  state: UIStateSnapshot,
): void {
  upsertSessionSummary({
    sessionId: conversationId,
    conversationId,
    surface: state.browserVisible ? 'mixed' : 'conversation',
    confidence: 0.82,
    needsConfirmation: false,
  });
  appendSessionEvent({
    sessionId: conversationId,
    conversationId,
    kind: 'ui_state_observed',
    surface: 'ui',
    payload: {
      activeView: state.activeView,
      activeRightPanel: state.activeRightPanel,
      browserVisible: state.browserVisible,
      browserUrl: normalizeText(state.browserUrl, 240),
      provider: state.provider,
      model: state.model,
    },
  });
}

export function peekLatestSessionContinuity(excludeConversationId?: string | null): SessionContinuityPeek {
  const latest = bestSessionRow(excludeConversationId, { filterDismissed: true });
  if (!latest) {
    return {
      hasPriorSession: false,
      sessionId: null,
      updatedAt: null,
      surface: null,
      workspaceMatch: false,
      confidence: 0,
      title: null,
    };
  }
  return {
    hasPriorSession: true,
    sessionId: latest.session_id,
    updatedAt: latest.updated_at,
    surface: latest.surface,
    workspaceMatch: latest.workspace_id === workspaceId(),
    confidence: latest.confidence,
    title: latest.title ?? null,
  };
}

export function recallLatestSessionContinuity(excludeConversationId?: string | null): SessionRecallResult | null {
  const latest = bestSessionRow(excludeConversationId);
  if (!latest) return null;

  const supportingFacts: string[] = [];
  for (const event of getRecentSessionEvents(latest.session_id)) {
    try {
      const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
      let text: string | null = null;
      if (typeof payload?.text === 'string') {
        text = normalizeText(payload.text, 160);
      } else if (event.kind === 'browser_navigate' && typeof payload?.url === 'string') {
        const title = typeof payload.title === 'string' ? ` (${payload.title})` : '';
        text = normalizeText(`${payload.url}${title}`, 200);
      } else if (event.kind === 'ui_state_observed') {
        const parts: string[] = [];
        if (typeof payload?.activeRightPanel === 'string') parts.push(`panel=${payload.activeRightPanel}`);
        if (typeof payload?.browserUrl === 'string') parts.push(`url=${payload.browserUrl}`);
        if (parts.length) text = parts.join(', ');
      }
      if (text) supportingFacts.push(`${event.kind}: ${text}`);
    } catch {
      // Ignore malformed payloads; continuity should degrade cleanly.
    }
  }

  return {
    sessionId: latest.session_id,
    conversationId: latest.conversation_id ?? null,
    title: latest.title ?? null,
    objective: latest.objective ?? null,
    lastUserIntent: latest.last_user_intent ?? null,
    lastCompletedStep: latest.last_completed_step ?? null,
    nextStep: latest.next_step ?? null,
    updatedAt: latest.updated_at,
    confidence: latest.confidence,
    supportingFacts,
  };
}

export function dismissSessionContinuitySuggestion(sessionId: string): void {
  getDb()
    .prepare(
      `INSERT INTO session_dismissals (workspace_id, session_id, dismissed_at)
       VALUES (?, ?, ?)
       ON CONFLICT(workspace_id, session_id) DO UPDATE SET
         dismissed_at = excluded.dismissed_at`
    )
    .run(workspaceId(), sessionId, nowIso());
}

export function formatSessionRecallBlock(recall: SessionRecallResult): string {
  const lines = ['[Relevant prior session context]'];
  if (recall.title) lines.push(`Title: ${recall.title}`);
  if (recall.objective) lines.push(`Objective: ${recall.objective}`);
  if (recall.lastUserIntent) lines.push(`Last user intent: ${recall.lastUserIntent}`);
  if (recall.lastCompletedStep) lines.push(`Last completed step: ${recall.lastCompletedStep}`);
  if (recall.nextStep) lines.push(`Next step: ${recall.nextStep}`);
  if (recall.supportingFacts.length > 0) {
    lines.push('Supporting facts:');
    for (const fact of recall.supportingFacts.slice(0, 3)) {
      lines.push(`- ${fact}`);
    }
  }
  lines.push('[End prior session context]');
  return lines.join('\n');
}

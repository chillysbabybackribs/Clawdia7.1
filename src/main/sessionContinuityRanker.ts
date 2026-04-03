export type SessionSurface = 'conversation' | 'browser' | 'mixed' | string;

export interface SessionContinuityCandidate {
  surface: SessionSurface;
  confidence: number;
  updated_at: string;
}

function surfaceAffinity(candidate: SessionSurface, preferred: SessionSurface): number {
  if (candidate === preferred) return 1;
  if (candidate === 'mixed') return 0.8;
  if (preferred === 'browser' && candidate === 'conversation') return 0.25;
  if (preferred === 'conversation' && candidate === 'browser') return 0.35;
  return 0.5;
}

function recencyScore(updatedAt: string): number {
  const updatedMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedMs)) return 0;
  const ageHours = Math.max(0, (Date.now() - updatedMs) / (1000 * 60 * 60));
  return 1 / (1 + ageHours / 6);
}

export function scoreSessionCandidate(candidate: SessionContinuityCandidate, preferredSurface: SessionSurface): number {
  return (
    surfaceAffinity(candidate.surface, preferredSurface) * 0.5 +
    recencyScore(candidate.updated_at) * 0.35 +
    Math.max(0, Math.min(1, candidate.confidence)) * 0.15
  );
}

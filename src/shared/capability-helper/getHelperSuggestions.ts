import { capabilityRegistry } from './registry';
import type {
  CapabilitySuggestion,
  HelperBlockModel,
  TaskContext,
} from './types';

function matchesSubset(ctx: TaskContext, rule?: Partial<TaskContext>): boolean {
  if (!rule) return true;
  return Object.entries(rule).every(([key, value]) => ctx[key as keyof TaskContext] === value);
}

function scoreSuggestion(ctx: TaskContext, item: CapabilitySuggestion): number | null {
  if (item.required && !matchesSubset(ctx, item.required)) return null;
  if (item.blockedIf && matchesSubset(ctx, item.blockedIf)) return null;

  let score = item.priority;
  if (item.domain === ctx.domain) score += 20;

  if (item.optionalMatches) {
    for (const [key, value] of Object.entries(item.optionalMatches)) {
      if (ctx[key as keyof TaskContext] === value) score += 8;
    }
  }

  if (ctx.lastActionStatus === 'success') score += 4;
  if (ctx.pageType === 'video' && item.tags?.includes('video')) score += 10;

  return score;
}

export function getHelperSuggestions(
  ctx: TaskContext,
  registry: CapabilitySuggestion[] = capabilityRegistry,
): HelperBlockModel | null {
  const ranked = registry
    .map((item) => ({ item, score: scoreSuggestion(ctx, item) }))
    .filter((entry): entry is { item: CapabilitySuggestion; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ item }) => ({
      id: item.id,
      label: item.label,
      prompt: item.prompt,
    }));

  if (ranked.length < 2) return null;

  return {
    title: 'What you can do here',
    suggestions: ranked,
    collapsedByDefault: false,
  };
}

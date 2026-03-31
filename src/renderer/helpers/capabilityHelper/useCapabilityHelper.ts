import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Message } from '../../../shared/types';
import { getHelperSuggestions } from '../../../shared/capability-helper/getHelperSuggestions';
import type { HelperBlockModel } from '../../../shared/capability-helper/types';
import { deriveTaskContext, getTaskContextKey } from './deriveTaskContext';

type UseCapabilityHelperResult = {
  model: HelperBlockModel | null;
  dismissHelper: () => void;
  recordSuggestionUsed: (suggestionId: string) => void;
};

export function useCapabilityHelper(messages: Message[], messageId?: string): UseCapabilityHelperResult {
  const [dismissedContextKeys, setDismissedContextKeys] = useState<Set<string>>(() => new Set());
  const [shownCounts, setShownCounts] = useState<Map<string, number>>(() => new Map());
  const [clickedSuggestions, setClickedSuggestions] = useState<Map<string, Set<string>>>(() => new Map());

  const model = useMemo(() => {
    const context = deriveTaskContext(messages, messageId);
    if (!context) return null;

    const contextKey = getTaskContextKey(context);
    if (dismissedContextKeys.has(contextKey)) return null;

    const nextModel = getHelperSuggestions(context);
    if (!nextModel) return null;

    const clickedForContext = clickedSuggestions.get(contextKey);
    const filteredSuggestions = nextModel.suggestions.filter((suggestion) => !clickedForContext?.has(suggestion.id));
    if (filteredSuggestions.length < 2) return null;

    const shownCount = shownCounts.get(contextKey) ?? 0;

    return {
      ...nextModel,
      suggestions: filteredSuggestions,
      collapsedByDefault: shownCount >= 1,
      contextKey,
    };
  }, [clickedSuggestions, dismissedContextKeys, messageId, messages, shownCounts]);

  useEffect(() => {
    if (!model?.contextKey) return;
    setShownCounts((prev) => {
      const next = new Map(prev);
      next.set(model.contextKey as string, (next.get(model.contextKey as string) ?? 0) + 1);
      return next;
    });
  }, [model?.contextKey]);

  const dismissHelper = useCallback(() => {
    if (!model?.contextKey) return;
    setDismissedContextKeys((prev) => {
      const next = new Set(prev);
      next.add(model.contextKey as string);
      return next;
    });
  }, [model?.contextKey]);

  const recordSuggestionUsed = useCallback((suggestionId: string) => {
    if (!model?.contextKey) return;
    setClickedSuggestions((prev) => {
      const next = new Map(prev);
      const existing = new Set(next.get(model.contextKey as string) ?? []);
      existing.add(suggestionId);
      next.set(model.contextKey as string, existing);
      return next;
    });
  }, [model?.contextKey]);

  return {
    model,
    dismissHelper,
    recordSuggestionUsed,
  };
}

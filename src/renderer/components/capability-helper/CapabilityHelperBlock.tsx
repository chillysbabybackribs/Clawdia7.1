import React, { useState } from 'react';
import type { HelperBlockModel } from '../../../shared/capability-helper/types';

interface CapabilityHelperBlockProps {
  model: HelperBlockModel;
  onRunSuggestion: (prompt: string) => void;
  onDismiss: () => void;
}

export default function CapabilityHelperBlock({
  model,
  onRunSuggestion,
  onDismiss,
}: CapabilityHelperBlockProps) {
  const [expanded, setExpanded] = useState(!model.collapsedByDefault);

  return (
    <div className="mt-3">
      {expanded ? (
        <div className="flex flex-wrap items-center gap-2">
          {model.suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              onClick={() => onRunSuggestion(suggestion.prompt)}
              className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-[12px] text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
            >
              {suggestion.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-white/[0.05] hover:text-text-secondary"
          >
            Hide
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-white/[0.05] hover:text-text-secondary"
            title="Dismiss suggestions for this context"
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-white/[0.05] hover:text-text-secondary"
          >
            Show
          </button>
        </div>
      )}
    </div>
  );
}

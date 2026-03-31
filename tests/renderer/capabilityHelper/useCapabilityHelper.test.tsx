// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useCapabilityHelper } from '../../../src/renderer/helpers/capabilityHelper/useCapabilityHelper';
import type { Message } from '../../../src/shared/types';

function Harness({ messages }: { messages: Message[] }) {
  const { model, dismissHelper, recordSuggestionUsed } = useCapabilityHelper(messages, 'a1');

  if (!model) return <div data-testid="empty">empty</div>;

  return (
    <div>
      <div data-testid="title">{model.title}</div>
      <div data-testid="collapsed">{String(model.collapsedByDefault)}</div>
      {model.suggestions.map((suggestion) => (
        <button key={suggestion.id} onClick={() => recordSuggestionUsed(suggestion.id)}>
          {suggestion.id}
        </button>
      ))}
      <button onClick={dismissHelper}>dismiss</button>
    </div>
  );
}

const messages: Message[] = [
  {
    id: 'u1',
    role: 'user',
    content: 'navigate to youtube',
    timestamp: '7:41 PM',
  },
  {
    id: 'a1',
    role: 'assistant',
    content: 'You are now on YouTube.',
    timestamp: '7:42 PM',
    toolCalls: [
      {
        id: 'tool-1',
        name: 'browser_navigate',
        status: 'success',
        output: JSON.stringify({
          url: 'https://www.youtube.com/',
          title: 'YouTube',
          textSample: 'Home Shorts Subscriptions Your channel YouTube Studio',
        }),
      },
    ],
  },
];

describe('useCapabilityHelper', () => {
  it('collapses after the same context has already been shown once', () => {
    render(<Harness messages={messages} />);
    expect(screen.getByTestId('collapsed').textContent).toBe('true');
  });

  it('suppresses the helper after dismissing the context', () => {
    render(<Harness messages={messages} />);
    fireEvent.click(screen.getByText('dismiss'));
    expect(screen.getByTestId('empty').textContent).toBe('empty');
  });

  it('filters out a clicked suggestion on subsequent renders', () => {
    const { rerender } = render(<Harness messages={messages} />);
    fireEvent.click(screen.getByText('youtube.search_topic'));
    rerender(<Harness messages={messages} />);
    expect(screen.queryByText('youtube.search_topic')).toBeNull();
  });
});

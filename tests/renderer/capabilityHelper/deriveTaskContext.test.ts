import { describe, expect, it } from 'vitest';
import { deriveTaskContext } from '../../../src/renderer/helpers/capabilityHelper/deriveTaskContext';
import type { Message } from '../../../src/shared/types';

describe('deriveTaskContext', () => {
  it('derives YouTube homepage context from browser_navigate output', () => {
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

    const context = deriveTaskContext(messages, 'a1');
    expect(context).toMatchObject({
      domain: 'browser',
      site: 'youtube',
      pageType: 'home',
      signedIn: true,
      recentIntent: 'navigate to youtube',
    });
  });

  it('derives terminal repository context from code-oriented intent', () => {
    const messages: Message[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'run tests in this repo',
        timestamp: '7:41 PM',
      },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Running tests.',
        timestamp: '7:42 PM',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'shell_exec',
            status: 'success',
            output: 'ok',
          },
        ],
      },
    ];

    const context = deriveTaskContext(messages, 'a1');
    expect(context).toMatchObject({
      domain: 'terminal',
      repoOpen: true,
      pageType: 'repository',
    });
  });
});

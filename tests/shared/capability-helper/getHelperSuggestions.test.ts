import { describe, expect, it } from 'vitest';
import { getHelperSuggestions } from '../../../src/shared/capability-helper/getHelperSuggestions';
import type { TaskContext } from '../../../src/shared/capability-helper/types';

describe('getHelperSuggestions', () => {
  it('returns YouTube homepage suggestions', () => {
    const context: TaskContext = {
      domain: 'browser',
      site: 'youtube',
      pageType: 'home',
      signedIn: true,
      lastActionStatus: 'success',
    };

    const model = getHelperSuggestions(context);
    expect(model?.title).toBe('What you can do here');
    expect(model?.suggestions.some((item) => item.id === 'youtube.upload_video')).toBe(true);
    expect(model?.suggestions.some((item) => item.id === 'youtube.search_topic')).toBe(true);
  });

  it('returns null when there is not enough contextual confidence', () => {
    const context: TaskContext = {
      domain: 'browser',
      pageType: 'unknown',
      lastActionStatus: 'success',
    };

    expect(getHelperSuggestions(context)).toBeNull();
  });
});

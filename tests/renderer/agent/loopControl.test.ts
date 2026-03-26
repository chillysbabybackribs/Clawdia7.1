// tests/renderer/agent/loopControl.test.ts
import {
  createLoopControl,
  cancelLoop,
  pauseLoop,
  resumeLoop,
  addContext,
  getLoopControl,
  removeLoopControl,
} from '../../../src/main/agent/loopControl';

describe('loopControl', () => {
  afterEach(() => {
    removeLoopControl('test-run');
  });

  it('cancel fires abort signal', () => {
    createLoopControl('test-run');
    const ctrl = getLoopControl('test-run')!;
    expect(ctrl.signal.aborted).toBe(false);
    cancelLoop('test-run');
    expect(ctrl.signal.aborted).toBe(true);
  });

  it('addContext queues text', () => {
    createLoopControl('test-run');
    addContext('test-run', 'hello');
    addContext('test-run', 'world');
    const ctrl = getLoopControl('test-run')!;
    expect(ctrl.pendingContext).toBe('hello\nworld');
  });

  it('pause resolves when resumed', async () => {
    createLoopControl('test-run');
    const ctrl = getLoopControl('test-run')!;
    pauseLoop('test-run');
    expect(ctrl.isPaused).toBe(true);
    setTimeout(() => resumeLoop('test-run'), 10);
    await ctrl.waitIfPaused();
    expect(ctrl.isPaused).toBe(false);
  });

  it('returns false for unknown runId', () => {
    expect(cancelLoop('no-such-run')).toBe(false);
    expect(pauseLoop('no-such-run')).toBe(false);
    expect(resumeLoop('no-such-run')).toBe(false);
    expect(addContext('no-such-run', 'x')).toBe(false);
  });
});

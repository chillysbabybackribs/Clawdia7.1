/**
 * Tests for the per-tab input serialization queue on ElectronBrowserService.
 *
 * We test the queue logic directly without needing Electron by extracting
 * the tabInputQueue mechanism into a minimal harness.
 */
import { describe, it, expect } from 'vitest';

// ── Minimal queue harness (mirrors the production implementation) ─────────────

class InputQueueHarness {
  private readonly queues = new Map<string, Promise<unknown>>();

  queue<T>(tabId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(tabId) ?? Promise.resolve();
    const next = prev.then(fn, fn as any);
    this.queues.set(tabId, next.catch(() => {}));
    return next;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('per-tab input serialization queue', () => {
  it('executes operations on the same tab serially', async () => {
    const harness = new InputQueueHarness();
    const order: number[] = [];

    const op = (n: number, delayMs: number) =>
      harness.queue('tab-1', () =>
        new Promise<void>(resolve => setTimeout(() => { order.push(n); resolve(); }, delayMs))
      );

    // Fire three ops concurrently — longer ops first so without queuing they'd complete out-of-order
    await Promise.all([op(1, 30), op(2, 20), op(3, 10)]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('operations on different tabs run independently (not serialized together)', async () => {
    const harness = new InputQueueHarness();
    const completionOrder: string[] = [];

    const opA = harness.queue('tab-A', () =>
      new Promise<void>(r => setTimeout(() => { completionOrder.push('A'); r(); }, 40))
    );
    const opB = harness.queue('tab-B', () =>
      new Promise<void>(r => setTimeout(() => { completionOrder.push('B'); r(); }, 10))
    );

    await Promise.all([opA, opB]);

    // tab-B has a shorter delay and runs independently, so it should finish first
    expect(completionOrder[0]).toBe('B');
    expect(completionOrder[1]).toBe('A');
  });

  it('an error in one operation does not block subsequent operations on the same tab', async () => {
    const harness = new InputQueueHarness();
    const results: string[] = [];

    // First op throws
    const op1 = harness.queue('tab-1', async () => {
      results.push('op1-start');
      throw new Error('simulated failure');
    }).catch(() => results.push('op1-caught'));

    // Second op should still run
    const op2 = harness.queue('tab-1', async () => {
      results.push('op2-done');
    });

    await Promise.all([op1, op2]);

    expect(results).toContain('op1-start');
    expect(results).toContain('op1-caught');
    expect(results).toContain('op2-done');
    // op2 must come after op1
    expect(results.indexOf('op2-done')).toBeGreaterThan(results.indexOf('op1-start'));
  });

  it('queue tail stays error-silent so new ops can always be enqueued', async () => {
    const harness = new InputQueueHarness();

    // Enqueue a failing op, then two more after it
    harness.queue('tab-x', async () => { throw new Error('boom'); }).catch(() => {});
    const r2 = harness.queue('tab-x', async () => 'second');
    const r3 = harness.queue('tab-x', async () => 'third');

    const [v2, v3] = await Promise.all([r2, r3]);
    expect(v2).toBe('second');
    expect(v3).toBe('third');
  });

  it('returns the value produced by the queued function', async () => {
    const harness = new InputQueueHarness();
    const result = await harness.queue('tab-1', async () => ({ ok: true, data: 42 }));
    expect(result).toEqual({ ok: true, data: 42 });
  });
});

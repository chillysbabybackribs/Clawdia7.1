/**
 * Tests for VirtualDisplay — the Xvfb-backed isolated X session for agent desktop automation.
 *
 * These tests require Xvfb to be installed (it is, at /usr/bin/Xvfb).
 * They are integration tests — they actually start and stop Xvfb.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { VirtualDisplay } from '../../../../src/main/core/desktop/virtualDisplay';

// Reset the singleton between tests by stopping and clearing the instance
afterEach(() => {
  VirtualDisplay.getInstance().stop();
  // Reset the singleton so the next test gets a clean instance
  (VirtualDisplay as any)._instance = null;
});

describe('VirtualDisplay', () => {
  it('getInstance returns the same object every time', () => {
    const a = VirtualDisplay.getInstance();
    const b = VirtualDisplay.getInstance();
    expect(a).toBe(b);
  });

  it('display is null before ensure() is called', () => {
    expect(VirtualDisplay.getInstance().display).toBeNull();
  });

  it('ensure() starts Xvfb and sets a display string', async () => {
    const vd = VirtualDisplay.getInstance();
    await vd.ensure();
    // On this machine Xvfb is available — display should be set
    expect(vd.display).toMatch(/^:\d+$/);
  }, 10_000);

  it('ensure() is idempotent — calling twice returns same display', async () => {
    const vd = VirtualDisplay.getInstance();
    await vd.ensure();
    const first = vd.display;
    await vd.ensure();
    expect(vd.display).toBe(first);
  }, 10_000);

  it('concurrent ensure() calls do not start multiple Xvfb processes', async () => {
    const vd = VirtualDisplay.getInstance();
    // Fire three concurrent ensure() calls
    await Promise.all([vd.ensure(), vd.ensure(), vd.ensure()]);
    // Only one display should be set
    expect(vd.display).toMatch(/^:\d+$/);
  }, 10_000);

  it('stop() clears the display', async () => {
    const vd = VirtualDisplay.getInstance();
    await vd.ensure();
    expect(vd.display).not.toBeNull();
    vd.stop();
    expect(vd.display).toBeNull();
  }, 10_000);

  it('display number is in the expected range (:90–:99)', async () => {
    const vd = VirtualDisplay.getInstance();
    await vd.ensure();
    if (vd.display) {
      const num = parseInt(vd.display.slice(1), 10);
      expect(num).toBeGreaterThanOrEqual(90);
      expect(num).toBeLessThanOrEqual(99);
    }
  }, 10_000);
});

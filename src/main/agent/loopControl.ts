// src/main/agent/loopControl.ts
import { setLoopPaused, deleteLoopState } from '../db';

export interface LoopControl {
  signal: AbortSignal;
  isPaused: boolean;
  pendingContext: string | null;
  waitIfPaused: () => Promise<void>;
  _abort: AbortController;
  /** All pending waiters — resolved together when the loop is resumed or cancelled. */
  _pauseWaiters: Array<() => void>;
}

const controls = new Map<string, LoopControl>();

export function createLoopControl(runId: string, parentSignal?: AbortSignal): LoopControl {
  const abort = new AbortController();

  if (parentSignal) {
    parentSignal.addEventListener('abort', () => abort.abort(), { once: true });
  }

  const ctrl: LoopControl = {
    signal: abort.signal,
    isPaused: false,
    pendingContext: null,
    _abort: abort,
    _pauseWaiters: [],
    waitIfPaused(): Promise<void> {
      if (!this.isPaused) return Promise.resolve();
      return new Promise<void>((resolve) => {
        this._pauseWaiters.push(resolve);
      });
    },
  };

  controls.set(runId, ctrl);
  return ctrl;
}

export function getLoopControl(runId: string): LoopControl | undefined {
  return controls.get(runId);
}

export function removeLoopControl(runId: string): void {
  controls.delete(runId);
  deleteLoopState(runId);
}

export function cancelLoop(runId: string): boolean {
  const ctrl = controls.get(runId);
  if (!ctrl) return false;
  ctrl._abort.abort();
  // Wake all waiters so they can observe the abort signal
  for (const resolve of ctrl._pauseWaiters) resolve();
  ctrl._pauseWaiters.length = 0;
  ctrl.isPaused = false;
  return true;
}

export function pauseLoop(runId: string): boolean {
  const ctrl = controls.get(runId);
  if (!ctrl) return false;
  ctrl.isPaused = true;
  setLoopPaused(runId, true);
  return true;
}

export function resumeLoop(runId: string): boolean {
  const ctrl = controls.get(runId);
  if (!ctrl) return false;
  ctrl.isPaused = false;
  setLoopPaused(runId, false);
  // Wake all waiters
  for (const resolve of ctrl._pauseWaiters) resolve();
  ctrl._pauseWaiters.length = 0;
  return true;
}

export function addContext(runId: string, text: string): boolean {
  const ctrl = controls.get(runId);
  if (!ctrl) return false;
  ctrl.pendingContext = ctrl.pendingContext ? `${ctrl.pendingContext}\n${text}` : text;
  return true;
}

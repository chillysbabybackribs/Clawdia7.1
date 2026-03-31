// src/main/agent/loopControl.ts
import { setLoopPaused, deleteLoopState } from '../db';

export interface LoopControl {
  signal: AbortSignal;
  isPaused: boolean;
  pendingContext: string | null;
  waitIfPaused: () => Promise<void>;
  /** Returns a signal that is aborted when stop OR pause fires — use for per-iteration LLM streams. */
  iterationSignal: () => AbortSignal;
  _abort: AbortController;
  _pauseAbort: AbortController;
  _pauseResolve: (() => void) | null;
}

const controls = new Map<string, LoopControl>();

export function createLoopControl(runId: string, parentSignal?: AbortSignal): LoopControl {
  const abort = new AbortController();
  const pauseAbort = new AbortController();

  if (parentSignal) {
    parentSignal.addEventListener('abort', () => {
      abort.abort();
      pauseAbort.abort();
    }, { once: true });
  }

  const ctrl: LoopControl = {
    signal: abort.signal,
    isPaused: false,
    pendingContext: null,
    _abort: abort,
    _pauseAbort: pauseAbort,
    _pauseResolve: null,
    waitIfPaused(): Promise<void> {
      if (!this.isPaused) return Promise.resolve();
      return new Promise<void>((resolve) => {
        this._pauseResolve = resolve;
      });
    },
    iterationSignal(): AbortSignal {
      // Returns a signal that fires on stop OR pause — aborts the current LLM stream immediately.
      const combined = new AbortController();
      const onAbort = () => combined.abort();
      this.signal.addEventListener('abort', onAbort, { once: true });
      this._pauseAbort.signal.addEventListener('abort', onAbort, { once: true });
      return combined.signal;
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
  ctrl._pauseAbort.abort();
  if (ctrl._pauseResolve) {
    ctrl._pauseResolve();
    ctrl._pauseResolve = null;
    ctrl.isPaused = false;
  }
  return true;
}

export function pauseLoop(runId: string): boolean {
  const ctrl = controls.get(runId);
  if (!ctrl) return false;
  ctrl.isPaused = true;
  // Abort the current iteration's LLM stream immediately.
  ctrl._pauseAbort.abort();
  setLoopPaused(runId, true);
  return true;
}

export function resumeLoop(runId: string): boolean {
  const ctrl = controls.get(runId);
  if (!ctrl) return false;
  ctrl.isPaused = false;
  // Replace the pause abort controller so the next iteration gets a fresh signal.
  ctrl._pauseAbort = new AbortController();
  setLoopPaused(runId, false);
  if (ctrl._pauseResolve) {
    ctrl._pauseResolve();
    ctrl._pauseResolve = null;
  }
  return true;
}

export function addContext(runId: string, text: string): boolean {
  const ctrl = controls.get(runId);
  if (!ctrl) return false;
  ctrl.pendingContext = ctrl.pendingContext ? `${ctrl.pendingContext}\n${text}` : text;
  return true;
}

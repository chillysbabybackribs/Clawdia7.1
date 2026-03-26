// src/main/agent/loopControl.ts

export interface LoopControl {
  signal: AbortSignal;
  isPaused: boolean;
  pendingContext: string | null;
  waitIfPaused: () => Promise<void>;
  _abort: AbortController;
  _pauseResolve: (() => void) | null;
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
    _pauseResolve: null,
    waitIfPaused(): Promise<void> {
      if (!this.isPaused) return Promise.resolve();
      return new Promise<void>((resolve) => {
        this._pauseResolve = resolve;
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
}

export function cancelLoop(runId: string): boolean {
  const ctrl = controls.get(runId);
  if (!ctrl) return false;
  ctrl._abort.abort();
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
  return true;
}

export function resumeLoop(runId: string): boolean {
  const ctrl = controls.get(runId);
  if (!ctrl) return false;
  ctrl.isPaused = false;
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

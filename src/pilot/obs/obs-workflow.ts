// src/pilot/obs/obs-workflow.ts
import {
  launchOBS, detectMainWindow, createScene, selectScene,
  addSource, setMicMuted, setTransition,
  openSettings, closeSettings, verifyMainState,
} from './obs-adapter';
import type { OBSRuntimeState, StepResult } from './obs-types';

const SCENE_NAME      = 'PilotScene';
const SOURCE_TYPE     = 'monitor_capture';
const SOURCE_NAME     = 'PilotScreen';
const TRANSITION_NAME = 'Fade';
const GATE_STEPS = new Set([
  'launchOBS',
  'detectMainWindow',
  'createScene',
  'selectScene',
  'openSettings',
]);

/** Run the full 10-step workflow. Never throws — errors are in StepResult. */
export async function runOBSWorkflow(opts: { runtimeState?: OBSRuntimeState } = {}): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const runtimeState = opts.runtimeState;

  async function step(fn: () => Promise<StepResult>): Promise<boolean> {
    try {
      const r = await fn();
      results.push(r);
      const marker = r.ok ? '✓' : '✗';
      console.log(
        `[Workflow] ${marker} ${r.step.padEnd(20)} conf=${r.confidence.toFixed(2)} ` +
        `retries=${r.retries} locator=${r.locatorUsed}${r.escalated ? ' [escalated]' : ''}` +
        (r.failType ? ` FAIL:${r.failType}` : ''),
      );
      if (!r.ok && GATE_STEPS.has(r.step)) {
        console.log(`[Workflow] Halting after failed gate step: ${r.step}`);
        return false;
      }
      return true;
    } catch (err: any) {
      const r: StepResult = {
        step: fn.name || 'unknown', ok: false, confidence: 0, retries: 0,
        escalated: false, failType: 'unknown', locatorUsed: 'none',
        durationMs: 0, workerTokens: 0, verifierTokens: 0,
      };
      results.push(r);
      console.error(`[Workflow] Uncaught: ${err.message}`);
      return false;
    }
  }

  if (!await step(() => launchOBS(runtimeState))) return results;
  if (!await step(() => detectMainWindow(runtimeState))) return results;
  if (!await step(() => createScene(SCENE_NAME, runtimeState))) return results;
  if (!await step(() => selectScene(SCENE_NAME, runtimeState))) return results;
  if (!await step(() => addSource(SOURCE_TYPE, SOURCE_NAME, runtimeState))) return results;
  if (!await step(() => setMicMuted(true, runtimeState))) return results;
  if (!await step(() => setTransition(TRANSITION_NAME, runtimeState))) return results;
  if (!await step(() => openSettings(runtimeState))) return results;
  if (!await step(() => closeSettings(runtimeState))) return results;
  await step(() => verifyMainState(runtimeState));

  return results;
}

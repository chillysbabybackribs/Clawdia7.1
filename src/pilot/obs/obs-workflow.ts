// src/pilot/obs/obs-workflow.ts
import {
  launchOBS, detectMainWindow, createScene, selectScene,
  addSource, setMicMuted, setTransition,
  openSettings, closeSettings, verifyMainState,
} from './obs-adapter';
import type { StepResult } from './obs-types';

const SCENE_NAME      = 'PilotScene';
const SOURCE_TYPE     = 'monitor_capture';
const SOURCE_NAME     = 'PilotScreen';
const TRANSITION_NAME = 'Fade';

/** Run the full 10-step workflow. Never throws — errors are in StepResult. */
export async function runOBSWorkflow(): Promise<StepResult[]> {
  const results: StepResult[] = [];

  async function step(fn: () => Promise<StepResult>): Promise<void> {
    try {
      const r = await fn();
      results.push(r);
      const marker = r.ok ? '✓' : '✗';
      console.log(
        `[Workflow] ${marker} ${r.step.padEnd(20)} conf=${r.confidence.toFixed(2)} ` +
        `retries=${r.retries} locator=${r.locatorUsed}${r.escalated ? ' [escalated]' : ''}` +
        (r.failType ? ` FAIL:${r.failType}` : ''),
      );
    } catch (err: any) {
      const r: StepResult = {
        step: fn.name || 'unknown', ok: false, confidence: 0, retries: 0,
        escalated: false, failType: 'unknown', locatorUsed: 'none',
        durationMs: 0, workerTokens: 0, verifierTokens: 0,
      };
      results.push(r);
      console.error(`[Workflow] Uncaught: ${err.message}`);
    }
  }

  await step(() => launchOBS());
  await step(() => detectMainWindow());
  await step(() => createScene(SCENE_NAME));
  await step(() => selectScene(SCENE_NAME));
  await step(() => addSource(SOURCE_TYPE, SOURCE_NAME));
  await step(() => setMicMuted(true));
  await step(() => setTransition(TRANSITION_NAME));
  await step(() => openSettings());
  await step(() => closeSettings());
  await step(() => verifyMainState());

  return results;
}

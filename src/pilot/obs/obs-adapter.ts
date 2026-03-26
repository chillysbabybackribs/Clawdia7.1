// src/pilot/obs/obs-adapter.ts
import * as fs from 'fs';
import * as path from 'path';
import { executeGuiInteract } from '../../main/core/desktop';
import { a11yFind, a11yDoAction, a11yGetTree, a11ySetValue } from '../../main/core/desktop/a11y';
import { wait, run } from '../../main/core/desktop/shared';
import { verify } from './obs-verifier';
import { clickControl, screenshotBase64 } from './obs-locator';
import { OBS_PILOT_CONFIG } from './obs-config';
import type { StepResult, FailType, LocatorUsed, ControlDef } from './obs-types';

const OBS_MAP = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'obs-map.json'), 'utf-8'),
);

// ── Internal helpers ───────────────────────────────────────────────────────────

function makeResult(
  step: string,
  ok: boolean,
  opts: Partial<StepResult> & { startMs: number },
): StepResult {
  return {
    step, ok,
    confidence:     0,
    retries:        0,
    escalated:      false,
    failType:       null,
    locatorUsed:    'none',
    workerTokens:   0,
    verifierTokens: 0,
    ...opts,
    durationMs: Date.now() - opts.startMs,
  };
}

async function focusOBS(): Promise<boolean> {
  const r = await executeGuiInteract({ action: 'focus', window: 'OBS' });
  return !String(r).startsWith('[Error]');
}

async function waitForWindow(pattern: RegExp, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await executeGuiInteract({ action: 'list_windows' });
    if (pattern.test(String(r))) return true;
    await wait(500);
  }
  return false;
}

async function withRetry(
  step: string,
  action: () => Promise<{ ok: boolean; locatorUsed: LocatorUsed; failType: FailType | null }>,
  postcondition: string,
  maxRetries = OBS_PILOT_CONFIG.maxRetries,
): Promise<StepResult> {
  const startMs = Date.now();
  let retries = 0;
  let lastLocator: LocatorUsed = 'none';
  let lastFailType: FailType | null = null;

  while (retries <= maxRetries) {
    const r = await action();
    lastLocator = r.locatorUsed;
    lastFailType = r.failType;

    if (r.ok) {
      await wait(OBS_PILOT_CONFIG.actionDelayMs);
      const shot = await screenshotBase64();
      if (!shot) {
        retries++;
        continue;
      }
      const v = await verify(postcondition, shot, step);
      if (v.ok) {
        return makeResult(step, true, {
          startMs, retries, locatorUsed: r.locatorUsed,
          confidence: v.confidence, escalated: v.escalated,
          workerTokens: v.workerTokens, verifierTokens: v.verifierTokens,
        });
      }
      console.log(`[Adapter] ${step} verify failed (attempt ${retries + 1}): ${v.reason}`);
    }

    retries++;
    if (retries <= maxRetries) await wait(500);
  }

  // Final verify attempt
  const shot = await screenshotBase64();
  if (shot) {
    const v = await verify(postcondition, shot, step);
    return makeResult(step, v.ok, {
      startMs, retries: retries - 1, locatorUsed: lastLocator,
      confidence: v.confidence, escalated: v.escalated,
      workerTokens: v.workerTokens, verifierTokens: v.verifierTokens,
      failType: v.ok ? null : (lastFailType ?? 'verify_failed'),
    });
  }

  return makeResult(step, false, {
    startMs, retries: maxRetries, locatorUsed: lastLocator,
    failType: lastFailType ?? 'unknown', confidence: 0,
  });
}

// ── Public adapter methods ─────────────────────────────────────────────────────

export async function launchOBS(): Promise<StepResult> {
  const startMs = Date.now();
  const step = 'launchOBS';

  // Already running?
  const windows = await executeGuiInteract({ action: 'list_windows' });
  if (/OBS/.test(String(windows))) {
    await focusOBS();
  } else {
    run(`${OBS_PILOT_CONFIG.obsExecutable} &`);
    const appeared = await waitForWindow(/OBS/, OBS_PILOT_CONFIG.launchTimeoutMs);
    if (!appeared) return makeResult(step, false, { startMs, failType: 'timeout', confidence: 0 });
    await focusOBS();
    await wait(1000);
  }

  const shot = await screenshotBase64();
  if (!shot) return makeResult(step, false, { startMs, failType: 'verify_failed', confidence: 0 });

  const v = await verify(
    'OBS Studio main window is visible with all 6 panels: menu bar, Scenes, Sources, Audio Mixer, Scene Transitions, and Controls',
    shot, step,
  );
  return makeResult(step, v.ok, {
    startMs, locatorUsed: 'a11y', confidence: v.confidence,
    escalated: v.escalated, workerTokens: v.workerTokens, verifierTokens: v.verifierTokens,
    failType: v.ok ? null : 'verify_failed',
  });
}

export async function detectMainWindow(): Promise<StepResult> {
  const startMs = Date.now();
  const step = 'detectMainWindow';

  await focusOBS();

  const tree = await a11yGetTree(OBS_PILOT_CONFIG.appName, undefined, 2);
  const treeOk = !tree.error && tree.tree != null;

  const shot = await screenshotBase64();
  if (!shot) return makeResult(step, false, { startMs, failType: 'verify_failed', confidence: 0 });

  const v = await verify(
    'OBS Studio main window is visible with all 6 panels: menu bar, Scenes, Sources, Audio Mixer, Scene Transitions, and Controls',
    shot, step,
  );
  return makeResult(step, v.ok, {
    startMs, locatorUsed: treeOk ? 'a11y' : 'ocr', confidence: v.confidence,
    escalated: v.escalated, workerTokens: v.workerTokens, verifierTokens: v.verifierTokens,
    failType: v.ok ? null : 'verify_failed',
  });
}

export async function createScene(name: string): Promise<StepResult> {
  const ctrl: ControlDef = OBS_MAP.controls.sceneAddBtn;
  return withRetry(
    'createScene',
    async () => {
      const r = await clickControl(ctrl);
      if (!r.ok) return { ok: false, locatorUsed: r.strategy, failType: 'element_not_found' as FailType };
      await wait(OBS_PILOT_CONFIG.modalTimeoutMs);
      await executeGuiInteract({ action: 'type', text: name });
      await wait(100);
      await executeGuiInteract({ action: 'key', text: 'Return' });
      return { ok: true, locatorUsed: r.strategy, failType: null };
    },
    `The Scenes panel contains a scene named "${name}"`,
  );
}

export async function selectScene(name: string): Promise<StepResult> {
  return withRetry(
    'selectScene',
    async () => {
      const r = await a11yDoAction(OBS_PILOT_CONFIG.appName, 'list item', name, 'click');
      return {
        ok: r.success ?? false,
        locatorUsed: 'a11y' as LocatorUsed,
        failType: (r.success ?? false) ? null : 'element_not_found' as FailType,
      };
    },
    `The scene named "${name}" is selected in the Scenes panel`,
  );
}

export async function addSource(type: string, name: string): Promise<StepResult> {
  const startMs = Date.now();
  const step = 'addSource';
  const ctrl: ControlDef = OBS_MAP.controls.sourceAddBtn;

  const clickR = await clickControl(ctrl);
  if (!clickR.ok) {
    return makeResult(step, false, { startMs, failType: 'element_not_found', locatorUsed: clickR.strategy, confidence: 0 });
  }

  const modalAppeared = await waitForWindow(/Add Source/, OBS_PILOT_CONFIG.modalTimeoutMs);
  if (!modalAppeared) {
    return makeResult(step, false, { startMs, failType: 'modal_unexpected', locatorUsed: clickR.strategy, confidence: 0 });
  }

  // Click source type in list
  const typeR = await a11yDoAction(OBS_PILOT_CONFIG.appName, 'list item', type, 'click');
  if (!(typeR.success ?? false)) {
    await executeGuiInteract({ action: 'key', text: 'Escape' });
    return makeResult(step, false, { startMs, failType: 'element_not_found', locatorUsed: 'a11y', confidence: 0 });
  }

  // OK to confirm type selection
  const okCtrl: ControlDef = OBS_MAP.controls.settingsOkBtn;
  await clickControl(okCtrl);
  await wait(OBS_PILOT_CONFIG.modalTimeoutMs);

  // Name dialog — clear and type name
  await executeGuiInteract({ action: 'key', text: 'ctrl+a' });
  await executeGuiInteract({ action: 'type', text: name });
  await executeGuiInteract({ action: 'key', text: 'Return' });
  await wait(OBS_PILOT_CONFIG.modalTimeoutMs);

  // Properties dialog may appear — dismiss it
  const propsAppeared = await waitForWindow(/Properties/, 1500);
  if (propsAppeared) {
    await executeGuiInteract({ action: 'key', text: 'Return' });
    await wait(500);
  }

  const shot = await screenshotBase64();
  if (!shot) return makeResult(step, false, { startMs, failType: 'verify_failed', locatorUsed: clickR.strategy, confidence: 0 });

  const v = await verify(`The Sources panel contains a source named "${name}"`, shot, step);
  return makeResult(step, v.ok, {
    startMs, locatorUsed: clickR.strategy, confidence: v.confidence,
    escalated: v.escalated, workerTokens: v.workerTokens, verifierTokens: v.verifierTokens,
    failType: v.ok ? null : 'verify_failed',
  });
}

export async function setMicMuted(muted: boolean): Promise<StepResult> {
  const ctrl: ControlDef = OBS_MAP.controls.micMuteBtn;
  return withRetry(
    'setMicMuted',
    async () => {
      const found = await a11yFind(OBS_PILOT_CONFIG.appName, ctrl.a11yRole, ctrl.a11yName ?? '');
      const currentlyMuted = found.found && Array.isArray(found.match?.state) && found.match.state.includes('checked');
      if (currentlyMuted === muted) return { ok: true, locatorUsed: 'a11y' as LocatorUsed, failType: null };
      const r = await clickControl(ctrl);
      return { ok: r.ok, locatorUsed: r.strategy, failType: r.ok ? null : 'element_not_found' as FailType };
    },
    `The Mic/Aux mute button in the Audio Mixer is ${muted ? 'active/pressed (muted)' : 'inactive/unpressed (unmuted)'}`,
  );
}

export async function setTransition(name: string): Promise<StepResult> {
  const startMs = Date.now();
  const ctrl: ControlDef = OBS_MAP.controls.transitionCombo;
  const knownValues: string[] = ctrl.knownValues ?? [];

  if (!knownValues.includes(name)) {
    return makeResult('setTransition', false, { startMs, failType: 'precondition_failed', confidence: 0, locatorUsed: 'none' });
  }

  return withRetry(
    'setTransition',
    async () => {
      // Try AT-SPI set_value first
      const setR = await a11ySetValue(OBS_PILOT_CONFIG.appName, ctrl.a11yRole, ctrl.a11yName ?? '', name);
      if (setR.ok) return { ok: true, locatorUsed: 'a11y' as LocatorUsed, failType: null };

      // Fallback: click combo then pick option
      const clickR = await clickControl(ctrl);
      if (!clickR.ok) return { ok: false, locatorUsed: clickR.strategy, failType: 'element_not_found' as FailType };
      await wait(300);

      const optR = await a11yDoAction(OBS_PILOT_CONFIG.appName, 'menu item', name, 'click');
      if (optR.success ?? false) return { ok: true, locatorUsed: 'a11y' as LocatorUsed, failType: null };

      await executeGuiInteract({ action: 'key', text: 'Escape' });
      return { ok: false, locatorUsed: 'ocr' as LocatorUsed, failType: 'element_not_found' as FailType };
    },
    `The Scene Transitions combo box shows "${name}"`,
  );
}

export async function openSettings(): Promise<StepResult> {
  const ctrl: ControlDef = OBS_MAP.controls.settingsBtn;
  return withRetry(
    'openSettings',
    async () => {
      const r = await clickControl(ctrl);
      if (!r.ok) return { ok: false, locatorUsed: r.strategy, failType: 'element_not_found' as FailType };
      const appeared = await waitForWindow(/Settings/, OBS_PILOT_CONFIG.modalTimeoutMs);
      return { ok: appeared, locatorUsed: r.strategy, failType: appeared ? null : 'timeout' as FailType };
    },
    'The OBS Settings dialog is open and visible',
  );
}

export async function closeSettings(): Promise<StepResult> {
  return withRetry(
    'closeSettings',
    async () => {
      const okCtrl: ControlDef = OBS_MAP.controls.settingsOkBtn;
      let r = await clickControl(okCtrl);
      if (!r.ok) {
        const closeCtrl: ControlDef = OBS_MAP.controls.settingsCloseBtn;
        r = await clickControl(closeCtrl);
      }
      if (!r.ok) {
        await executeGuiInteract({ action: 'key', text: 'Escape' });
      }
      await wait(500);
      const windows = await executeGuiInteract({ action: 'list_windows' });
      const closed = !/Settings/.test(String(windows));
      return { ok: closed, locatorUsed: r.strategy, failType: closed ? null : 'timeout' as FailType };
    },
    'The OBS Settings dialog is closed and the main window is visible',
  );
}

export async function verifyMainState(): Promise<StepResult> {
  const startMs = Date.now();
  const step = 'verifyMainState';

  await focusOBS();
  await wait(200);

  const shot = await screenshotBase64();
  if (!shot) return makeResult(step, false, { startMs, failType: 'verify_failed', confidence: 0 });

  const v = await verify(
    'OBS Studio main window is fully visible with all 6 panels (menu bar, Scenes, Sources, Audio Mixer, Scene Transitions, Controls) and no dialogs are open',
    shot, step,
  );
  return makeResult(step, v.ok, {
    startMs, locatorUsed: 'a11y', confidence: v.confidence,
    escalated: v.escalated, workerTokens: v.workerTokens, verifierTokens: v.verifierTokens,
    failType: v.ok ? null : 'verify_failed',
  });
}

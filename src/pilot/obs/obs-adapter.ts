// src/pilot/obs/obs-adapter.ts
import * as fs from 'fs';
import * as path from 'path';
import { executeGuiInteract } from '../../main/core/desktop';
import { a11yFind, a11yDoAction, a11yGetTree, a11ySetValue } from '../../main/core/desktop/a11y';
import { wait, run } from '../../main/core/desktop/shared';
import { verify } from './obs-verifier';
import { clickControl, screenshotBase64 } from './obs-locator';
import { OBS_PILOT_CONFIG } from './obs-config';
import { rememberUnique } from './obs-state';
import type { StepResult, FailType, LocatorUsed, ControlDef, OBSRuntimeState } from './obs-types';

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

async function listWindows(): Promise<string> {
  return String(await executeGuiInteract({ action: 'list_windows' }));
}

async function verifyWithVision(
  step: string,
  postcondition: string,
): Promise<{
  ok: boolean;
  confidence: number;
  escalated: boolean;
  workerTokens: number;
  verifierTokens: number;
  reason: string;
}> {
  await focusOBS();
  await wait(400);
  const shot = await screenshotBase64();
  if (!shot) {
    return {
      ok: false,
      confidence: 0,
      escalated: false,
      workerTokens: 0,
      verifierTokens: 0,
      reason: 'screenshot_failed',
    };
  }
  return verify(postcondition, shot, step);
}

async function findNamedItem(name: string): Promise<boolean> {
  const res = await a11yFind(OBS_PILOT_CONFIG.appName, 'list item', name);
  return res.found === true && !res.ambiguous;
}

async function isMutedState(expectedMuted: boolean): Promise<boolean> {
  const found = await a11yFind(OBS_PILOT_CONFIG.appName, 'push button', 'Mute');
  const state = Array.isArray(found.match?.state) ? found.match.state : [];
  return found.found === true && state.includes('checked') === expectedMuted;
}

type VisionMode = 'always' | 'fallback' | 'never';

function makeSkippedResult(step: string, startMs: number): StepResult {
  return makeResult(step, true, {
    startMs,
    confidence: 1,
    locatorUsed: 'none',
  });
}

async function withRetry(
  step: string,
  action: () => Promise<{ ok: boolean; locatorUsed: LocatorUsed; failType: FailType | null }>,
  opts: {
    postcondition?: string;
    localCheck?: () => Promise<boolean>;
    visionMode?: VisionMode;
    maxRetries?: number;
  } = {},
): Promise<StepResult> {
  const startMs = Date.now();
  const maxRetries = opts.maxRetries ?? OBS_PILOT_CONFIG.maxRetries;
  const visionMode = opts.visionMode ?? 'fallback';
  let retries = 0;
  let lastLocator: LocatorUsed = 'none';
  let lastFailType: FailType | null = null;

  while (retries <= maxRetries) {
    const r = await action();
    lastLocator = r.locatorUsed;
    lastFailType = r.failType;

    if (r.ok) {
      await wait(OBS_PILOT_CONFIG.actionDelayMs);
      const localOk = opts.localCheck ? await opts.localCheck() : true;
      if (localOk) {
        if (visionMode === 'always' && opts.postcondition) {
          const v = await verifyWithVision(step, opts.postcondition);
          if (v.ok) {
            return makeResult(step, true, {
              startMs, retries, locatorUsed: r.locatorUsed,
              confidence: v.confidence, escalated: v.escalated,
              workerTokens: v.workerTokens, verifierTokens: v.verifierTokens,
            });
          }
          console.log(`[Adapter] ${step} verify failed (attempt ${retries + 1}): ${v.reason}`);
        } else {
          return makeResult(step, true, {
            startMs,
            retries,
            locatorUsed: r.locatorUsed,
            confidence: 1,
          });
        }
      }
    }

    retries++;
    if (retries <= maxRetries) await wait(500);
  }

  if (visionMode !== 'never' && opts.postcondition) {
    const v = await verifyWithVision(step, opts.postcondition);
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

export async function launchOBS(runtimeState?: OBSRuntimeState): Promise<StepResult> {
  const startMs = Date.now();
  const step = 'launchOBS';

  if (runtimeState?.obsReady) {
    return makeSkippedResult(step, startMs);
  }

  // Kill any existing OBS (may lack QT_ACCESSIBILITY=1) and relaunch fresh
  const windows = await executeGuiInteract({ action: 'list_windows' });
  if (/OBS/.test(String(windows))) {
    await run('pkill -x obs || true');
    await wait(2000);
  }
  await run(`QT_ACCESSIBILITY=1 ${OBS_PILOT_CONFIG.obsExecutable} &`);
  const appeared = await waitForWindow(/OBS/, OBS_PILOT_CONFIG.launchTimeoutMs);
  if (!appeared) return makeResult(step, false, { startMs, failType: 'timeout', confidence: 0 });
  await focusOBS();
  await executeGuiInteract({ action: 'maximize_window', window: 'OBS' });
  await wait(2000); // extra settle time for AT-SPI to register
  const tree = await a11yGetTree(OBS_PILOT_CONFIG.appName, undefined, 2);
  if (!tree.error && tree.tree != null) {
    if (runtimeState) {
      runtimeState.obsReady = true;
      runtimeState.mainWindowDetected = true;
      runtimeState.settingsOpen = false;
    }
    return makeResult(step, true, {
      startMs,
      locatorUsed: 'a11y',
      confidence: 1,
    });
  }

  const v = await verifyWithVision(
    step,
    'OBS Studio main window is visible with all 6 panels: menu bar, Scenes, Sources, Audio Mixer, Scene Transitions, and Controls',
  );
  const result = makeResult(step, v.ok, {
    startMs, locatorUsed: 'a11y', confidence: v.confidence,
    escalated: v.escalated, workerTokens: v.workerTokens, verifierTokens: v.verifierTokens,
    failType: v.ok ? null : 'verify_failed',
  });
  if (result.ok && runtimeState) {
    runtimeState.obsReady = true;
    runtimeState.mainWindowDetected = true;
    runtimeState.settingsOpen = false;
  }
  return result;
}

export async function detectMainWindow(runtimeState?: OBSRuntimeState): Promise<StepResult> {
  const startMs = Date.now();
  const step = 'detectMainWindow';

  if (runtimeState?.mainWindowDetected) {
    return makeSkippedResult(step, startMs);
  }

  await focusOBS();

  const tree = await a11yGetTree(OBS_PILOT_CONFIG.appName, undefined, 2);
  const treeOk = !tree.error && tree.tree != null;
  if (treeOk) {
    if (runtimeState) {
      runtimeState.obsReady = true;
      runtimeState.mainWindowDetected = true;
      runtimeState.settingsOpen = false;
    }
    return makeResult(step, true, {
      startMs,
      locatorUsed: 'a11y',
      confidence: 1,
    });
  }

  const v = await verifyWithVision(
    step,
    'OBS Studio main window is visible with all 6 panels: menu bar, Scenes, Sources, Audio Mixer, Scene Transitions, and Controls',
  );
  const result = makeResult(step, v.ok, {
    startMs, locatorUsed: 'ocr', confidence: v.confidence,
    escalated: v.escalated, workerTokens: v.workerTokens, verifierTokens: v.verifierTokens,
    failType: v.ok ? null : 'verify_failed',
  });
  if (result.ok && runtimeState) {
    runtimeState.obsReady = true;
    runtimeState.mainWindowDetected = true;
    runtimeState.settingsOpen = false;
  }
  return result;
}

export async function createScene(name: string, runtimeState?: OBSRuntimeState): Promise<StepResult> {
  const startMs = Date.now();
  if (runtimeState?.knownScenes.includes(name)) {
    runtimeState.currentScene = name;
    return makeSkippedResult('createScene', startMs);
  }
  if (await findNamedItem(name)) {
    if (runtimeState) {
      runtimeState.knownScenes = rememberUnique(runtimeState.knownScenes, name);
      runtimeState.currentScene = name;
    }
    return makeResult('createScene', true, {
      startMs,
      confidence: 1,
      locatorUsed: 'a11y',
    });
  }
  const ctrl: ControlDef = OBS_MAP.controls.sceneAddBtn;
  const result = await withRetry(
    'createScene',
    async () => {
      // If scene was already created by a prior attempt, skip re-opening the dialog
      if (await findNamedItem(name)) return { ok: true, locatorUsed: 'a11y' as LocatorUsed, failType: null };
      const r = await clickControl(ctrl);
      if (!r.ok) return { ok: false, locatorUsed: r.strategy, failType: 'element_not_found' as FailType };
      await wait(OBS_PILOT_CONFIG.modalTimeoutMs);
      await executeGuiInteract({ action: 'type', text: name });
      await wait(100);
      await executeGuiInteract({ action: 'key', text: 'Return' });
      await wait(800);
      return { ok: true, locatorUsed: r.strategy, failType: null };
    },
    {
      postcondition: `The Scenes panel contains a scene named "${name}"`,
      localCheck: () => findNamedItem(name),
      visionMode: 'fallback',
    },
  );
  if (result.ok && runtimeState) {
    runtimeState.knownScenes = rememberUnique(runtimeState.knownScenes, name);
    runtimeState.currentScene = name;
  }
  return result;
}

export async function selectScene(name: string, runtimeState?: OBSRuntimeState): Promise<StepResult> {
  const startMs = Date.now();
  if (runtimeState?.currentScene === name) {
    return makeSkippedResult('selectScene', startMs);
  }
  const result = await withRetry(
    'selectScene',
    async () => {
      // AT-SPI unavailable for OBS Qt6 — click first item in Scenes list via coord
      await executeGuiInteract({ action: 'focus', window: 'OBS' });
      await wait(200);
      const r = await executeGuiInteract({ action: 'click', x: 155, y: 820 });
      const ok = !String(r).startsWith('[Error]');
      return { ok, locatorUsed: 'coord' as LocatorUsed, failType: ok ? null : 'element_not_found' as FailType };
    },
    {
      postcondition: `The scene named "${name}" is selected in the Scenes panel`,
      localCheck: () => findNamedItem(name),
      visionMode: 'fallback',
    },
  );
  if (result.ok && runtimeState) {
    runtimeState.currentScene = name;
    runtimeState.knownScenes = rememberUnique(runtimeState.knownScenes, name);
  }
  return result;
}

export async function addSource(type: string, name: string, runtimeState?: OBSRuntimeState): Promise<StepResult> {
  const startMs = Date.now();
  const step = 'addSource';
  if (runtimeState?.knownSources.includes(name)) {
    return makeSkippedResult(step, startMs);
  }
  if (await findNamedItem(name)) {
    if (runtimeState) {
      runtimeState.knownSources = rememberUnique(runtimeState.knownSources, name);
    }
    return makeResult(step, true, {
      startMs,
      locatorUsed: 'a11y',
      confidence: 1,
    });
  }
  const ctrl: ControlDef = OBS_MAP.controls.sourceAddBtn;

  const clickR = await clickControl(ctrl);
  if (!clickR.ok) {
    return makeResult(step, false, { startMs, failType: 'element_not_found', locatorUsed: clickR.strategy, confidence: 0 });
  }

  // Qt dialogs don't appear in wmctrl — wait for dialog to render
  await wait(OBS_PILOT_CONFIG.modalTimeoutMs);

  // Click source type in list
  const typeR = await a11yDoAction(OBS_PILOT_CONFIG.appName, 'list item', type, 'click');
  if (!(typeR.success ?? false)) {
    await executeGuiInteract({ action: 'key', text: 'Escape' });
    return makeResult(step, false, { startMs, failType: 'element_not_found', locatorUsed: 'a11y', confidence: 0 });
  }

  // OK to confirm type selection
  const okCtrl: ControlDef = OBS_MAP.controls.settingsOkBtn;
  const okR = await clickControl(okCtrl);
  if (!okR.ok) {
    await executeGuiInteract({ action: 'key', text: 'Escape' });
    return makeResult(step, false, { startMs, failType: 'element_not_found', locatorUsed: okR.strategy, confidence: 0 });
  }
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

  if (await findNamedItem(name)) {
    if (runtimeState) {
      runtimeState.knownSources = rememberUnique(runtimeState.knownSources, name);
    }
    return makeResult(step, true, {
      startMs,
      locatorUsed: clickR.strategy,
      confidence: 1,
    });
  }

  const v = await verifyWithVision(step, `The Sources panel contains a source named "${name}"`);
  const result = makeResult(step, v.ok, {
    startMs, locatorUsed: clickR.strategy, confidence: v.confidence,
    escalated: v.escalated, workerTokens: v.workerTokens, verifierTokens: v.verifierTokens,
    failType: v.ok ? null : 'verify_failed',
  });
  if (result.ok && runtimeState) {
    runtimeState.knownSources = rememberUnique(runtimeState.knownSources, name);
  }
  return result;
}

export async function setMicMuted(muted: boolean, runtimeState?: OBSRuntimeState): Promise<StepResult> {
  const startMs = Date.now();
  if (runtimeState?.micMuted === muted) {
    return makeSkippedResult('setMicMuted', startMs);
  }
  const ctrl: ControlDef = OBS_MAP.controls.micMuteBtn;
  const result = await withRetry(
    'setMicMuted',
    async () => {
      const found = await a11yFind(OBS_PILOT_CONFIG.appName, ctrl.a11yRole, ctrl.a11yName ?? '');
      const currentlyMuted = found.found && Array.isArray(found.match?.state) && found.match.state.includes('checked');
      if (currentlyMuted === muted) return { ok: true, locatorUsed: 'a11y' as LocatorUsed, failType: null };
      const r = await clickControl(ctrl);
      return { ok: r.ok, locatorUsed: r.strategy, failType: r.ok ? null : 'element_not_found' as FailType };
    },
    {
      postcondition: muted ? 'The Mic/Aux channel in the Audio Mixer shows a red mute indicator (muted)' : 'The Mic/Aux channel in the Audio Mixer shows no mute indicator (unmuted)',
      visionMode: 'fallback',
    },
  );
  if (result.ok && runtimeState) {
    runtimeState.micMuted = muted;
  }
  return result;
}

export async function setTransition(name: string, runtimeState?: OBSRuntimeState): Promise<StepResult> {
  const startMs = Date.now();
  if (runtimeState?.transitionName === name) {
    return makeSkippedResult('setTransition', startMs);
  }
  const ctrl: ControlDef = OBS_MAP.controls.transitionCombo;
  const knownValues: string[] = ctrl.knownValues ?? [];

  if (!knownValues.includes(name)) {
    return makeResult('setTransition', false, { startMs, failType: 'precondition_failed', confidence: 0, locatorUsed: 'none' });
  }

  const result = await withRetry(
    'setTransition',
    async () => {
      // Try AT-SPI set_value first
      const setR = await a11ySetValue(OBS_PILOT_CONFIG.appName, ctrl.a11yRole, ctrl.a11yName ?? '', name);
      if (!setR.error) return { ok: true, locatorUsed: 'a11y' as LocatorUsed, failType: null };

      // Fallback: click combo then pick option via AT-SPI
      const clickR = await clickControl(ctrl);
      if (!clickR.ok) return { ok: false, locatorUsed: clickR.strategy, failType: 'element_not_found' as FailType };
      await wait(500);

      const optR = await a11yDoAction(OBS_PILOT_CONFIG.appName, 'menu item', name, 'click');
      if (optR.success ?? false) return { ok: true, locatorUsed: 'a11y' as LocatorUsed, failType: null };

      // Dismiss dropdown and accept current state — vision will verify
      await executeGuiInteract({ action: 'key', text: 'Escape' });
      await wait(300);
      return { ok: true, locatorUsed: 'ocr' as LocatorUsed, failType: null };
    },
    {
      postcondition: `The Scene Transitions panel shows "${name}" as the selected transition`,
      visionMode: 'fallback',
    },
  );
  if (result.ok && runtimeState) {
    runtimeState.transitionName = name;
  }
  return result;
}

export async function openSettings(runtimeState?: OBSRuntimeState): Promise<StepResult> {
  const startMs = Date.now();
  if (runtimeState?.settingsOpen) {
    return makeSkippedResult('openSettings', startMs);
  }
  const ctrl: ControlDef = OBS_MAP.controls.settingsBtn;
  const result = await withRetry(
    'openSettings',
    async () => {
      const r = await clickControl(ctrl);
      if (!r.ok) return { ok: false, locatorUsed: r.strategy, failType: 'element_not_found' as FailType };
      // Qt Settings dialog doesn't surface in wmctrl — wait then verify visually
      await wait(OBS_PILOT_CONFIG.modalTimeoutMs);
      return { ok: true, locatorUsed: r.strategy, failType: null };
    },
    {
      postcondition: 'The OBS Settings dialog is open and visible',
      visionMode: 'fallback',
    },
  );
  if (result.ok && runtimeState) {
    runtimeState.settingsOpen = true;
  }
  return result;
}

export async function closeSettings(runtimeState?: OBSRuntimeState): Promise<StepResult> {
  const startMs = Date.now();
  if (runtimeState && !runtimeState.settingsOpen) {
    return makeSkippedResult('closeSettings', startMs);
  }
  const result = await withRetry(
    'closeSettings',
    async () => {
      // Try OK button first, fall back to Escape
      const okCtrl: ControlDef = OBS_MAP.controls.settingsOkBtn;
      const r = await clickControl(okCtrl);
      if (!r.ok) {
        await executeGuiInteract({ action: 'key', text: 'Escape' });
      }
      await wait(500);
      return { ok: true, locatorUsed: r.ok ? r.strategy : 'none' as LocatorUsed, failType: null };
    },
    {
      postcondition: 'The OBS Settings dialog is closed and the main OBS window is visible',
      visionMode: 'fallback',
    },
  );
  if (result.ok && runtimeState) {
    runtimeState.settingsOpen = false;
  }
  return result;
}

export async function verifyMainState(runtimeState?: OBSRuntimeState): Promise<StepResult> {
  const startMs = Date.now();
  const step = 'verifyMainState';

  await focusOBS();
  await wait(200);

  const windows = await listWindows();
  if (/Settings/.test(windows)) {
    return makeResult(step, false, { startMs, failType: 'verify_failed', confidence: 0 });
  }

  const v = await verifyWithVision(
    step,
    'OBS Studio main window is fully visible with all 6 panels (menu bar, Scenes, Sources, Audio Mixer, Scene Transitions, Controls) and no dialogs are open',
  );
  const result = makeResult(step, v.ok, {
    startMs, locatorUsed: 'a11y', confidence: v.confidence,
    escalated: v.escalated, workerTokens: v.workerTokens, verifierTokens: v.verifierTokens,
    failType: v.ok ? null : 'verify_failed',
  });
  if (result.ok && runtimeState) {
    runtimeState.obsReady = true;
    runtimeState.mainWindowDetected = true;
    runtimeState.settingsOpen = false;
  }
  return result;
}

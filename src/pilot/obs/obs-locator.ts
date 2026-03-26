// src/pilot/obs/obs-locator.ts
import * as fs from 'fs';
import { executeGuiInteract } from '../../main/core/desktop';
import { captureScreen, runOcr } from '../../main/core/desktop/screenshot';
import { a11yDoAction } from '../../main/core/desktop/a11y';
import { wait } from '../../main/core/desktop/shared';
import type { ControlDef, LocatorUsed } from './obs-types';
import { OBS_PILOT_CONFIG } from './obs-config';

export interface A11yQuery {
  appName: string;
  role: string;
  name: string;
}

export function selectLocatorStrategy(ctrl: ControlDef): LocatorUsed {
  if (ctrl.a11yRole) return 'a11y';
  if (ctrl.ocrFallback) return 'ocr';
  return 'coord';
}

export function buildA11yQuery(appName: string, ctrl: ControlDef): A11yQuery {
  return { appName, role: ctrl.a11yRole, name: ctrl.a11yName ?? '' };
}

/**
 * Click a control via AT-SPI do_action, falling back to OCR coord click.
 */
export async function clickControl(
  ctrl: ControlDef,
  appName = OBS_PILOT_CONFIG.appName,
): Promise<{ ok: boolean; strategy: LocatorUsed; error?: string }> {
  if (ctrl.a11yRole) {
    const result = await a11yDoAction(appName, ctrl.a11yRole, ctrl.a11yName ?? '', 'click');
    if (result.success) {
      await wait(OBS_PILOT_CONFIG.actionDelayMs);
      return { ok: true, strategy: 'a11y' };
    }
  }

  if (ctrl.ocrFallback) {
    const { path: imgPath, error: capErr } = await captureScreen({});
    if (capErr || !imgPath) return { ok: false, strategy: 'ocr', error: capErr ?? 'screenshot failed' };
    const ocr = await runOcr(imgPath, 'OBS');
    if (ocr) {
      const target = ocr.targets.find(
        (t) => t.label.toLowerCase().includes(ctrl.ocrFallback.toLowerCase()),
      );
      if (target) {
        await executeGuiInteract({ action: 'click', x: target.x, y: target.y });
        await wait(OBS_PILOT_CONFIG.actionDelayMs);
        return { ok: true, strategy: 'ocr' };
      }
    }
    return { ok: false, strategy: 'ocr', error: `OCR: label "${ctrl.ocrFallback}" not found` };
  }

  return { ok: false, strategy: 'none', error: 'No click strategy available' };
}

/**
 * Take a full screenshot and return it as a base64 PNG string.
 */
export async function screenshotBase64(): Promise<string | null> {
  const { path: imgPath, error } = await captureScreen({});
  if (error || !imgPath) return null;
  try {
    return fs.readFileSync(imgPath).toString('base64');
  } catch {
    return null;
  }
}

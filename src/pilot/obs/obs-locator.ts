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

interface CachedTarget {
  x: number;
  y: number;
  expiresAt: number;
}

const ocrTargetCache = new Map<string, CachedTarget>();

export function selectLocatorStrategy(ctrl: ControlDef): LocatorUsed {
  if (ctrl.a11yRole) return 'a11y';
  if (ctrl.ocrFallback) return 'ocr';
  if (ctrl.relative) return 'relative';
  return 'coord';
}

export function buildA11yQuery(appName: string, ctrl: ControlDef): A11yQuery {
  return { appName, role: ctrl.a11yRole, name: ctrl.a11yName ?? '' };
}

export function getRelativePoint(ctrl: ControlDef): { x: number; y: number } {
  const [rx, ry] = ctrl.relative ?? [0, 0];
  return { x: rx, y: ry + OBS_PILOT_CONFIG.contentYOffset };
}

function getLocatorPoint(ctrl: ControlDef): { x: number; y: number } | null {
  if (ctrl.coord) {
    const [x, y] = ctrl.coord;
    return { x, y };
  }
  if (ctrl.relative) return getRelativePoint(ctrl);
  return null;
}

function getCacheKey(ctrl: ControlDef): string | null {
  const fallback = ctrl.ocrFallback?.trim().toLowerCase();
  if (!fallback) return null;
  const point = getLocatorPoint(ctrl);
  return point ? `${fallback}@${point.x},${point.y}` : fallback;
}

function getCachedTarget(ctrl: ControlDef): { x: number; y: number } | null {
  const key = getCacheKey(ctrl);
  if (!key) return null;
  const cached = ocrTargetCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    ocrTargetCache.delete(key);
    return null;
  }
  return { x: cached.x, y: cached.y };
}

function cacheTarget(ctrl: ControlDef, x: number, y: number): void {
  const key = getCacheKey(ctrl);
  if (!key) return;
  ocrTargetCache.set(key, {
    x,
    y,
    expiresAt: Date.now() + OBS_PILOT_CONFIG.ocrCacheTtlMs,
  });
}

function getOcrRegion(ctrl: ControlDef): { x: number; y: number; w: number; h: number } | undefined {
  const point = getLocatorPoint(ctrl);
  if (!point) return undefined;
  const pad = OBS_PILOT_CONFIG.ocrRegionPaddingPx;
  return {
    x: Math.max(0, point.x - pad),
    y: Math.max(0, point.y - pad),
    w: pad * 2,
    h: pad * 2,
  };
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

  const ocrFallback = ctrl.ocrFallback?.trim() ?? '';
  if (ocrFallback.length >= 2) {
    const cached = getCachedTarget(ctrl);
    if (cached) {
      await executeGuiInteract({ action: 'click', x: cached.x, y: cached.y });
      await wait(OBS_PILOT_CONFIG.actionDelayMs);
      return { ok: true, strategy: 'ocr' };
    }

    const region = getOcrRegion(ctrl);
    const { path: imgPath, error: capErr } = await captureScreen(region ? { region } : {});
    if (!capErr && imgPath) {
      const ocr = await runOcr(imgPath, 'OBS');
      if (ocr) {
        const target = ocr.targets.find(
          (t) => t.label.toLowerCase().includes(ocrFallback.toLowerCase()),
        );
        if (target) {
          const x = region ? target.x + region.x : target.x;
          const y = region ? target.y + region.y : target.y;
          cacheTarget(ctrl, x, y);
          await executeGuiInteract({ action: 'click', x, y });
          await wait(OBS_PILOT_CONFIG.actionDelayMs);
          return { ok: true, strategy: 'ocr' };
        }
      }
    }
    // OCR did not find the label — fall through to coord
  }

  if (ctrl.coord) {
    const [x, y] = ctrl.coord;
    await executeGuiInteract({ action: 'click', x, y });
    await wait(OBS_PILOT_CONFIG.actionDelayMs);
    return { ok: true, strategy: 'coord' };
  }

  if (ctrl.relative) {
    const { x, y } = getRelativePoint(ctrl);
    await executeGuiInteract({ action: 'click', x, y });
    await wait(OBS_PILOT_CONFIG.actionDelayMs);
    return { ok: true, strategy: 'relative' };
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

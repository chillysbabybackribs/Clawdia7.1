#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { captureScreen } from '../main/core/desktop/screenshot';
import { detectMonitors } from '../main/core/desktop/screen-map';
import { run, runSeparate, wait } from '../main/core/desktop/shared';
import {
  readPngPixelRecord,
  type KdenlivePhaseSessionRecord,
} from './kdenlive-phase12';

interface WindowContext {
  windowId: string;
  appName: string;
  windowTitle: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function printHelp(): void {
  process.stdout.write([
    'Usage: node dist/pilot/run-kdenlive-phase12.js [options]',
    '',
    'Kdenlive-only clean mapping runner.',
    'This path always launches a fresh Kdenlive instance.',
    '',
    'Options:',
    '  --app <binary>         App binary to launch. Default: kdenlive',
    '  --help                 Print help and exit',
  ].join('\n') + '\n');
}

function timestampForDir(iso: string): string {
  return iso.replace(/[:.]/g, '-');
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isRealKdenliveWindow(window: WindowContext): boolean {
  return window.appName.toLowerCase() === 'kdenlive.kdenlive'
    || window.windowTitle.toLowerCase().endsWith('kdenlive');
}

async function listKdenliveWindows(): Promise<WindowContext[]> {
  const { stdout } = await runSeparate('wmctrl -lxG');
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const windows: WindowContext[] = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;
    const [windowId, , x, y, width, height, , appClass, ...titleParts] = parts;
    const candidate: WindowContext = {
      windowId,
      appName: appClass,
      windowTitle: titleParts.join(' ').trim(),
      bounds: {
        x: Number.parseInt(x, 10),
        y: Number.parseInt(y, 10),
        width: Number.parseInt(width, 10),
        height: Number.parseInt(height, 10),
      },
    };
    if (!isRealKdenliveWindow(candidate)) continue;
    windows.push(candidate);
  }

  return windows.sort((left, right) => {
    const rightArea = right.bounds.width * right.bounds.height;
    const leftArea = left.bounds.width * left.bounds.height;
    return rightArea - leftArea;
  });
}

async function waitForMainKdenliveWindow(timeoutMs = 20000): Promise<WindowContext> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const windows = await listKdenliveWindows();
    if (windows.length > 0) return windows[0];
    await wait(250);
  }
  throw new Error('Timed out waiting for a real Kdenlive window');
}

async function closeExistingKdenlive(): Promise<void> {
  await run('pkill -x kdenlive || true');
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    const windows = await listKdenliveWindows();
    if (windows.length === 0) return;
    await wait(250);
  }
}

function launchFreshKdenlive(appBinary: string): void {
  const child = spawn(appBinary, [], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function forceFullscreen(window: WindowContext): Promise<WindowContext> {
  await run(`wmctrl -i -a ${window.windowId}`);
  await wait(250);
  await run(`wmctrl -i -r ${window.windowId} -b add,fullscreen`);
  await wait(600);
  return waitForMainKdenliveWindow();
}

function verifyFullscreenLikeWindow(window: WindowContext, monitor: { width: number; height: number }): void {
  const widthRatio = window.bounds.width / Math.max(1, monitor.width);
  const heightRatio = window.bounds.height / Math.max(1, monitor.height);
  if (widthRatio < 0.9 || heightRatio < 0.9) {
    throw new Error(
      `Kdenlive window is not fullscreen-like enough: ` +
      `${window.bounds.width}x${window.bounds.height} on ${monitor.width}x${monitor.height}`,
    );
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    printHelp();
    return;
  }

  const launchedAt = new Date().toISOString();
  const appBinary = arg('--app') ?? 'kdenlive';
  const artifactRoot = path.join(process.cwd(), 'artifacts', 'app-mapping', 'kdenlive', 'phase12');
  const runDir = path.join(artifactRoot, 'runs', timestampForDir(launchedAt));
  ensureDir(runDir);

  await closeExistingKdenlive();
  launchFreshKdenlive(appBinary);

  const launchedWindow = await waitForMainKdenliveWindow();
  const fullscreenWindow = await forceFullscreen(launchedWindow);

  const monitors = await detectMonitors();
  const monitor = monitors[0] ?? {
    name: 'default',
    width: fullscreenWindow.bounds.width,
    height: fullscreenWindow.bounds.height,
    originX: 0,
    originY: 0,
  };
  verifyFullscreenLikeWindow(fullscreenWindow, monitor);

  const fullCapture = await captureScreen({});
  if (fullCapture.error || !fullCapture.path) {
    throw new Error(`Unable to capture full screenshot: ${fullCapture.error ?? 'unknown error'}`);
  }

  const fullScreenshotPath = path.join(runDir, 'full-monitor.png');
  fs.copyFileSync(fullCapture.path, fullScreenshotPath);

  const pixelRecordPath = path.join(runDir, 'pixel-record.json');
  const pixelRecord = readPngPixelRecord(fullScreenshotPath);
  writeJson(pixelRecordPath, pixelRecord);

  const sessionPath = path.join(runDir, 'session.json');
  const sessionRecord: KdenlivePhaseSessionRecord = {
    targetApp: 'kdenlive',
    appBinary,
    windowTitle: fullscreenWindow.windowTitle,
    launchedAt,
    layoutRequested: 'fullscreen',
    monitor,
    windowBounds: fullscreenWindow.bounds,
    fullScreenshotPath,
    pixelRecordPath,
    legacyInputsIgnored: ['obs', 'gimp'],
    phaseGate: {
      currentPhase: 2,
      phase1: 'complete',
      phase2: 'complete',
      phase3: 'blocked_until_confirmation',
    },
  };
  writeJson(sessionPath, sessionRecord);

  writeJson(path.join(runDir, 'phase-report.json'), {
    ok: true,
    appId: 'kdenlive',
    runDir,
    sessionPath,
    fullScreenshotPath,
    pixelRecordPath,
    phaseGate: sessionRecord.phaseGate,
    legacyInputsIgnored: sessionRecord.legacyInputsIgnored,
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    appId: 'kdenlive',
    runDir,
    sessionPath,
    fullScreenshotPath,
    pixelRecordPath,
    phaseGate: sessionRecord.phaseGate,
  }, null, 2)}\n`);
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});

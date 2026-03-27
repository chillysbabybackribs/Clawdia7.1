#!/usr/bin/env node
// src/pilot/run-screen-map.ts
//
// CLI for interactive screen mapping sessions.
//
// Usage:
//   node dist/pilot/run-screen-map.js --app obs --desc "OBS bottom panels"
//   node dist/pilot/run-screen-map.js --load ./maps/obs-map.smap.json --annotate
//   node dist/pilot/run-screen-map.js --app obs --auto-map  (agent-driven, no stdin)
//
// Interactive commands (when running without --auto-map):
//   s                  — take screenshot now
//   a <x> <y> <label>  — add point at x,y with label
//   r <label>          — remove point by label
//   l                  — list all points
//   x                  — export annotated PNG
//   q                  — quit and save
//
// Agent-driven (--auto-map):
//   Pass newline-delimited JSON commands on stdin:
//   {"cmd":"add","x":22,"y":1030,"label":"Scenes + btn","action":"click","screenshot":true}
//   {"cmd":"screenshot"}
//   {"cmd":"export"}
//   {"cmd":"quit"}

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import {
  beginSession,
  captureBaseline,
  addPoint,
  captureAtPoint,
  removePoint,
  exportAnnotatedScreenshot,
  saveSession,
  loadSession,
  sessionSummary,
  detectMonitors,
} from '../main/core/desktop/screen-map';
import type { ScreenMapSession } from '../main/core/desktop/screen-map-types';

// ─── CLI argument parsing ─────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

// ─── Output helpers ───────────────────────────────────────────────────────────

function out(msg: string): void {
  process.stdout.write(msg + '\n');
}

function jsonOut(obj: unknown): void {
  out(JSON.stringify(obj));
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleScreenshot(session: ScreenMapSession, agentMode: boolean): Promise<void> {
  try {
    const { screenshotPath } = await captureAtPoint(session);
    if (agentMode) {
      jsonOut({ event: 'screenshot', path: screenshotPath });
    } else {
      out(`📸 Screenshot: ${screenshotPath}`);
    }
  } catch (e: any) {
    if (agentMode) jsonOut({ event: 'error', message: e.message });
    else out(`Error: ${e.message}`);
  }
}

async function handleAdd(
  session: ScreenMapSession,
  x: number,
  y: number,
  label: string,
  action: MapPoint['action'] = 'manual',
  withShot = false,
  agentMode = false,
  notes?: string,
): Promise<void> {
  try {
    const point = await addPoint(session, { x, y, label, action, captureScreenshot: withShot, notes });
    if (agentMode) {
      jsonOut({ event: 'point_added', id: point.id, label, x, y, screenshotPath: point.screenshotPath });
    } else {
      out(`✓ Added [${label}] at (${x}, ${y})  id=${point.id}`);
      if (point.screenshotPath) out(`  Screenshot: ${point.screenshotPath}`);
      if (point.windowContext) {
        const wc = point.windowContext;
        out(`  Window: "${wc.windowTitle}" bounds=(${wc.bounds.x},${wc.bounds.y} ${wc.bounds.width}x${wc.bounds.height})`);
        if (point.relativeX != null) out(`  Relative: (${point.relativeX}, ${point.relativeY})`);
      }
    }
  } catch (e: any) {
    if (agentMode) jsonOut({ event: 'error', message: e.message });
    else out(`Error: ${e.message}`);
  }
}

async function handleExport(
  session: ScreenMapSession,
  outputDir: string,
  agentMode: boolean,
): Promise<void> {
  // Save JSON
  const jsonPath = path.join(outputDir, `${session.appName}-map.smap.json`);
  saveSession(session, jsonPath);

  // Annotated PNG
  let pngPath: string | undefined;
  try {
    pngPath = await exportAnnotatedScreenshot(session, {
      outputPath: path.join(outputDir, `${session.appName}-map-annotated.png`),
    });
  } catch (e: any) {
    if (!agentMode) out(`Warning: annotated PNG failed — ${e.message}`);
  }

  if (agentMode) {
    jsonOut({ event: 'exported', jsonPath, pngPath, pointCount: session.points.length });
  } else {
    out(`\nExported:`);
    out(`  JSON: ${jsonPath}`);
    if (pngPath) out(`  PNG:  ${pngPath}`);
    out(`  Points: ${session.points.length}`);
  }
}

// ─── Interactive REPL ─────────────────────────────────────────────────────────

async function runInteractive(session: ScreenMapSession, outputDir: string): Promise<void> {
  out('\nScreen Mapping Session — Interactive Mode');
  out('─────────────────────────────────────────');
  out(`App: ${session.appName}  |  ${session.description}`);
  out(
    `Monitors: ${session.monitors.map((m) => `${m.name} ${m.width}x${m.height}`).join(', ')}`,
  );
  out('');
  out('Commands:');
  out('  s                  — screenshot');
  out('  a <x> <y> <label>  — add point');
  out('  a <x> <y> <label> --shot  — add point + screenshot');
  out('  r <label>          — remove point');
  out('  l                  — list points');
  out('  x                  — export (JSON + annotated PNG)');
  out('  q                  — quit and save');
  out('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = (): void => rl.question('map> ', async (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    switch (cmd) {
      case 's': {
        await handleScreenshot(session, false);
        break;
      }
      case 'a': {
        const x = parseInt(parts[1]);
        const y = parseInt(parts[2]);
        if (isNaN(x) || isNaN(y)) { out('Usage: a <x> <y> <label>'); break; }
        const withShot = parts.includes('--shot');
        const labelParts = parts.slice(3).filter((p) => p !== '--shot');
        const label = labelParts.join(' ') || `point_${session.points.length + 1}`;
        await handleAdd(session, x, y, label, 'manual', withShot, false);
        break;
      }
      case 'r': {
        const label = parts.slice(1).join(' ');
        const removed = removePoint(session, label);
        out(removed ? `Removed: ${label}` : `Not found: ${label}`);
        break;
      }
      case 'l': {
        out(sessionSummary(session));
        break;
      }
      case 'x': {
        await handleExport(session, outputDir, false);
        break;
      }
      case 'q': {
        await handleExport(session, outputDir, false);
        out('Goodbye.');
        rl.close();
        return;
      }
      case '': {
        break;
      }
      default: {
        out(`Unknown command: ${cmd}`);
      }
    }

    prompt();
  });

  prompt();
  await new Promise<void>((resolve) => rl.on('close', resolve));
}

// ─── Agent mode (JSON commands on stdin) ─────────────────────────────────────

type AgentCmd =
  | { cmd: 'add'; x: number; y: number; label: string; action?: MapPoint['action']; screenshot?: boolean; notes?: string }
  | { cmd: 'screenshot' }
  | { cmd: 'export' }
  | { cmd: 'list' }
  | { cmd: 'remove'; label: string }
  | { cmd: 'quit' };

type MapPoint = import('../main/core/desktop/screen-map-types').MapPoint;

async function runAgentMode(session: ScreenMapSession, outputDir: string): Promise<void> {
  jsonOut({ event: 'session_started', id: session.id, monitors: session.monitors });

  const rl = readline.createInterface({ input: process.stdin });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let cmd: AgentCmd;
    try {
      cmd = JSON.parse(trimmed) as AgentCmd;
    } catch {
      jsonOut({ event: 'error', message: `Invalid JSON: ${trimmed}` });
      continue;
    }

    switch (cmd.cmd) {
      case 'add':
        await handleAdd(session, cmd.x, cmd.y, cmd.label, cmd.action, cmd.screenshot, true, cmd.notes);
        break;
      case 'screenshot':
        await handleScreenshot(session, true);
        break;
      case 'export':
        await handleExport(session, outputDir, true);
        break;
      case 'list':
        jsonOut({ event: 'list', summary: sessionSummary(session), points: session.points });
        break;
      case 'remove':
        jsonOut({ event: 'remove', removed: removePoint(session, cmd.label) });
        break;
      case 'quit':
        await handleExport(session, outputDir, true);
        jsonOut({ event: 'done', pointCount: session.points.length });
        process.exit(0);
    }
  }

  // stdin closed
  await handleExport(session, outputDir, true);
  jsonOut({ event: 'done', pointCount: session.points.length });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const appName   = arg('--app') ?? 'unknown';
  const desc      = arg('--desc') ?? '';
  const loadPath  = arg('--load');
  const outDir    = arg('--out') ?? path.join(process.cwd(), 'maps');
  const annotate  = flag('--annotate');
  const agentMode = flag('--agent');
  const listMons  = flag('--monitors');

  // --monitors: just print monitor info and exit
  if (listMons) {
    const monitors = await detectMonitors();
    out(JSON.stringify(monitors, null, 2));
    return;
  }

  // --load + --annotate: re-annotate an existing session
  if (loadPath && annotate) {
    const session = loadSession(loadPath);
    const pngPath = await exportAnnotatedScreenshot(session, {
      outputPath: path.join(outDir, `${session.appName}-map-annotated.png`),
    });
    out(`Annotated: ${pngPath}`);
    return;
  }

  // Start or resume session
  let session: ScreenMapSession;
  if (loadPath && fs.existsSync(loadPath)) {
    session = loadSession(loadPath);
    out(`Loaded session: ${session.id} (${session.points.length} existing points)`);
  } else {
    session = await beginSession({ appName, description: desc });
    out(`Started session: ${session.id}`);
    out('Capturing baseline screenshot...');
    const baseline = await captureBaseline(session);
    out(`Baseline: ${baseline}`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  if (agentMode) {
    await runAgentMode(session, outDir);
  } else {
    await runInteractive(session, outDir);
  }
}

main().catch((err) => {
  process.stderr.write(`[Fatal] ${err.message}\n`);
  process.exit(1);
});

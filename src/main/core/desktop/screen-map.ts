// src/main/core/desktop/screen-map.ts
//
// Screen mapping session engine.
//
// Usage:
//   const session = await beginSession({ appName: 'myapp', description: 'Main window controls' });
//   await captureBaseline(session);
//   await addPoint(session, { x: 22, y: 1030, label: 'Add button', action: 'click' });
//   const shot = await captureAtPoint(session, pointId);
//   const exported = exportSession(session);          // JSON string
//   saveSession(session, '/path/to/file.json');        // write to disk

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { run, runSeparate } from './shared';
import { captureScreen } from './screenshot';
import type {
  ScreenMapSession,
  MapPoint,
  MonitorInfo,
  WindowContext,
} from './screen-map-types';

// ─── Monitor detection ────────────────────────────────────────────────────────

/** Parse connected monitors from xrandr output. */
export async function detectMonitors(): Promise<MonitorInfo[]> {
  const { stdout } = await runSeparate('xrandr 2>/dev/null');
  const monitors: MonitorInfo[] = [];

  // Match: HDMI-1-0 connected 2560x1080+0+0
  const re = /^(\S+)\s+connected\s+(?:primary\s+)?(\d+)x(\d+)\+(-?\d+)\+(-?\d+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stdout)) !== null) {
    const [, name, w, h, ox, oy] = m;
    monitors.push({
      name,
      width: parseInt(w),
      height: parseInt(h),
      originX: parseInt(ox),
      originY: parseInt(oy),
    });
  }

  // Fallback: single virtual screen from xdpyinfo
  if (monitors.length === 0) {
    const { stdout: dpy } = await runSeparate('xdpyinfo 2>/dev/null | grep dimensions');
    const dm = dpy.match(/(\d+)x(\d+)/);
    if (dm) {
      monitors.push({ name: 'default', width: parseInt(dm[1]), height: parseInt(dm[2]), originX: 0, originY: 0 });
    }
  }

  return monitors;
}

/** Return the monitor that contains point (x, y). */
export function monitorForPoint(monitors: MonitorInfo[], x: number, y: number): MonitorInfo | undefined {
  return monitors.find(
    (m) => x >= m.originX && x < m.originX + m.width && y >= m.originY && y < m.originY + m.height,
  );
}

// ─── Window context detection ─────────────────────────────────────────────────

/** Get the currently focused window bounds via xdotool. */
async function getFocusedWindowContext(appName?: string): Promise<WindowContext | undefined> {
  try {
    // Get focused window id
    const { stdout: idOut } = await runSeparate('xdotool getactivewindow 2>/dev/null');
    const winId = idOut.trim();
    if (!winId || winId.startsWith('[')) return undefined;

    const { stdout: geo } = await runSeparate(
      `xdotool getwindowgeometry --shell ${winId} 2>/dev/null`,
    );
    const title_r = await runSeparate(`xdotool getwindowname ${winId} 2>/dev/null`);
    const classOut = await runSeparate(
      `xprop -id ${winId} WM_CLASS 2>/dev/null`,
    );

    const x = parseInt((geo.match(/X=(\d+)/) || [])[1] ?? '0');
    const y = parseInt((geo.match(/Y=(\d+)/) || [])[1] ?? '0');
    const w = parseInt((geo.match(/WIDTH=(\d+)/) || [])[1] ?? '0');
    const h = parseInt((geo.match(/HEIGHT=(\d+)/) || [])[1] ?? '0');
    const title = title_r.stdout.trim();
    const classMatch = classOut.stdout.match(/"([^"]+)"/);
    const detectedApp = classMatch?.[1]?.toLowerCase() ?? appName ?? 'unknown';

    return {
      appName: detectedApp,
      windowTitle: title,
      bounds: { x, y, width: w, height: h },
    };
  } catch {
    return undefined;
  }
}

// ─── Session lifecycle ────────────────────────────────────────────────────────

let _sessionCounter = 0;

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++_sessionCounter}`;
}

export async function beginSession(opts: {
  appName: string;
  description?: string;
}): Promise<ScreenMapSession> {
  const monitors = await detectMonitors();
  const now = new Date().toISOString();
  return {
    id: newId('smap'),
    createdAt: now,
    updatedAt: now,
    appName: opts.appName,
    description: opts.description ?? '',
    monitors,
    points: [],
  };
}

/** Take a full-virtual-screen baseline screenshot and attach it to the session. */
export async function captureBaseline(session: ScreenMapSession): Promise<string> {
  const result = await captureScreen({});
  if (result.error || !result.path) {
    throw new Error(`Baseline screenshot failed: ${result.error}`);
  }
  session.baselineScreenshot = result.path;
  session.updatedAt = new Date().toISOString();
  return result.path;
}

// ─── Point management ─────────────────────────────────────────────────────────

export async function addPoint(
  session: ScreenMapSession,
  opts: {
    x: number;
    y: number;
    label: string;
    action?: MapPoint['action'];
    notes?: string;
    captureScreenshot?: boolean;
  },
): Promise<MapPoint> {
  const action = opts.action ?? 'manual';
  const monitor = monitorForPoint(session.monitors, opts.x, opts.y);
  const winCtx = await getFocusedWindowContext(session.appName).catch(() => undefined);

  let relativeX: number | undefined;
  let relativeY: number | undefined;
  if (winCtx) {
    relativeX = opts.x - winCtx.bounds.x;
    relativeY = opts.y - winCtx.bounds.y;
  }

  let screenshotPath: string | undefined;
  if (opts.captureScreenshot) {
    const shot = await captureScreen({});
    if (!shot.error) screenshotPath = shot.path;
  }

  const point: MapPoint = {
    id: newId('pt'),
    x: opts.x,
    y: opts.y,
    timestampMs: Date.now(),
    label: opts.label,
    action,
    monitorName: monitor?.name ?? 'unknown',
    windowContext: winCtx,
    screenshotPath,
    relativeX,
    relativeY,
    notes: opts.notes,
  };

  session.points.push(point);
  session.updatedAt = new Date().toISOString();
  return point;
}

/** Take a screenshot and attach it to the most recent point (or a named point). */
export async function captureAtPoint(
  session: ScreenMapSession,
  pointId?: string,
): Promise<{ point: MapPoint; screenshotPath: string }> {
  const point = pointId
    ? session.points.find((p) => p.id === pointId)
    : session.points[session.points.length - 1];

  if (!point) throw new Error('No point found to attach screenshot to');

  const shot = await captureScreen({});
  if (shot.error || !shot.path) throw new Error(`Screenshot failed: ${shot.error}`);

  point.screenshotPath = shot.path;
  session.updatedAt = new Date().toISOString();
  return { point, screenshotPath: shot.path };
}

/** Remove a point by id or label. */
export function removePoint(session: ScreenMapSession, idOrLabel: string): boolean {
  const before = session.points.length;
  session.points = session.points.filter(
    (p) => p.id !== idOrLabel && p.label !== idOrLabel,
  );
  if (session.points.length < before) {
    session.updatedAt = new Date().toISOString();
    return true;
  }
  return false;
}

/** Look up a point by label (case-insensitive). */
export function findPoint(session: ScreenMapSession, label: string): MapPoint | undefined {
  const q = label.toLowerCase();
  return session.points.find((p) => p.label.toLowerCase() === q);
}

// ─── Export / serialisation ───────────────────────────────────────────────────

export function exportSession(session: ScreenMapSession): string {
  return JSON.stringify(session, null, 2);
}

export function saveSession(session: ScreenMapSession, filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, exportSession(session), 'utf-8');
}

export function loadSession(filePath: string): ScreenMapSession {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ScreenMapSession;
}

// ─── Annotated screenshot export ─────────────────────────────────────────────

/**
 * Render a PNG with all session points overlaid as labelled red circles.
 * Requires ImageMagick `convert`.
 */
export async function exportAnnotatedScreenshot(
  session: ScreenMapSession,
  opts: {
    /** Source image — defaults to session.baselineScreenshot */
    sourceImage?: string;
    /** Output path — defaults to /tmp/smap-annotated-<id>.png */
    outputPath?: string;
    /** Only annotate points with these labels (undefined = all) */
    filter?: string[];
  } = {},
): Promise<string> {
  const src = opts.sourceImage ?? session.baselineScreenshot;
  if (!src || !fs.existsSync(src)) {
    throw new Error('No source image available. Call captureBaseline() first.');
  }

  const out = opts.outputPath ?? path.join(os.tmpdir(), `smap-annotated-${session.id}.png`);

  const points = opts.filter
    ? session.points.filter((p) => opts.filter!.includes(p.label))
    : session.points;

  if (points.length === 0) {
    // Nothing to annotate — just copy
    fs.copyFileSync(src, out);
    return out;
  }

  // Build ImageMagick draw commands
  // Each point: red circle (r=12) + white label below
  const drawCmds = points.flatMap((p, i) => {
    const r = 12;
    const lx = p.x - r;
    const ly = p.y - r;
    const rx = p.x + r;
    const ry = p.y + r;
    const labelX = p.x + 16;
    const labelY = p.y + 4;
    const escaped = p.label.replace(/'/g, "\\'").replace(/"/g, '\\"');
    const num = i + 1;
    return [
      `-fill none -stroke red -strokewidth 2 -draw "circle ${p.x},${p.y} ${p.x},${p.y - r}"`,
      `-fill red -stroke none -draw "circle ${p.x},${p.y} ${p.x + 4},${p.y}"`,
      `-fill white -stroke black -strokewidth 1 -font DejaVu-Sans -pointsize 13 -annotate +${labelX}+${labelY} "${num}: ${escaped}"`,
    ];
  });

  const cmd = `convert "${src}" ${drawCmds.join(' ')} "${out}"`;
  await run(cmd);

  if (!fs.existsSync(out)) {
    throw new Error(`Annotation failed — output not created. cmd: ${cmd}`);
  }

  return out;
}

// ─── Quick summary ────────────────────────────────────────────────────────────

export function sessionSummary(session: ScreenMapSession): string {
  const lines = [
    `Session: ${session.id}`,
    `App: ${session.appName}  |  ${session.description}`,
    `Monitors: ${session.monitors.map((m) => `${m.name} ${m.width}x${m.height}@(${m.originX},${m.originY})`).join(', ')}`,
    `Baseline: ${session.baselineScreenshot ?? '(none)'}`,
    `Points (${session.points.length}):`,
    ...session.points.map((p, i) =>
      `  ${i + 1}. [${p.label}]  (${p.x}, ${p.y})  on=${p.monitorName}` +
      (p.relativeX != null ? `  rel=(${p.relativeX},${p.relativeY})` : '') +
      (p.windowContext ? `  win="${p.windowContext.windowTitle}"` : '') +
      (p.notes ? `  // ${p.notes}` : ''),
    ),
  ];
  return lines.join('\n');
}

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { captureScreen, runOcr } from '../screenshot';
import { detectMonitors, monitorForPoint } from '../screen-map';
import { runSeparate } from '../shared';
import type {
    GuiAppProfile,
    GuiStateFingerprint,
    GuiTrustSession,
    GuiWindowContext,
} from './types';
import type { MonitorInfo } from '../screen-map-types';

let sessionCounter = 0;
let stateCounter = 0;

function nextId(prefix: string, counter: number): string {
    return `${prefix}-${Date.now()}-${counter}`;
}

function sha256(input: Buffer | string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizeOcrLines(rawText: string): string[] {
    return rawText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 40);
}

function deriveVisibleRegionHash(lines: string[]): string[] {
    return lines
        .slice(0, 12)
        .map((line) => sha256(line.toLowerCase()).slice(0, 16));
}

async function getActiveWindowContext(): Promise<GuiWindowContext | undefined> {
    const { stdout: idOut } = await runSeparate('xdotool getactivewindow 2>/dev/null');
    const winId = idOut.trim();
    if (!winId) return undefined;

    const { stdout: geo } = await runSeparate(`xdotool getwindowgeometry --shell ${winId} 2>/dev/null`);
    const titleResult = await runSeparate(`xdotool getwindowname ${winId} 2>/dev/null`);
    const classResult = await runSeparate(`xprop -id ${winId} WM_CLASS 2>/dev/null`);

    const x = parseInt((geo.match(/X=(\d+)/) || [])[1] ?? '0', 10);
    const y = parseInt((geo.match(/Y=(\d+)/) || [])[1] ?? '0', 10);
    const width = parseInt((geo.match(/WIDTH=(\d+)/) || [])[1] ?? '0', 10);
    const height = parseInt((geo.match(/HEIGHT=(\d+)/) || [])[1] ?? '0', 10);
    const classMatch = classResult.stdout.match(/"([^"]+)"/);

    return {
        windowId: winId,
        windowTitle: titleResult.stdout.trim() || 'unknown',
        appName: classMatch?.[1] ?? 'unknown',
        bounds: { x, y, width, height },
    };
}

async function findWindowContext(matchers: string[]): Promise<GuiWindowContext | undefined> {
    for (const matcher of matchers) {
        const { stdout } = await runSeparate(`wmctrl -lxG | grep -i "${matcher.replace(/"/g, '\\"')}" | head -n 1`);
        const line = stdout.trim();
        if (!line) continue;

        const parts = line.split(/\s+/);
        if (parts.length < 9) continue;

        const [windowId, , x, y, width, height, host, appClass, ...titleParts] = parts;
        return {
            windowId,
            appName: appClass,
            windowTitle: titleParts.join(' ').trim(),
            bounds: {
                x: parseInt(x, 10),
                y: parseInt(y, 10),
                width: parseInt(width, 10),
                height: parseInt(height, 10),
            },
        };
    }

    return getActiveWindowContext();
}

function selectMonitor(monitors: MonitorInfo[], window?: GuiWindowContext): MonitorInfo {
    if (window) {
        const centerX = window.bounds.x + Math.round(window.bounds.width / 2);
        const centerY = window.bounds.y + Math.round(window.bounds.height / 2);
        const monitor = monitorForPoint(monitors, centerX, centerY);
        if (monitor) return monitor;
    }

    const primary = monitors.find((monitor) => monitor.originX === 0 && monitor.originY === 0);
    return primary ?? monitors[0] ?? {
        name: 'default',
        width: 0,
        height: 0,
        originX: 0,
        originY: 0,
    };
}

export async function beginGuiTrustSession(
    app: GuiAppProfile,
    opts: { artifactRoot?: string } = {},
): Promise<GuiTrustSession> {
    const monitors = await detectMonitors();
    const window = await findWindowContext(app.windowMatchers);
    const monitor = selectMonitor(monitors, window);
    const now = new Date().toISOString();

    return {
        sessionId: nextId('gtrust-session', ++sessionCounter),
        app,
        createdAt: now,
        updatedAt: now,
        monitor,
        window,
        artifactRoot: opts.artifactRoot ?? path.join(process.cwd(), 'artifacts', 'gui-trust', app.appId),
    };
}

export async function captureGuiStateFingerprint(
    session: GuiTrustSession,
    opts: { parentStateId?: string; enteredByEdgeId?: string; activeDialog?: string } = {},
): Promise<GuiStateFingerprint> {
    const capture = await captureScreen(session.window?.windowTitle ? { window: session.window.windowTitle } : {});
    if (capture.error || !capture.path) {
        throw new Error(`Unable to capture GUI state: ${capture.error ?? 'unknown error'}`);
    }

    const screenshotBuffer = fs.readFileSync(capture.path);
    const screenshotHash = sha256(screenshotBuffer);
    const ocr = await runOcr(capture.path, session.window?.windowTitle ?? session.app.displayName);
    const ocrLines = normalizeOcrLines(ocr?.rawText ?? '');
    const visibleRegionHash = deriveVisibleRegionHash(ocrLines);
    const perceptualHash = sha256(`${screenshotHash}:${visibleRegionHash.join('|')}:${ocrLines.slice(0, 8).join('|')}`);

    const state: GuiStateFingerprint = {
        stateId: nextId('gstate', ++stateCounter),
        appId: session.app.appId,
        createdAt: new Date().toISOString(),
        monitor: session.monitor,
        windowBounds: session.window?.bounds ?? {
            x: session.monitor.originX,
            y: session.monitor.originY,
            width: session.monitor.width,
            height: session.monitor.height,
        },
        windowTitle: session.window?.windowTitle ?? session.app.displayName,
        screenshotPath: capture.path,
        screenshotHash,
        perceptualHash,
        ocrSummary: ocrLines,
        visibleRegionHash,
        activeDialog: opts.activeDialog,
        parentStateId: opts.parentStateId,
        enteredByEdgeId: opts.enteredByEdgeId,
    };

    session.updatedAt = new Date().toISOString();
    if (!session.baselineStateId) {
        session.baselineStateId = state.stateId;
    }

    return state;
}

export function getDefaultGuiTrustArtifactRoot(appId: string): string {
    return path.join(process.cwd(), 'artifacts', 'gui-trust', appId);
}

export function getSessionRunDir(session: GuiTrustSession): string {
    const stamp = session.createdAt.replace(/[:.]/g, '-');
    return path.join(session.artifactRoot, 'runs', stamp);
}

export function createDefaultGuiAppProfile(appId: string, displayName?: string): GuiAppProfile {
    return {
        appId,
        displayName: displayName ?? appId,
        windowMatchers: [displayName ?? appId, appId],
        baselineLayout: 'maximized',
        monitorPolicy: 'lock-discovered',
        probePolicyId: 'safe-default',
        versionFingerprint: os.release(),
    };
}

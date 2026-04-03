/**
 * Desktop GUI executor — main dispatch entrypoint exposed to the tool loop.
 *
 * Handles: primitives, macros, a11y actions, dbus, screenshot, capabilities.
 *
 * Architecture improvements over 4.0:
 * - Single file for primitives + macros (saves 3 micro-files)
 * - ydotool fallback on Wayland for type/key
 * - `gui_query` action: returns capability report without side effects
 * - `app_launch` replaces launch_and_focus (cleaner name)
 * - Macro trace output is structured JSON (not plain text) for renderer
 */
import * as os from 'os';
import { run, cmdExists, wait } from './shared';
import { smartFocus } from './smartFocus';
import { VirtualDisplay } from './virtualDisplay';
import { captureAndAnalyze, captureScreen, runOcr } from './screenshot';
import { desktopState, recordSuccess, recordError, cacheTarget, recordFocus, recordGeometry, guessApp, WindowGeometry } from './state';
import {
    isA11yAvailable,
    a11yListApps,
    a11yGetTree,
    a11yFind,
    a11yDoAction,
    a11ySetValue,
} from './a11y';
import { executeDbusControl } from './dbus';
import { renderCapabilities } from './capabilities';

// ─── High-risk labels for post-action verify ─────────────────────────────────
const HIGH_RISK_LABEL_RE =
    /\b(menu|file|edit|view|image|layer|filter|tool|window|help|save|export|open|new|import|ok|cancel|apply|close|yes|no|delete|confirm|submit|accept|create|next|back|finish|settings|dialog|print|undo|redo)\b/i;
const HIGH_RISK_KEY_RE = /^(ctrl\+[nospeqwz]|alt\+f|ctrl\+shift\+[es]|F\d+|Return|Escape)$/i;

function shouldVerify(action: string, input: Record<string, unknown>, x?: number, y?: number): boolean {
    if (input.verify === false) return false;
    if (input.verify === true) return true;
    if (action === 'key' && typeof input.text === 'string') return HIGH_RISK_KEY_RE.test(input.text);
    if (action !== 'click' || x == null) return false;
    if (desktopState.confidence < 0.5) return true;
    const hit = Object.entries(desktopState.knownTargets).find(([, t]) => t.x === x && t.y === y);
    if (hit && HIGH_RISK_LABEL_RE.test(hit[0])) return true;
    if (typeof y === 'number' && y < 80) return true; // menu bar zone
    return false;
}

async function postVerify(windowTitle?: string): Promise<string> {
    if (!await cmdExists('tesseract') || !await cmdExists('scrot')) return '';
    const { ocr, summary } = await captureAndAnalyze({ window: windowTitle });
    if (!ocr) return '';
    const lines: string[] = ['[Post-action state]'];
    if (summary.includes('DIALOG')) {
        lines.push(...summary.split('\n').filter((l) => l.includes('DIALOG') || l.includes('Dialog')));
    }
    if (ocr.targets.length > 0) {
        lines.push(`Visible: ${ocr.targets.slice(0, 8).map((t) => `"${t.label}"`).join(', ')}`);
    }
    return lines.join('\n');
}

// ─── Macro step tracing ───────────────────────────────────────────────────────

type StepResult = 'ok' | 'skip' | 'fail';

interface MacroStep {
    step: number;
    action: string;
    detail: string;
    result: StepResult;
    durationMs: number;
}

function createTrace(name: string) {
    const steps: MacroStep[] = [];
    const start = Date.now();

    const step = async (action: string, detail: string, fn: () => Promise<string>): Promise<string> => {
        const t0 = Date.now();
        let r: string;
        try { r = await fn(); } catch (e: any) { r = `[Error] ${e.message}`; }
        const durationMs = Date.now() - t0;
        const result: StepResult = r.startsWith('[Error') ? 'fail' : r.includes('[cached') ? 'skip' : 'ok';
        steps.push({ step: steps.length + 1, action, detail: detail.slice(0, 80), result, durationMs });
        console.log(`[Macro] ${name} → ${action}(${detail.slice(0, 60)}) [${result}] ${durationMs}ms`);
        return r;
    };

    const finish = (): string => {
        const totalMs = Date.now() - start;
        const stepLines = steps.map((s) => `  → ${s.action}(${s.detail}) [${s.result}] ${s.durationMs}ms`).join('\n');
        return `[Macro] ${name} (${steps.length} steps, ${totalMs}ms)\n${stepLines}`;
    };

    return { step, finish };
}

// ─── Tool input helpers ───────────────────────────────────────────────────────

async function focusIfNeeded(
    winName: string | undefined,
    m: ReturnType<typeof createTrace>,
): Promise<{ focused: boolean }> {
    if (!winName) return { focused: true };
    const { focused, skipped } = await smartFocus(winName);
    if (!focused) return { focused: false };
    if (!skipped) await wait(100);
    return { focused: true };
}

// ─── Primitive actions ────────────────────────────────────────────────────────

// ─── Window geometry + monitor helpers ───────────────────────────────────────

/**
 * Parse `wmctrl -l -G` output to get geometry for ALL windows matching titlePattern.
 * wmctrl -l -G columns: WID  DESKTOP  X  Y  W  H  HOST  TITLE
 * Returns array sorted by WID descending (newest window first).
 */
async function getWindowsGeometry(titlePattern: string, display?: string): Promise<Array<{ wid: string; x: number; y: number; width: number; height: number }>> {
    if (!await cmdExists('wmctrl')) return [];
    const listing = await run('wmctrl -l -G 2>/dev/null', undefined, display);
    if (listing.startsWith('[Error]') || listing === '[No output]') return [];
    const re = new RegExp(titlePattern, 'i');
    const results: Array<{ wid: string; x: number; y: number; width: number; height: number }> = [];
    for (const line of listing.split('\n')) {
        if (!re.test(line)) continue;
        // WID(hex)  desktop  x  y  w  h  host  title...
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) continue;
        const wid = parts[0];
        const x = parseInt(parts[2], 10);
        const y = parseInt(parts[3], 10);
        const width = parseInt(parts[4], 10);
        const height = parseInt(parts[5], 10);
        if ([x, y, width, height].some(isNaN)) continue;
        results.push({ wid, x, y, width, height });
    }
    // Sort descending by WID (hex) — higher WID = more recently created window
    results.sort((a, b) => (parseInt(b.wid, 16) - parseInt(a.wid, 16)));
    return results;
}

async function getWindowGeometry(titlePattern: string, display?: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const all = await getWindowsGeometry(titlePattern, display);
    return all.length > 0 ? all[0] : null;
}

interface MonitorInfo {
    index: number;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Parse `xrandr` output to get a list of connected monitors with their geometry.
 */
async function getMonitors(): Promise<MonitorInfo[]> {
    if (!await cmdExists('xrandr')) return [];
    const output = await run('xrandr 2>/dev/null', undefined, process.env.DISPLAY ?? ':0');
    if (output.startsWith('[Error]') || output === '[No output]') return [];
    const monitors: MonitorInfo[] = [];
    // Match lines like: HDMI-1 connected 2560x1440+0+0 ...  or  eDP-1 connected primary 1920x1080+2560+0
    const re = /^(\S+)\s+connected(?:\s+primary)?\s+(\d+)x(\d+)\+(\d+)\+(\d+)/m;
    let index = 0;
    for (const line of output.split('\n')) {
        const m = line.match(/^(\S+)\s+connected(?:\s+primary)?\s+(\d+)x(\d+)\+(\d+)\+(\d+)/);
        if (m) {
            monitors.push({
                index: index++,
                name: m[1],
                width: parseInt(m[2], 10),
                height: parseInt(m[3], 10),
                x: parseInt(m[4], 10),
                y: parseInt(m[5], 10),
            });
        }
    }
    return monitors;
}

/**
 * Given a window's top-left corner, determine which monitor it's on.
 * Uses the monitor whose bounds contain the window origin; falls back to
 * the monitor whose centre is closest to the window centre.
 */
async function resolveMonitor(wx: number, wy: number, ww: number, wh: number): Promise<{ monitor: number; monitorLabel: string }> {
    const monitors = await getMonitors();
    if (monitors.length === 0) return { monitor: 0, monitorLabel: 'unknown' };

    // 1. Find monitor that contains the window's top-left origin
    for (const m of monitors) {
        if (wx >= m.x && wx < m.x + m.width && wy >= m.y && wy < m.y + m.height) {
            return { monitor: m.index, monitorLabel: `${m.name} (${m.width}x${m.height} @ ${m.x},${m.y})` };
        }
    }

    // 2. Fallback: closest monitor centre to window centre
    const wCx = wx + ww / 2;
    const wCy = wy + wh / 2;
    let best = monitors[0];
    let bestDist = Infinity;
    for (const m of monitors) {
        const mCx = m.x + m.width / 2;
        const mCy = m.y + m.height / 2;
        const dist = Math.hypot(wCx - mCx, wCy - mCy);
        if (dist < bestDist) { bestDist = dist; best = m; }
    }
    return { monitor: best.index, monitorLabel: `${best.name} (${best.width}x${best.height} @ ${best.x},${best.y})` };
}

/**
 * Get full WindowGeometry (position + size + monitor) for a window by title.
 * Returns null if wmctrl is unavailable or the window is not found.
 *
 * If preferMonitor is specified (0-based index), returns the matching window
 * on that monitor; falls back to the newest (highest WID) match if none are
 * on the preferred monitor. This disambiguates same-titled windows on dual
 * monitor setups.
 */
async function measureWindow(titlePattern: string, display?: string, preferMonitor?: number): Promise<WindowGeometry & { wid?: string } | null> {
    const all = await getWindowsGeometry(titlePattern, display);
    if (all.length === 0) return null;

    // Annotate each candidate with its monitor
    const candidates: Array<{ wid: string; x: number; y: number; width: number; height: number; monitor: number; monitorLabel: string }> = [];
    for (const g of all) {
        const { monitor, monitorLabel } = await resolveMonitor(g.x, g.y, g.width, g.height);
        candidates.push({ ...g, monitor, monitorLabel });
    }

    let chosen = candidates[0]; // default: newest window
    if (preferMonitor !== undefined) {
        const onPreferred = candidates.find((c) => c.monitor === preferMonitor);
        if (onPreferred) chosen = onPreferred;
    }

    return chosen;
}

/**
 * Get the display string to use for agent desktop commands.
 *
 * Ensures the virtual display (Xvfb :99) is running, then returns its display
 * string. Falls back to the host display if Xvfb is unavailable, with a console
 * warning so the operator knows isolation is degraded.
 *
 * The virtual display runs actions in an isolated X session so that xdotool
 * mouse/keyboard injection never affects the user's real (:0) display.
 */
async function getAgentDisplay(): Promise<string> {
    const vd = VirtualDisplay.getInstance();
    await vd.ensure();
    if (vd.display) return vd.display;
    console.warn('[Desktop] Virtual display unavailable — falling back to host display (user may see cursor movement)');
    return process.env.DISPLAY ?? ':0';
}

async function execPrimitive(
    input: Record<string, unknown>,
    batchWindow?: string,
): Promise<string | null> {
    const action = input.action as string;
    const winName = (input.window as string | undefined) ?? batchWindow;
    const x = input.x as number | undefined;
    const y = input.y as number | undefined;
    const text = input.text as string | undefined;
    const delayMs = (input.delay as number | undefined) ?? 0;

    // Two display contexts:
    //   hostDisplay  — the real user display (process.env.DISPLAY).
    //                  Used for window DISCOVERY: wmctrl -l, xrandr, geometry queries.
    //                  Windows only appear here; querying agentDisplay returns nothing.
    //   agentDisplay — the isolated virtual display (Xvfb :99).
    //                  Used for INPUT INJECTION: xdotool click/type/key, focus.
    //                  Keeps injected events off the user's real session.
    const hostDisplay = process.env.DISPLAY ?? ':0';
    const agentDisplay = await getAgentDisplay();

    // runH: read-only queries that need to see real windows (wmctrl -l, xrandr)
    // runD: input injection that must target the virtual display
    const runH = (cmd: string, timeout?: number) => run(cmd, timeout, hostDisplay);
    const runD = (cmd: string, timeout?: number) => run(cmd, timeout, agentDisplay);
    const focusD = (win: string) => smartFocus(win, hostDisplay);

    const sessionType = (process.env.XDG_SESSION_TYPE ?? '').toLowerCase();
    const useYdotool = sessionType === 'wayland' && await cmdExists('ydotool');

    switch (action) {
        case 'list_windows': {
            if (!await cmdExists('wmctrl')) return '[Error] wmctrl not installed. Run: sudo apt install wmctrl';
            return runH('wmctrl -l -p');
        }

        case 'window_geometry': {
            // Returns position, size, and monitor for a window by title pattern.
            // Automatically called by attach_window — use this standalone to query
            // a window without changing focus.
            if (!winName) return '[Error] window_geometry requires "window" (title pattern).';
            const geom = await measureWindow(winName, hostDisplay);
            if (!geom) return `[Error] Could not get geometry for "${winName}". Is wmctrl installed and the window open?`;
            recordGeometry(desktopState, geom);
            return JSON.stringify({
                window: winName,
                x: geom.x,
                y: geom.y,
                width: geom.width,
                height: geom.height,
                monitor: geom.monitor,
                monitorLabel: geom.monitorLabel,
            });
        }

        case 'find_window': {
            if (!winName) return '[Error] window name required.';
            if (!await cmdExists('xdotool')) return '[Error] xdotool not installed.';
            const ids = await runH(`xdotool search --name "${winName}" 2>/dev/null`);
            if (ids.startsWith('[Error]') || ids === '[No output]') return `No windows matching "${winName}".`;
            const wids = ids.split('\n').filter(Boolean).slice(0, 5);
            const details: string[] = [];
            for (const wid of wids) {
                details.push(`  ${wid}: ${await runH(`xdotool getwindowname ${wid} 2>/dev/null`)}`);
            }
            return `Found ${wids.length} window(s):\n${details.join('\n')}`;
        }

        case 'focus': {
            if (!winName) return '[Error] window name required.';
            const { focused, skipped } = await focusD(winName);
            if (!focused) return `[Error] Could not focus "${winName}".`;
            if (delayMs) await wait(delayMs);
            return skipped ? `Focused: "${winName}" [cached — already focused]` : `Focused: "${winName}"`;
        }

        case 'maximize_window': {
            if (!winName) return '[Error] window name required.';
            const { focused } = await focusD(winName);
            if (!focused) return `[Error] Could not focus "${winName}" — aborting maximize.`;
            await wait(100);

            if (await cmdExists('wmctrl')) {
                const result = await runH(`wmctrl -r "${winName}" -b add,maximized_vert,maximized_horz 2>&1`);
                if (!result.startsWith('[Error]')) {
                    recordSuccess(desktopState, 'maximize_window', winName);
                    return `Maximized "${winName}"`;
                }
            }

            if (await cmdExists('xdotool')) {
                const keyResult = await runH('xdotool key alt+F10 2>&1');
                if (!keyResult.startsWith('[Error]')) {
                    recordSuccess(desktopState, 'maximize_window', winName);
                    return `Maximized "${winName}" via Alt+F10 fallback`;
                }
            }

            recordError(desktopState, 'maximize_window', winName);
            return `[Error] Could not maximize "${winName}".`;
        }

        case 'fullscreen_window': {
            if (!winName) return '[Error] window name required.';
            const { focused } = await focusD(winName);
            if (!focused) return `[Error] Could not focus "${winName}" — aborting fullscreen.`;
            await wait(100);

            if (await cmdExists('wmctrl')) {
                const result = await runH(`wmctrl -r "${winName}" -b add,fullscreen 2>&1`);
                if (!result.startsWith('[Error]')) {
                    recordSuccess(desktopState, 'fullscreen_window', winName);
                    return `Fullscreened "${winName}"`;
                }
            }

            if (await cmdExists('xdotool')) {
                const keyResult = await runH('xdotool key F11 2>&1');
                if (!keyResult.startsWith('[Error]')) {
                    recordSuccess(desktopState, 'fullscreen_window', winName);
                    return `Fullscreened "${winName}" via F11 fallback`;
                }
            }

            recordError(desktopState, 'fullscreen_window', winName);
            return `[Error] Could not fullscreen "${winName}".`;
        }

        case 'click': {
            if (x == null || y == null) return '[Error] x and y coordinates required.';
            if (!await cmdExists('xdotool') && !useYdotool) return '[Error] xdotool/ydotool not installed.';
            console.log(`[DESKTOP_ACTION] click (${x}, ${y})${winName ? ` in "${winName}"` : ''}`);
            if (winName) {
                console.log(`[FOCUS_REQUESTED] Window: "${winName}"`);
                const { focused } = await focusD(winName);
                if (!focused) {
                    console.error(`[FOCUS_GATE_BLOCKED] click aborted: focus failed for "${winName}"`);
                    return `[Error] Could not focus "${winName}" — aborting click.`;
                }
                console.log(`[FOCUS_GATE_PASSED]`);
                await wait(100);
            }
            if (delayMs) await wait(delayMs);
            console.log(`[DISPATCH] Executing click at (${x}, ${y})`);
            const clickResult = useYdotool
                ? await runD(`ydotool mousemove -a ${x} ${y} && ydotool click 0x00`)
                : await runD(`xdotool mousemove ${x} ${y} click 1`);
            if (clickResult.startsWith('[Error]')) {
                recordError(desktopState, 'click', `(${x},${y})`);
                return clickResult;
            }
            recordSuccess(desktopState, 'click', `(${x},${y})`);
            let verifyBlock = '';
            if (shouldVerify('click', input, x, y)) {
                console.log(`[VERIFY_START] click at (${x}, ${y})`);
                verifyBlock = await postVerify(winName);
                if (verifyBlock) {
                    console.log(`[VERIFY_OK]`);
                } else {
                    console.log(`[VERIFY_UNAVAILABLE] tesseract/scrot missing`);
                }
            }
            return `Clicked (${x}, ${y})${verifyBlock ? '\n' + verifyBlock : ''}`;
        }

        case 'type': {
            if (!text) return '[Error] text required.';
            if (!await cmdExists('xdotool') && !useYdotool) return '[Error] xdotool/ydotool not installed.';
            console.log(`[DESKTOP_ACTION] type (${text.length} chars)${winName ? ` in "${winName}"` : ''}`);
            if (winName) {
                console.log(`[FOCUS_REQUESTED] Window: "${winName}"`);
                const { focused } = await focusD(winName);
                if (!focused) {
                    console.error(`[FOCUS_GATE_BLOCKED] type aborted: focus failed for "${winName}"`);
                    return `[Error] Could not focus "${winName}" — aborting type.`;
                }
                console.log(`[FOCUS_GATE_PASSED]`);
                await wait(100);
            }
            if (delayMs) await wait(delayMs);
            const escaped = text.replace(/"/g, '\\"');
            console.log(`[DISPATCH] Executing type (${text.length} chars)`);
            const typeResult = useYdotool
                ? await runD(`ydotool type -- "${escaped}"`)
                : await runD(`xdotool type --delay 15 -- "${escaped}"`);
            if (typeResult.startsWith('[Error]')) return typeResult;
            recordSuccess(desktopState, 'type', text.slice(0, 30));
            return `Typed "${text.slice(0, 50)}"`;
        }

        case 'key': {
            if (!text) return '[Error] key combo required (e.g. "ctrl+s", "Return").';
            if (!await cmdExists('xdotool') && !useYdotool) return '[Error] xdotool/ydotool not installed.';
            const isImportantKey = /^(ctrl\+[nospeqwz]|alt\+f|ctrl\+shift\+[es]|F\d+|Return|Escape)$/i.test(text);
            console.log(`[DESKTOP_ACTION] key ${text}${isImportantKey ? ' [IMPORTANT]' : ''}${winName ? ` in "${winName}"` : ''}`);
            if (winName) {
                console.log(`[FOCUS_REQUESTED] Window: "${winName}"`);
                const { focused } = await focusD(winName);
                if (!focused) {
                    console.error(`[FOCUS_GATE_BLOCKED] key aborted: focus failed`);
                    return `[Error] Could not focus "${winName}" — aborting key press.`;
                }
                console.log(`[FOCUS_GATE_PASSED]`);
                await wait(100);
            }
            if (delayMs) await wait(delayMs);
            console.log(`[DISPATCH] Executing key ${text}`);
            const keyResult = useYdotool
                ? await runD(`ydotool key ${text}`)
                : await runD(`xdotool key ${text}`);
            if (keyResult.startsWith('[Error]')) return keyResult;
            recordSuccess(desktopState, 'key', text);
            let verifyBlock = '';
            if (shouldVerify('key', input)) {
                console.log(`[VERIFY_START] key ${text}`);
                verifyBlock = await postVerify(winName);
                if (!verifyBlock) console.log(`[VERIFY_UNAVAILABLE]`);
                else console.log(`[VERIFY_OK]`);
            }
            return `Key: ${text}${verifyBlock ? '\n' + verifyBlock : ''}`;
        }

        case 'right_click': {
            if (x == null || y == null) return '[Error] x and y required.';
            console.log(`[DESKTOP_ACTION] right_click (${x}, ${y})${winName ? ` in "${winName}"` : ''}`);
            if (winName) {
                console.log(`[FOCUS_REQUESTED] Window: "${winName}"`);
                const { focused } = await focusD(winName);
                if (!focused) {
                    console.error(`[FOCUS_GATE_BLOCKED] right_click aborted: focus failed`);
                    return `[Error] Could not focus "${winName}".`;
                }
                console.log(`[FOCUS_GATE_PASSED]`);
                await wait(100);
            }
            if (delayMs) await wait(delayMs);
            console.log(`[DISPATCH] Executing right_click at (${x}, ${y})`);
            const rcResult = useYdotool
                ? await runD(`ydotool mousemove -a ${x} ${y} && ydotool click 0x02`)
                : await runD(`xdotool mousemove ${x} ${y} click 3`);
            if (rcResult.startsWith('[Error]')) return rcResult;
            console.log(`[VERIFY_START] right_click at (${x}, ${y})`);
            let verifyBlock = await postVerify(winName);
            if (!verifyBlock) console.log(`[VERIFY_UNAVAILABLE]`);
            else console.log(`[VERIFY_OK]`);
            return `Right-clicked (${x}, ${y})${verifyBlock ? '\n' + verifyBlock : ''}`;
        }

        case 'double_click': {
            if (x == null || y == null) return '[Error] x and y required.';
            console.log(`[DESKTOP_ACTION] double_click (${x}, ${y})${winName ? ` in "${winName}"` : ''}`);
            if (winName) {
                console.log(`[FOCUS_REQUESTED] Window: "${winName}"`);
                const { focused } = await focusD(winName);
                if (!focused) {
                    console.error(`[FOCUS_GATE_BLOCKED] double_click aborted: focus failed`);
                    return `[Error] Could not focus "${winName}".`;
                }
                console.log(`[FOCUS_GATE_PASSED]`);
                await wait(100);
            }
            if (delayMs) await wait(delayMs);
            console.log(`[DISPATCH] Executing double_click at (${x}, ${y})`);
            const dcResult = useYdotool
                ? await runD(`ydotool mousemove -a ${x} ${y} && ydotool click 0x00 && ydotool click 0x00`)
                : await runD(`xdotool mousemove ${x} ${y} click --repeat 2 1`);
            if (dcResult.startsWith('[Error]')) return dcResult;
            console.log(`[VERIFY_START] double_click at (${x}, ${y})`);
            let verifyBlock = await postVerify(winName);
            if (!verifyBlock) console.log(`[VERIFY_UNAVAILABLE]`);
            else console.log(`[VERIFY_OK]`);
            return `Double-clicked (${x}, ${y})${verifyBlock ? '\n' + verifyBlock : ''}`;
        }

        case 'scroll': {
            const direction = (input.direction as string | undefined) ?? 'down';
            const amount = (input.amount as number | undefined) ?? 3;
            if (winName) {
                const { focused } = await focusD(winName);
                if (!focused) return `[Error] Could not focus "${winName}".`;
                await wait(100);
            }
            const btn = direction === 'up' ? 4 : direction === 'left' ? 6 : direction === 'right' ? 7 : 5;
            const scrollResult = useYdotool
                ? `[Info] ydotool scroll not directly supported — use xdotool`
                : await runD(`xdotool click --repeat ${amount} --delay 50 ${btn}`);
            return scrollResult;
        }

        case 'screenshot': {
            const { imagePath, summary } = await captureAndAnalyze({ window: winName });
            return imagePath ? `[Screenshot: ${imagePath}]\n${summary}` : summary;
        }

        case 'screenshot_region': {
            const rx = input.rx as number | undefined;
            const ry = input.ry as number | undefined;
            const rw = input.rw as number | undefined;
            const rh = input.rh as number | undefined;
            if (rx == null || ry == null || rw == null || rh == null) {
                return '[Error] screenshot_region requires: rx, ry, rw, rh';
            }
            const capture = await captureScreen({ region: { x: rx, y: ry, w: rw, h: rh } });
            if (capture.error) return `[Error] ${capture.error}`;
            const ocr = await runOcr(capture.path, winName);
            return `[Screenshot: ${capture.path}]\n${ocr?.summary ?? ''}`;
        }

        case 'verify_window_title': {
            const title = await runH('xdotool getactivewindow getwindowname 2>/dev/null');
            if (title.startsWith('[Error]')) return title;
            return `Active window: "${title.trim()}"`;
        }

        case 'verify_file_exists': {
            const filePath = (input.path ?? text) as string | undefined;
            if (!filePath) return '[Error] path or text (filepath) required.';
            const stat = await runD(`stat --printf="%s bytes, modified %y" "${filePath}" 2>/dev/null`);
            return stat.startsWith('[Error]') ? `File not found: ${filePath}` : `File exists: ${filePath} (${stat})`;
        }

        case 'attach_window': {
            // Attach to an already-open window by title — no launch, immediate focus + screenshot.
            // Use this instead of app_launch when the app is already running, or immediately
            // after triggering an open via another method (e.g. xdg-open, shell exec).
            if (!winName) return '[Error] attach_window requires "window" (title pattern to match).';
            if (!await cmdExists('wmctrl')) return '[Error] wmctrl not installed.';
            const re = new RegExp(winName, 'i');
            const preferMonitorAttach = input.monitor as number | undefined;

            // Wait up to 8s for the window to appear (handles race between trigger and render)
            // Uses hostDisplay — windows live on the real display, not the virtual agent display.
            const attachStart = Date.now();
            let found = false;
            while (Date.now() - attachStart < 8_000) {
                const windows = await runH('wmctrl -l 2>/dev/null');
                if (re.test(windows)) { found = true; break; }
                await wait(300);
            }
            if (!found) return `[Error] No window matching "${winName}" found within 8s. Run list_windows to see what is open.`;

            // Measure geometry first to pick the right window when there are multiple matches
            const geom = await measureWindow(winName, hostDisplay, preferMonitorAttach);
            const attachWid = (geom as any)?.wid;

            // Focus by WID when available to avoid focusing wrong window on other monitor
            // wmctrl -i -a targets the real WM on hostDisplay
            let focused = false;
            if (attachWid && await cmdExists('wmctrl')) {
                const r = await runH(`wmctrl -i -a ${attachWid} 2>&1`);
                focused = !r.startsWith('[Error]');
            }
            if (!focused) {
                const res = await focusD(winName);
                focused = res.focused;
            }
            if (!focused) return `[Error] Window "${winName}" found but could not focus it.`;
            await wait(300);

            if (geom) {
                recordFocus(desktopState, winName, guessApp(winName), geom);
            }

            console.log(`[VERIFY_START] attach_window "${winName}"`);
            const { imagePath, summary } = await captureAndAnalyze({ window: winName });
            recordSuccess(desktopState, 'attach_window', winName);
            if (imagePath || summary) console.log(`[VERIFY_OK]`);
            else console.log(`[VERIFY_UNAVAILABLE]`);
            const geomLine = geom
                ? `\nGeometry: ${geom.width}x${geom.height} at (${geom.x},${geom.y}) — monitor ${geom.monitor} [${geom.monitorLabel}]`
                : '';
            return `Attached to "${winName}"${geomLine}${imagePath ? `\n[Screenshot: ${imagePath}]` : ''}\n${summary}`;
        }

        case 'close_window': {
            // Close a window cleanly via WM close message (equivalent to clicking ×).
            // Falls back to Alt+F4 if wmctrl cannot find the window.
            // Pass force:true (via text="force") to send SIGTERM to the owning PID.
            if (!winName) return '[Error] close_window requires "window" (title pattern).';
            const force = text === 'force' || input.force === true;

            if (!force && await cmdExists('wmctrl')) {
                const closeResult = await runH(`wmctrl -c "${winName}" 2>&1`);
                if (!closeResult.startsWith('[Error]')) {
                    await wait(400);
                    recordSuccess(desktopState, 'close_window', winName);
                    return `Closed window "${winName}" via WM close`;
                }
            }

            // Fallback: Alt+F4 while the window is focused
            const { focused } = await focusD(winName);
            if (focused) {
                await runH('xdotool key alt+F4');
                await wait(400);
                recordSuccess(desktopState, 'close_window', winName);
                return `Closed window "${winName}" via Alt+F4`;
            }

            if (force && await cmdExists('wmctrl')) {
                // Get the PID from wmctrl -l -p and send SIGTERM
                const listing = await runH('wmctrl -l -p 2>/dev/null');
                const lines = listing.split('\n').filter(l => new RegExp(winName, 'i').test(l));
                if (lines.length > 0) {
                    const parts = lines[0].trim().split(/\s+/);
                    const pid = parts[2];
                    if (pid && /^\d+$/.test(pid)) {
                        await run(`kill ${pid} 2>/dev/null`);
                        await wait(400);
                        return `Force-closed "${winName}" (SIGTERM pid ${pid})`;
                    }
                }
            }

            return `[Error] Could not close "${winName}" — window may already be closed.`;
        }

        case 'wait':
        case 'delay': {
            const waitMs = delayMs || (input.ms as number | undefined) || 500;
            await wait(waitMs);
            return `Waited ${waitMs}ms`;
        }

        default:
            return null; // let caller fall through to macros
    }
}

// ─── Macro actions ────────────────────────────────────────────────────────────

async function execMacro(
    input: Record<string, unknown>,
    batchWindow?: string,
): Promise<string | null> {
    const action = input.action as string;
    const winName = (input.window as string | undefined) ?? batchWindow;
    const text = input.text as string | undefined;

    const hostDisplay = process.env.DISPLAY ?? ':0';
    const runH = (cmd: string, timeout?: number) => run(cmd, timeout, hostDisplay);

    switch (action) {
        case 'app_launch':
        case 'launch_and_focus': {
            const appBinary = (input.app ?? text) as string | undefined;
            if (!appBinary) return '[Error] app_launch requires "app" (binary name).';
            console.log(`[DESKTOP_ACTION] app_launch "${appBinary}" (window timeout: 18s)`);
            const windowMatch = winName ?? appBinary;
            const preferMonitor = input.monitor as number | undefined;
            const m = createTrace(`app_launch("${appBinary}")`);

            // Snapshot ALL existing WIDs before launch (not just title-matched ones).
            // This lets us detect the new window even when the binary name doesn't match
            // the window title (e.g. binary "gnome-calculator" → title "Calculator").
            const preLaunchWindows = await runH('wmctrl -l 2>/dev/null');
            const re = new RegExp(windowMatch, 'i');
            const allPreWids = new Set(
                preLaunchWindows.split('\n')
                    .map((l) => l.trim().split(/\s+/)[0])
                    .filter((w) => /^0x[0-9a-f]+$/i.test(w))
            );

            await m.step('launch', appBinary, async () => {
                await run(`setsid ${appBinary} >/dev/null 2>&1 &`);
                return `Launched ${appBinary} in background`;
            });

            let newWid: string | undefined;
            let detectedTitle: string | undefined;
            const waitResult = await m.step('wait_for_window', windowMatch, async () => {
                const launchStart = Date.now();
                // Two-pass detection:
                //   Pass 1: look for a new WID whose title matches the windowMatch pattern
                //   Pass 2: look for ANY new WID not present before launch (handles binary≠title)
                for (let elapsed = 0; elapsed < 18_000; elapsed = Date.now() - launchStart) {
                    const windows = await runH('wmctrl -l 2>/dev/null');
                    // Pass 1: title match
                    for (const line of windows.split('\n')) {
                        if (!re.test(line)) continue;
                        const wid = line.trim().split(/\s+/)[0];
                        if (!allPreWids.has(wid)) { newWid = wid; break; }
                    }
                    if (newWid) {
                        detectedTitle = windows.split('\n').find((l) => l.includes(newWid!))?.split(/\s+/).slice(4).join(' ');
                        return `Window "${windowMatch}" appeared after ${Date.now() - launchStart}ms (WID: ${newWid})`;
                    }
                    // Pass 2: any new WID (binary name ≠ window title case)
                    for (const line of windows.split('\n')) {
                        const wid = line.trim().split(/\s+/)[0];
                        if (!wid || allPreWids.has(wid) || !/^0x[0-9a-f]+$/i.test(wid)) continue;
                        // New window appeared — record it
                        newWid = wid;
                        detectedTitle = line.trim().split(/\s+/).slice(4).join(' ');
                        return `New window appeared after ${Date.now() - launchStart}ms: "${detectedTitle}" (WID: ${newWid}) — title did not match pattern "${windowMatch}"`;
                    }
                    await wait(300);
                }
                return `[Error] No window matching "${windowMatch}" within 18s`;
            });
            if (waitResult.startsWith('[Error]')) return `${m.finish()}\n${waitResult}`;

            // Use detectedTitle as windowMatch if the original pattern didn't match
            const effectiveMatch = detectedTitle && !re.test(detectedTitle ?? '') ? (detectedTitle ?? windowMatch) : windowMatch;

            // Measure geometry and resolve monitor before focus
            const geom = newWid
                ? await (async () => {
                    // Directly measure the exact WID we found
                    const all = await getWindowsGeometry(effectiveMatch, hostDisplay);
                    const match = all.find((w) => w.wid === newWid) ?? all[0];
                    if (!match) return null;
                    const { monitor, monitorLabel } = await resolveMonitor(match.x, match.y, match.width, match.height);
                    return { ...match, monitor, monitorLabel };
                })()
                : await measureWindow(effectiveMatch, hostDisplay, preferMonitor);
            const resolvedWid = newWid ?? (geom as any)?.wid;

            await m.step('focus', effectiveMatch, async () => {
                // Focus by WID to avoid ambiguity with same-titled windows on other monitors
                if (resolvedWid && await cmdExists('wmctrl')) {
                    await runH(`wmctrl -i -a ${resolvedWid} 2>&1`);
                } else {
                    await smartFocus(effectiveMatch, hostDisplay);
                }
                await wait(500);
                if (geom) recordFocus(desktopState, effectiveMatch, guessApp(effectiveMatch), geom);
                const monLine = geom ? ` on monitor ${geom.monitor} [${geom.monitorLabel}]` : '';
                return `Focused "${effectiveMatch}"${monLine}`;
            });

            console.log(`[VERIFY_START] app_launch window "${effectiveMatch}"`);
            const { summary } = await captureAndAnalyze({ window: effectiveMatch });
            if (summary) console.log(`[VERIFY_OK] window detected`);
            else console.log(`[VERIFY_UNAVAILABLE] capture failed`);
            const geomLine = geom ? `\nGeometry: ${geom.width}x${geom.height} at (${geom.x},${geom.y}) — monitor ${geom.monitor} [${geom.monitorLabel}]` : '';
            return `${m.finish()}\n\nLaunched and focused "${appBinary}" (window: "${effectiveMatch}")${geomLine}\n${summary}`;
        }

        case 'open_menu_path': {
            let menuPath: string[] = [];
            if (Array.isArray(input.path)) menuPath = input.path as string[];
            else if (typeof input.path === 'string') menuPath = input.path.split(/\s*>\s*/);
            else if (text) menuPath = text.split(/\s*>\s*/);
            if (menuPath.length === 0) return '[Error] open_menu_path requires "path" array or string "File > Export As".';

            const m = createTrace(`open_menu_path("${menuPath.join(' > ')}")`);
            if (winName) await m.step('focus', winName, async () => {
                const { focused, skipped } = await smartFocus(winName!);
                if (!focused) return `[Error] Could not focus "${winName}"`;
                if (!skipped) await wait(100);
                return `Focused "${winName}"`;
            });

            const firstLetter = menuPath[0][0].toLowerCase();
            await m.step('open_menu', menuPath[0], async () => {
                await run(`xdotool key alt+${firstLetter}`);
                await wait(350);
                return `Opened menu via Alt+${firstLetter}`;
            });

            for (let i = 1; i < menuPath.length; i++) {
                const item = menuPath[i].trim();
                const isFinal = i === menuPath.length - 1;
                await m.step(isFinal ? 'activate' : 'navigate', item, async () => {
                    for (const char of item.slice(0, 5)) {
                        await run(`xdotool key ${char.toLowerCase()}`);
                        await wait(50);
                    }
                    await wait(200);
                    if (!isFinal) {
                        await run('xdotool key Right');
                        await wait(200);
                        return `Navigated to "${item}"`;
                    } else {
                        await run('xdotool key Return');
                        await wait(300);
                        return `Activated "${item}"`;
                    }
                });
            }

            const verifyBlock = await postVerify(winName);
            return `${m.finish()}\n\nMenu: ${menuPath.join(' > ')}${verifyBlock ? '\n' + verifyBlock : ''}`;
        }

        case 'fill_dialog': {
            const fields = input.fields as Array<{ value: string; label?: string }>;
            if (!fields?.length) return '[Error] fill_dialog requires "fields" array [{value, label?}] in tab order.';
            const m = createTrace(`fill_dialog(${fields.length} fields)`);

            if (winName) await m.step('focus', winName, async () => {
                const { focused, skipped } = await smartFocus(winName!);
                if (!focused) return `[Error] Could not focus "${winName}"`;
                if (!skipped) await wait(100);
                return `Focused "${winName}"`;
            });

            for (let i = 0; i < fields.length; i++) {
                const { value, label = '' } = fields[i];
                const r = await m.step('fill_field', `field ${i + 1}${label ? ` (${label})` : ''}`, async () => {
                    if (i > 0) { await run('xdotool key Tab'); await wait(100); }
                    await run('xdotool key ctrl+a'); await wait(50);
                    await run(`xdotool type --delay 10 -- "${String(value).replace(/"/g, '\\"')}"`);
                    await wait(100);
                    return `Filled "${String(value).slice(0, 40)}"`;
                });
                if (r.startsWith('[Error]')) break;
            }

            const confirm = input.confirm !== false;
            if (confirm) {
                await m.step('confirm', 'Enter', async () => {
                    await wait(200); await run('xdotool key Return'); await wait(300);
                    return 'Confirmed (Enter)';
                });
            }
            return m.finish() + (confirm ? '\n' + await postVerify(winName) : '');
        }

        case 'click_and_type': {
            const x = input.x as number | undefined;
            const y = input.y as number | undefined;
            if (x == null || y == null || !text) return '[Error] click_and_type requires x, y, text.';
            if (!await cmdExists('xdotool')) return '[Error] xdotool required.';

            const m = createTrace(`click_and_type(${x},${y},"${text.slice(0, 30)}")`);
            if (winName) await m.step('focus', winName, async () => {
                const { focused, skipped } = await smartFocus(winName!);
                if (!focused) return `[Error] Could not focus "${winName}"`;
                if (!skipped) await wait(100);
                return `Focused "${winName}"`;
            });

            const clickRes = await m.step('click', `(${x},${y})`, async () => {
                const r = await run(`xdotool mousemove ${x} ${y} click 1`);
                if (r.startsWith('[Error]')) return r;
                await wait(100);
                return `Clicked (${x}, ${y})`;
            });
            if (clickRes.startsWith('[Error]')) return `${m.finish()}\nFailed at click.`;

            await m.step('type', text.slice(0, 40), async () => {
                await run(`xdotool type --delay 15 -- "${text.replace(/"/g, '\\"')}"`);
                return `Typed "${text.slice(0, 50)}"`;
            });

            return `${m.finish()}\n\nClicked (${x},${y}) and typed "${text.slice(0, 50)}"`;
        }

        case 'export_file': {
            const exportPath = (input.path ?? input.export_path) as string | undefined;
            if (!exportPath) return '[Error] export_file requires "path" (output file path).';
            const m = createTrace(`export_file("${exportPath}")`);

            if (winName) await m.step('focus', winName, async () => {
                const { focused, skipped } = await smartFocus(winName!);
                if (!focused) return `[Error] Could not focus "${winName}"`;
                if (!skipped) await wait(100);
                return `Focused "${winName}"`;
            });

            const shortcut = (input.shortcut as string | undefined) ?? 'ctrl+shift+e';
            await m.step('shortcut', shortcut, async () => {
                await run(`xdotool key ${shortcut}`); await wait(800);
                return `Triggered ${shortcut}`;
            });

            await m.step('fill_path', exportPath, async () => {
                await run('xdotool key ctrl+a'); await wait(100);
                await run(`xdotool type --delay 10 -- "${exportPath.replace(/"/g, '\\"')}"`); await wait(200);
                return `Typed path: ${exportPath}`;
            });

            await m.step('confirm', 'Enter', async () => {
                await run('xdotool key Return'); await wait(600);
                return 'Pressed Enter';
            });

            // Check for overwrite dialog
            const afterExport = await postVerify(winName);
            if (/overwrite|replace/i.test(afterExport)) {
                await m.step('confirm_overwrite', 'Enter', async () => {
                    await wait(200); await run('xdotool key Return'); await wait(300);
                    return 'Confirmed overwrite';
                });
            }

            const resolvedPath = exportPath.replace(/^~\//, os.homedir() + '/');
            await m.step('verify_file', resolvedPath, async () => {
                const stat = await run(`stat --printf="%s bytes" "${resolvedPath}" 2>/dev/null`);
                return stat.startsWith('[Error]') ? '[Error] File NOT found after export' : `File: ${stat}`;
            });

            return m.finish() + (afterExport ? '\n' + afterExport : '');
        }

        case 'validate_menu_bar': {
            const menus = input.menus as Array<{ label: string; x: number; y: number }> | undefined;
            if (!menus?.length) return '[Error] validate_menu_bar requires "menus": [{label,x,y}, ...]';
            if (!await cmdExists('xdotool')) return '[Error] validate_menu_bar requires xdotool.';

            const m = createTrace(`validate_menu_bar(${menus.length} menus)`);
            if (winName) await m.step('focus', winName, async () => {
                const { focused, skipped } = await smartFocus(winName!);
                if (!focused) return `[Error] Could not focus "${winName}"`;
                if (!skipped) await wait(100);
                return `Focused "${winName}"`;
            });

            const results: Array<Record<string, unknown>> = [];

            for (const menu of menus) {
                const clickResult = await m.step('open_menu', `${menu.label}@(${menu.x},${menu.y})`, async () => {
                    const r = await run(`xdotool mousemove ${menu.x} ${menu.y} click 1`);
                    if (r.startsWith('[Error]')) return r;
                    await wait(350);
                    return `Opened "${menu.label}"`;
                });
                if (clickResult.startsWith('[Error]')) {
                    results.push({ label: menu.label, ok: false, error: clickResult });
                    continue;
                }

                const capture = await captureAndAnalyze({ window: winName });
                const visible = capture.ocr?.targets?.slice(0, 12).map((t) => t.label) ?? [];
                const screenshot = capture.imagePath ?? null;

                results.push({
                    label: menu.label,
                    ok: true,
                    x: menu.x,
                    y: menu.y,
                    screenshot,
                    visible,
                });

                await m.step('close_menu', menu.label, async () => {
                    const r = await run('xdotool key Escape');
                    if (r.startsWith('[Error]')) return r;
                    await wait(150);
                    return `Closed "${menu.label}"`;
                });
            }

            return JSON.stringify({
                ok: results.every((r) => r.ok !== false),
                action: 'validate_menu_bar',
                window: winName ?? null,
                count: menus.length,
                results,
                trace: m.finish(),
            });
        }

        default:
            return null;
    }
}

// ─── AT-SPI actions ───────────────────────────────────────────────────────────

async function execA11y(input: Record<string, unknown>, batchWindow?: string): Promise<string | null> {
    const action = input.action as string;
    const winName = (input.window as string | undefined) ?? batchWindow;
    const appName = (input.app ?? winName ?? '') as string;

    if (!action.startsWith('a11y_')) return null;

    if (!await isA11yAvailable()) {
        return '[Error] AT-SPI not available. Install: sudo apt install gir1.2-atspi-2.0 python3-gi';
    }

    switch (action) {
        case 'a11y_list_apps': {
            const result = await a11yListApps();
            if (result.error) return `[a11y Error] ${result.error}`;
            return `[a11y] Accessible apps: ${(result.apps ?? []).join(', ')}`;
        }

        case 'a11y_get_tree': {
            if (!appName) return '[Error] a11y_get_tree requires "app" or "window".';
            const result = await a11yGetTree(appName, undefined, (input.depth as number | undefined) ?? 4);
            if (result.error) return `[a11y Error] ${result.error}${result.available_apps ? '\nAvailable: ' + result.available_apps.join(', ') : ''}`;
            return `[a11y Tree] ${appName}\n${JSON.stringify(result.tree, null, 2).slice(0, 5000)}`;
        }

        case 'a11y_find': {
            if (!appName || !input.role || !input.name) return '[Error] a11y_find requires "app", "role", "name".';
            const result = await a11yFind(appName, input.role as string, input.name as string);
            if (result.error) return `[a11y Error] ${result.error}`;
            if (!result.found) return `[a11y] Not found: role="${input.role}" name="${input.name}"`;
            if (result.ambiguous) return `[a11y] Ambiguous (${result.candidates} candidates):\n${JSON.stringify(result.top_matches, null, 2).slice(0, 2000)}`;
            return `[a11y Found] ${JSON.stringify(result.match, null, 2)}`;
        }

        case 'a11y_do_action': {
            if (!appName || !input.role || !input.name || !input.a11y_action) {
                return '[Error] a11y_do_action requires "app", "role", "name", "a11y_action".';
            }
            const result = await a11yDoAction(appName, input.role as string, input.name as string, input.a11y_action as string);
            if (result.error) return `[a11y Error] ${result.error}${result.available_actions ? '\nAvailable: ' + result.available_actions.join(', ') : ''}`;
            return `[a11y] Action "${input.a11y_action}" on ${input.role} "${input.name}": ${result.success ? 'success' : 'failed'}`;
        }

        case 'a11y_set_value': {
            if (!appName || !input.role || !input.name || input.value == null) {
                return '[Error] a11y_set_value requires "app", "role", "name", "value".';
            }
            const result = await a11ySetValue(appName, input.role as string, input.name as string, String(input.value));
            if (result.error) return `[a11y Error] ${result.error}`;
            return `[a11y] Set ${input.role} "${input.name}" = "${result.value_read_back ?? result.value_set}"`;
        }

        default:
            return null;
    }
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

async function execSingle(input: Record<string, unknown>, batchWindow?: string): Promise<string> {
    return (
        await execPrimitive(input, batchWindow) ??
        await execMacro(input, batchWindow) ??
        await execA11y(input, batchWindow) ??
        `[Error] Unknown desktop action: "${input.action}". Call gui_interact with action="gui_query" to see available actions.`
    );
}

export async function executeGuiInteract(input: Record<string, unknown>): Promise<string> {
    const action = input.action as string | undefined;
    if (!action) return '[Error] action is required.';

    const winName = ((input.window ?? '') as string).toLowerCase();

    // Capability overview (no side-effects, safe to call anytime)
    if (action === 'gui_query' || action === 'get_desktop_capabilities') {
        return await renderCapabilities();
    }

    // DBus actions
    if (action === 'dbus_control') {
        return executeDbusControl(input);
    }

    // Wayland guard for X11-only actions
    const sessionType = (process.env.XDG_SESSION_TYPE ?? '').toLowerCase();
    const X11_ONLY = new Set(['click', 'type', 'key', 'right_click', 'double_click', 'scroll', 'focus', 'find_window', 'open_menu_path', 'fill_dialog', 'click_and_type', 'export_file']);
    if (sessionType === 'wayland' && X11_ONLY.has(action)) {
        const hasYdotool = await cmdExists('ydotool');
        if (!hasYdotool && !['type', 'key', 'click', 'right_click', 'double_click'].includes(action)) {
            return `[Warning] "${action}" may not work on Wayland without ydotool. Install: sudo apt install ydotool`;
        }
    }

    // Batch mode
    if (action === 'batch_actions') {
        const actions = input.actions as Record<string, unknown>[] | undefined;
        if (!Array.isArray(actions) || actions.length === 0) return '[Error] batch_actions requires "actions" array.';
        if (actions.length > 25) return '[Error] Max 25 steps per batch.';
        const batchWindow = input.window as string | undefined;
        const results: string[] = [];
        let errorCount = 0;

        for (let i = 0; i < actions.length; i++) {
            const step = actions[i];
            if (!step.action) { results.push(`[Step ${i + 1}] [Error] Missing action`); continue; }
            if (!step.delay && ['click', 'key'].includes(step.action as string)) step.delay = 100;

            const stepResult = await execSingle(step, batchWindow);
            results.push(`[Step ${i + 1}: ${step.action}] ${stepResult}`);

            if (stepResult.startsWith('[Error]')) {
                errorCount++;
                recordError(desktopState, step.action as string, batchWindow ?? '');
                console.warn(`[Desktop] Batch step ${i + 1} failed: ${stepResult}`);
                // Abort batch on focus failure (would hit wrong window)
                if (stepResult.includes('Could not focus')) break;
            }
        }

        const stateNote = desktopState.skippedFocusCalls > 0
            ? `\n[State] Skipped ${desktopState.skippedFocusCalls} redundant focus calls`
            : '';
        return results.join('\n') + stateNote + (errorCount > 0 ? `\n[Batch] ${errorCount} step(s) failed.` : '');
    }

    return execSingle(input);
}

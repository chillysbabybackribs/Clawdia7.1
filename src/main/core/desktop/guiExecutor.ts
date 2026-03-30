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
import { captureAndAnalyze, captureScreen, runOcr } from './screenshot';
import { desktopState, recordSuccess, recordError, cacheTarget } from './state';
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

    const sessionType = (process.env.XDG_SESSION_TYPE ?? '').toLowerCase();
    const useYdotool = sessionType === 'wayland' && await cmdExists('ydotool');

    switch (action) {
        case 'list_windows': {
            if (!await cmdExists('wmctrl')) return '[Error] wmctrl not installed. Run: sudo apt install wmctrl';
            return run('wmctrl -l -p');
        }

        case 'find_window': {
            if (!winName) return '[Error] window name required.';
            if (!await cmdExists('xdotool')) return '[Error] xdotool not installed.';
            const ids = await run(`xdotool search --name "${winName}" 2>/dev/null`);
            if (ids.startsWith('[Error]') || ids === '[No output]') return `No windows matching "${winName}".`;
            const wids = ids.split('\n').filter(Boolean).slice(0, 5);
            const details: string[] = [];
            for (const wid of wids) {
                details.push(`  ${wid}: ${await run(`xdotool getwindowname ${wid} 2>/dev/null`)}`);
            }
            return `Found ${wids.length} window(s):\n${details.join('\n')}`;
        }

        case 'focus': {
            if (!winName) return '[Error] window name required.';
            const { focused, skipped } = await smartFocus(winName);
            if (!focused) return `[Error] Could not focus "${winName}".`;
            if (delayMs) await wait(delayMs);
            return skipped ? `Focused: "${winName}" [cached — already focused]` : `Focused: "${winName}"`;
        }

        case 'maximize_window': {
            if (!winName) return '[Error] window name required.';
            const { focused } = await smartFocus(winName);
            if (!focused) return `[Error] Could not focus "${winName}" — aborting maximize.`;
            await wait(100);

            if (await cmdExists('wmctrl')) {
                const result = await run(`wmctrl -r "${winName}" -b add,maximized_vert,maximized_horz 2>&1`);
                if (!result.startsWith('[Error]')) {
                    recordSuccess(desktopState, 'maximize_window', winName);
                    return `Maximized "${winName}"`;
                }
            }

            if (await cmdExists('xdotool')) {
                const keyResult = await run('xdotool key alt+F10 2>&1');
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
            const { focused } = await smartFocus(winName);
            if (!focused) return `[Error] Could not focus "${winName}" — aborting fullscreen.`;
            await wait(100);

            if (await cmdExists('wmctrl')) {
                const result = await run(`wmctrl -r "${winName}" -b add,fullscreen 2>&1`);
                if (!result.startsWith('[Error]')) {
                    recordSuccess(desktopState, 'fullscreen_window', winName);
                    return `Fullscreened "${winName}"`;
                }
            }

            if (await cmdExists('xdotool')) {
                const keyResult = await run('xdotool key F11 2>&1');
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
            if (winName) {
                const { focused } = await smartFocus(winName);
                if (!focused) return `[Error] Could not focus "${winName}" — aborting click.`;
                await wait(100);
            }
            if (delayMs) await wait(delayMs);
            const clickResult = useYdotool
                ? await run(`ydotool mousemove -a ${x} ${y} && ydotool click 0x00`)
                : await run(`xdotool mousemove ${x} ${y} click 1`);
            if (clickResult.startsWith('[Error]')) {
                recordError(desktopState, 'click', `(${x},${y})`);
                return clickResult;
            }
            recordSuccess(desktopState, 'click', `(${x},${y})`);
            let verifyBlock = '';
            if (shouldVerify('click', input, x, y)) verifyBlock = await postVerify(winName);
            return `Clicked (${x}, ${y})${verifyBlock ? '\n' + verifyBlock : ''}`;
        }

        case 'type': {
            if (!text) return '[Error] text required.';
            if (!await cmdExists('xdotool') && !useYdotool) return '[Error] xdotool/ydotool not installed.';
            if (winName) {
                const { focused } = await smartFocus(winName);
                if (!focused) return `[Error] Could not focus "${winName}" — aborting type.`;
                await wait(100);
            }
            if (delayMs) await wait(delayMs);
            const escaped = text.replace(/"/g, '\\"');
            const typeResult = useYdotool
                ? await run(`ydotool type -- "${escaped}"`)
                : await run(`xdotool type --delay 15 -- "${escaped}"`);
            if (typeResult.startsWith('[Error]')) return typeResult;
            recordSuccess(desktopState, 'type', text.slice(0, 30));
            return `Typed "${text.slice(0, 50)}"`;
        }

        case 'key': {
            if (!text) return '[Error] key combo required (e.g. "ctrl+s", "Return").';
            if (!await cmdExists('xdotool') && !useYdotool) return '[Error] xdotool/ydotool not installed.';
            if (winName) {
                const { focused } = await smartFocus(winName);
                if (!focused) return `[Error] Could not focus "${winName}" — aborting key press.`;
                await wait(100);
            }
            if (delayMs) await wait(delayMs);
            const keyResult = useYdotool
                ? await run(`ydotool key ${text}`)
                : await run(`xdotool key ${text}`);
            if (keyResult.startsWith('[Error]')) return keyResult;
            recordSuccess(desktopState, 'key', text);
            let verifyBlock = '';
            if (shouldVerify('key', input)) verifyBlock = await postVerify(winName);
            return `Key: ${text}${verifyBlock ? '\n' + verifyBlock : ''}`;
        }

        case 'right_click': {
            if (x == null || y == null) return '[Error] x and y required.';
            if (winName) {
                const { focused } = await smartFocus(winName);
                if (!focused) return `[Error] Could not focus "${winName}".`;
                await wait(100);
            }
            if (delayMs) await wait(delayMs);
            const rcResult = useYdotool
                ? await run(`ydotool mousemove -a ${x} ${y} && ydotool click 0x02`)
                : await run(`xdotool mousemove ${x} ${y} click 3`);
            return rcResult.startsWith('[Error]') ? rcResult : `Right-clicked (${x}, ${y})`;
        }

        case 'double_click': {
            if (x == null || y == null) return '[Error] x and y required.';
            if (winName) {
                const { focused } = await smartFocus(winName);
                if (!focused) return `[Error] Could not focus "${winName}".`;
                await wait(100);
            }
            if (delayMs) await wait(delayMs);
            const dcResult = useYdotool
                ? await run(`ydotool mousemove -a ${x} ${y} && ydotool click 0x00 && ydotool click 0x00`)
                : await run(`xdotool mousemove ${x} ${y} click --repeat 2 1`);
            return dcResult.startsWith('[Error]') ? dcResult : `Double-clicked (${x}, ${y})`;
        }

        case 'scroll': {
            const direction = (input.direction as string | undefined) ?? 'down';
            const amount = (input.amount as number | undefined) ?? 3;
            if (winName) {
                const { focused } = await smartFocus(winName);
                if (!focused) return `[Error] Could not focus "${winName}".`;
                await wait(100);
            }
            const btn = direction === 'up' ? 4 : direction === 'left' ? 6 : direction === 'right' ? 7 : 5;
            const scrollResult = useYdotool
                ? `[Info] ydotool scroll not directly supported — use xdotool`
                : await run(`xdotool click --repeat ${amount} --delay 50 ${btn}`);
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
            const title = await run('xdotool getactivewindow getwindowname 2>/dev/null');
            if (title.startsWith('[Error]')) return title;
            return `Active window: "${title.trim()}"`;
        }

        case 'verify_file_exists': {
            const filePath = (input.path ?? text) as string | undefined;
            if (!filePath) return '[Error] path or text (filepath) required.';
            const stat = await run(`stat --printf="%s bytes, modified %y" "${filePath}" 2>/dev/null`);
            return stat.startsWith('[Error]') ? `File not found: ${filePath}` : `File exists: ${filePath} (${stat})`;
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

    switch (action) {
        case 'app_launch':
        case 'launch_and_focus': {
            const appBinary = (input.app ?? text) as string | undefined;
            if (!appBinary) return '[Error] app_launch requires "app" (binary name).';
            const windowMatch = winName ?? appBinary;
            const m = createTrace(`app_launch("${appBinary}")`);

            await m.step('launch', appBinary, async () => {
                await run(`setsid ${appBinary} >/dev/null 2>&1 &`);
                return `Launched ${appBinary} in background`;
            });

            const waitResult = await m.step('wait_for_window', windowMatch, async () => {
                const launchStart = Date.now();
                while (Date.now() - launchStart < 12_000) {
                    await wait(500);
                    const windows = await run('wmctrl -l 2>/dev/null');
                    if (new RegExp(windowMatch, 'i').test(windows)) {
                        return `Window "${windowMatch}" appeared after ${Date.now() - launchStart}ms`;
                    }
                }
                return `[Error] No window matching "${windowMatch}" within 12s`;
            });
            if (waitResult.startsWith('[Error]')) return `${m.finish()}\n${waitResult}`;

            await m.step('focus', windowMatch, async () => {
                await smartFocus(windowMatch);
                await wait(500);
                return `Focused "${windowMatch}"`;
            });

            const { summary } = await captureAndAnalyze({ window: windowMatch });
            return `${m.finish()}\n\nLaunched and focused "${appBinary}"\n${summary}`;
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

    // Guard: never use gui_interact on Clawdia/Electron itself
    const winName = ((input.window ?? '') as string).toLowerCase();
    if (/clawdia|electron|chromium|browser/i.test(winName) && action !== 'list_windows' && action !== 'verify_window_title') {
        return '[Error] Do not use gui_interact on the browser — use browser_* tools for DOM-level interaction.';
    }

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

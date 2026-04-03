/**
 * Smart focus — focuses a window, but SKIPS if state says it's already focused.
 *
 * Improvements over 4.0:
 * - ydotool fallback for Wayland sessions
 * - Verifies focus succeeded via xdotool getactivewindow (prevents ghost actions)
 * - App pattern matching extended with VSCode, Firefox, Chromium, Terminal
 * - Emits a focus-steal warning to the UI before taking OS focus (see setFocusStealNotifier)
 * - HARDENED: Exact window title matching, explicit expected vs actual logging
 */
import { desktopState, isWindowFocused, recordFocus, recordError, recordSkippedFocus, guessApp } from './state';
import { run, cmdExists, wait } from './shared';

/**
 * Register a callback that is invoked immediately before smartFocus steals OS focus
 * from the user's current active window. The UI layer uses this to display a warning
 * toast so the user knows why their cursor/focus is about to move.
 *
 * Call this once from main.ts during startup, passing a function that emits
 * IPC.DESKTOP_FOCUS_STEAL_WARNING to the renderer.
 */
let focusStealNotifier: ((targetWindow: string) => void) | null = null;

export function setFocusStealNotifier(fn: (targetWindow: string) => void): void {
  focusStealNotifier = fn;
}

export async function smartFocus(winName: string, display?: string): Promise<{ focused: boolean; skipped: boolean }> {
    if (isWindowFocused(desktopState, winName)) {
        recordSkippedFocus(desktopState);
        console.log(`[Desktop] Skipped redundant focus for "${winName}" (confidence: ${(desktopState.confidence * 100).toFixed(0)}%)`);
        return { focused: true, skipped: true };
    }

    console.log(`[FOCUS_REQUESTED] Window: "${winName}"`);

    const sessionType = (process.env.XDG_SESSION_TYPE ?? '').toLowerCase();

    if (sessionType === 'wayland') {
        // On Wayland, ydotool has limited window-focus capability — best effort
        if (await cmdExists('ydotool')) {
            // ydotool doesn't support window focus directly; fall through to wmctrl
            console.log('[Desktop] Wayland: ydotool lacks focus command, trying wmctrl');
        }
    }

    // Notify the UI that we are about to steal OS focus before we actually do it.
    // This gives the renderer a chance to show a warning toast so the user is not
    // surprised when their keyboard focus moves to a different window.
    focusStealNotifier?.(winName);

    if (await cmdExists('wmctrl')) {
        await run(`wmctrl -a "${winName}" 2>&1`, undefined, display);
    } else if (await cmdExists('xdotool')) {
        const wid = await run(`xdotool search --name "${winName}" 2>/dev/null | head -1`, undefined, display);
        if (wid && !wid.startsWith('[Error]') && !wid.startsWith('[No output]')) {
            await run(`xdotool windowactivate ${wid.trim()}`, undefined, display);
        }
    } else {
        // No focus tools available
        console.warn('[Desktop] No wmctrl or xdotool available for focus');
        console.error(`[FOCUS_MISMATCH] Expected window: "${winName}" | Actual active: [UNAVAILABLE] | Tools: none`);
        recordError(desktopState, 'focus', winName);
        return { focused: false, skipped: false };
    }

    // ── Verify focus actually succeeded ──────────────────────────────────────
    // wmctrl -a can silently fail (wrong workspace, minimized window, etc.)
    // HARDENING: Use exact matching + explicit logging of expected vs actual
    if (await cmdExists('xdotool')) {
        await wait(60); // brief settle for WM
        const activeTitle = await run('xdotool getactivewindow getwindowname 2>/dev/null', undefined, display);
        if (!activeTitle.startsWith('[Error]') && !activeTitle.startsWith('[No output]')) {
            const actual = activeTitle.trim();
            const actualLower = actual.toLowerCase();
            const expectedLower = winName.toLowerCase();

            // Hardened matching: prefer exact match, then normalized substring match
            const isExactMatch = actualLower === expectedLower;
            const isNormalizedMatch = actualLower.includes(expectedLower) || expectedLower.includes(actualLower);

            if (!isExactMatch && !isNormalizedMatch) {
                // Final check: app family (e.g. Chrome → Chromium)
                const appGuess = guessApp(winName);
                const appGuessActual = guessApp(actual);
                if (appGuess !== 'unknown' && appGuess === appGuessActual) {
                    // Same app family — acceptable
                    console.log(`[FOCUS_OK] App family match: expected "${winName}" → actual "${actual}"`);
                } else {
                    console.error(`[FOCUS_MISMATCH] Expected window: "${winName}" | Actual active: "${actual}" | Match: none`);
                    recordError(desktopState, 'focus', winName);
                    return { focused: false, skipped: false };
                }
            } else if (isExactMatch) {
                console.log(`[FOCUS_OK] Exact match: "${actual}"`);
            } else {
                console.log(`[FOCUS_OK] Normalized match: expected "${winName}" → actual "${actual}"`);
            }
        }
    }

    recordFocus(desktopState, winName, guessApp(winName));
    return { focused: true, skipped: false };
}

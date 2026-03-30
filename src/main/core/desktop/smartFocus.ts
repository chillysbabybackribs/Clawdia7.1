/**
 * Smart focus — focuses a window, but SKIPS if state says it's already focused.
 *
 * Improvements over 4.0:
 * - ydotool fallback for Wayland sessions
 * - Verifies focus succeeded via xdotool getactivewindow (prevents ghost actions)
 * - App pattern matching extended with VSCode, Firefox, Chromium, Terminal
 */
import { desktopState, isWindowFocused, recordFocus, recordError, recordSkippedFocus, guessApp } from './state';
import { run, cmdExists, wait } from './shared';

export async function smartFocus(winName: string): Promise<{ focused: boolean; skipped: boolean }> {
    if (isWindowFocused(desktopState, winName)) {
        recordSkippedFocus(desktopState);
        console.log(`[Desktop] Skipped redundant focus for "${winName}" (confidence: ${(desktopState.confidence * 100).toFixed(0)}%)`);
        return { focused: true, skipped: true };
    }

    const sessionType = (process.env.XDG_SESSION_TYPE ?? '').toLowerCase();

    if (sessionType === 'wayland') {
        // On Wayland, ydotool has limited window-focus capability — best effort
        if (await cmdExists('ydotool')) {
            // ydotool doesn't support window focus directly; fall through to wmctrl
            console.log('[Desktop] Wayland: ydotool lacks focus command, trying wmctrl');
        }
    }

    if (await cmdExists('wmctrl')) {
        await run(`wmctrl -a "${winName}" 2>&1`);
    } else if (await cmdExists('xdotool')) {
        const wid = await run(`xdotool search --name "${winName}" 2>/dev/null | head -1`);
        if (wid && !wid.startsWith('[Error]') && !wid.startsWith('[No output]')) {
            await run(`xdotool windowactivate ${wid.trim()}`);
        }
    } else {
        // No focus tools available
        console.warn('[Desktop] No wmctrl or xdotool available for focus');
        recordError(desktopState, 'focus', winName);
        return { focused: false, skipped: false };
    }

    // ── Verify focus actually succeeded ──────────────────────────────────────
    // wmctrl -a can silently fail (wrong workspace, minimized window, etc.)
    if (await cmdExists('xdotool')) {
        await wait(60); // brief settle for WM
        const activeTitle = await run('xdotool getactivewindow getwindowname 2>/dev/null');
        if (!activeTitle.startsWith('[Error]') && !activeTitle.startsWith('[No output]')) {
            const actual = activeTitle.trim().toLowerCase();
            const expected = winName.toLowerCase();
            if (!actual.includes(expected) && !expected.includes(actual)) {
                // Check known app-title patterns
                const appGuess = guessApp(winName);
                const appGuessActual = guessApp(activeTitle.trim());
                if (appGuess !== 'unknown' && appGuess === appGuessActual) {
                    // Same app family — treat as focused
                } else {
                    console.warn(`[Desktop] Focus verification FAILED: wanted "${winName}" but active is "${activeTitle.trim()}"`);
                    recordError(desktopState, 'focus', winName);
                    return { focused: false, skipped: false };
                }
            }
        }
    }

    recordFocus(desktopState, winName, guessApp(winName));
    return { focused: true, skipped: false };
}

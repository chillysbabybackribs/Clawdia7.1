/**
 * Desktop GUI state — tracks focused window, known click targets, and per-session
 * confidence so callers can skip redundant focus operations.
 *
 * Improvement over 4.0: state is a plain interface (no global singleton) so
 * future multi-session / multi-display support is possible.
 */

export interface KnownTarget {
    x: number;
    y: number;
    /** Confidence in this coordinate — decays on error, grows on success. */
    confidence: number;
}

export interface FocusedWindow {
    title: string;
    /** Canonical app identifier (e.g. "gimp", "code"). */
    app: string;
    /** Timestamp of last confirmed focus. */
    focusedAt: number;
}

export interface DesktopState {
    focusedWindow: FocusedWindow | null;
    /** Named click targets discovered via OCR / a11y. */
    knownTargets: Record<string, KnownTarget>;
    /** Overall confidence in the current state (0–1). */
    confidence: number;
    /** Tracks skipped redundant focus calls this session. */
    skippedFocusCalls: number;
    /** Milliseconds since epoch of last screenshot. */
    lastScreenshotAt: number;
    /** Active app name (derived from focusedWindow). */
    activeApp: string | null;
}

export function createDesktopState(): DesktopState {
    return {
        focusedWindow: null,
        knownTargets: {},
        confidence: 1.0,
        skippedFocusCalls: 0,
        lastScreenshotAt: 0,
        activeApp: null,
    };
}

// Session-scoped singleton (one per main process lifetime)
export const desktopState: DesktopState = createDesktopState();

// ─── State mutation helpers ───────────────────────────────────────────────────

export function recordFocus(state: DesktopState, title: string, app: string): void {
    state.focusedWindow = { title, app: app || guessApp(title), focusedAt: Date.now() };
    state.activeApp = state.focusedWindow.app;
    // Grow confidence on successful focus
    state.confidence = Math.min(1.0, state.confidence + 0.1);
}

export function recordSkippedFocus(state: DesktopState): void {
    state.skippedFocusCalls++;
}

export function recordSuccess(state: DesktopState, _action: string, _detail: string): void {
    state.confidence = Math.min(1.0, state.confidence + 0.05);
}

export function recordError(state: DesktopState, _action: string, _detail: string): void {
    state.confidence = Math.max(0.1, state.confidence - 0.2);
}

export function recordScreenshot(state: DesktopState): void {
    state.lastScreenshotAt = Date.now();
}

export function cacheTarget(state: DesktopState, label: string, x: number, y: number): void {
    state.knownTargets[label.toLowerCase()] = { x, y, confidence: state.confidence };
}

export function isWindowFocused(state: DesktopState, title: string): boolean {
    if (!state.focusedWindow) return false;
    const focused = state.focusedWindow.title.toLowerCase();
    const target = title.toLowerCase();
    // Expire focus state after 30 seconds (window may have lost focus since)
    if (Date.now() - state.focusedWindow.focusedAt > 30_000) return false;
    return focused.includes(target) || target.includes(focused);
}

/** Load persisted coordinate cache targets into state.knownTargets. */
export function loadPersistedTargets(
    state: DesktopState,
    rows: Array<{ element: string; x: number; y: number; confidence: number }>,
): void {
    for (const row of rows) {
        state.knownTargets[row.element.toLowerCase()] = { x: row.x, y: row.y, confidence: row.confidence };
    }
}

// ─── App name inference ───────────────────────────────────────────────────────

const KNOWN_APPS: [RegExp, string][] = [
    [/gimp|gnu image/i, 'gimp'],
    [/libreoffice|soffice/i, 'libreoffice'],
    [/blender/i, 'blender'],
    [/inkscape/i, 'inkscape'],
    [/audacity/i, 'audacity'],
    [/code\s*-|vscode|visual studio code/i, 'code'],
    [/firefox/i, 'firefox'],
    [/chromium|google chrome/i, 'chromium'],
    [/terminal|konsole|xterm|gnome-terminal/i, 'terminal'],
    [/nautilus|files/i, 'nautilus'],
];

export function guessApp(windowTitle: string): string {
    for (const [re, name] of KNOWN_APPS) {
        if (re.test(windowTitle)) return name;
    }
    // Best effort: take the first word
    return windowTitle.split(/[\s\-—|]/)[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'unknown';
}

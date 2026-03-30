/**
 * Capability detection — probes the system for available desktop automation
 * tools and returns a structured report the model can use to decide strategy.
 *
 * Improvements over 4.0:
 * - Detects Wayland vs X11 and explains implications
 * - Checks for ydotool (Wayland-compatible xdotool alternative)
 * - Detects xrandr monitor layout
 * - Checks for tesseract OCR
 */
import { cmdExists, execAsync } from './shared';

export interface DesktopCapabilities {
    sessionType: 'x11' | 'wayland' | 'unknown';
    xdotool: boolean;
    ydotool: boolean;    // Wayland-compatible alternative to xdotool
    wmctrl: boolean;
    scrot: boolean;
    gnomeScreenshot: boolean;
    dbusSend: boolean;
    tesseract: boolean;
    atspi: boolean;
    monitors: string[];
}

let _cached: DesktopCapabilities | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

export async function getCapabilities(forceRefresh = false): Promise<DesktopCapabilities> {
    if (_cached && !forceRefresh && Date.now() - _cacheTime < CACHE_TTL_MS) {
        return _cached;
    }

    const sessionType = (process.env.XDG_SESSION_TYPE ?? 'unknown').toLowerCase();

    const [xdotool, ydotool, wmctrl, scrot, gnomeScreenshot, dbusSend, tesseract] = await Promise.all([
        cmdExists('xdotool'),
        cmdExists('ydotool'),
        cmdExists('wmctrl'),
        cmdExists('scrot'),
        cmdExists('gnome-screenshot'),
        cmdExists('dbus-send'),
        cmdExists('tesseract'),
    ]);

    const [atspi, monitors] = await Promise.all([
        (async () => {
            try {
                await execAsync("python3 -c \"import gi; gi.require_version('Atspi', '2.0'); from gi.repository import Atspi\" 2>/dev/null", {
                    timeout: 750,
                });
                return true;
            } catch {
                return false;
            }
        })(),
        (async () => {
            try {
                const { stdout } = await execAsync('xrandr --current 2>/dev/null', { timeout: 750 });
                return stdout
                    .split('\n')
                    .filter((l) => / connected/.test(l))
                    .map((l) => {
                        const name = l.split(' ')[0];
                        const primary = l.includes('primary');
                        const geom = l.match(/(\d+x\d+\+\d+\+\d+)/)?.[1] ?? '';
                        return `${name}: ${geom}${primary ? ' (primary)' : ''}`;
                    });
            } catch {
                return [] as string[];
            }
        })(),
    ]);

    _cached = {
        sessionType: sessionType === 'wayland' ? 'wayland' : sessionType === 'x11' ? 'x11' : 'unknown',
        xdotool,
        ydotool,
        wmctrl,
        scrot,
        gnomeScreenshot,
        dbusSend,
        tesseract,
        atspi,
        monitors,
    };
    _cacheTime = Date.now();
    return _cached;
}

/** Render a human-readable capability summary for injection into the system prompt. */
export async function renderCapabilities(): Promise<string> {
    const c = await getCapabilities();

    const lines: string[] = ['[Desktop capabilities]'];

    if (c.sessionType === 'wayland') {
        lines.push('Session: Wayland ⚠ xdotool is limited or broken. Use ydotool if available, or AT-SPI.');
    } else {
        lines.push(`Session: ${c.sessionType}`);
    }

    if (c.monitors.length > 0) {
        lines.push(`Monitors: ${c.monitors.join(', ')}`);
    }

    const guiTools = [
        c.xdotool && 'xdotool',
        c.ydotool && 'ydotool',
        c.wmctrl && 'wmctrl',
    ].filter(Boolean);
    lines.push(`GUI tools: ${guiTools.length ? guiTools.join(', ') : 'none — sudo apt install xdotool wmctrl'}`);

    const screenTools = [
        c.scrot && 'scrot',
        c.gnomeScreenshot && 'gnome-screenshot',
        c.tesseract && 'tesseract (OCR)',
    ].filter(Boolean);
    lines.push(`Screenshot/OCR: ${screenTools.length ? screenTools.join(', ') : 'none'}`);

    lines.push(`DBus: ${c.dbusSend ? 'available (dbus-send)' : 'not found'}`);
    lines.push(`AT-SPI accessibility: ${c.atspi ? 'available — use a11y_* actions for reliable element access' : 'not installed (sudo apt install gir1.2-atspi-2.0)'}`);

    if (!c.xdotool && !c.ydotool && !c.wmctrl) {
        lines.push('⚠ No GUI automation tools found. Install: sudo apt install xdotool wmctrl scrot');
    }

    return lines.join('\n');
}

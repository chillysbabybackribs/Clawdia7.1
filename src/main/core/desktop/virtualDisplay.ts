/**
 * Virtual X display manager (Xvfb).
 *
 * Provides an isolated X11 display for agent desktop automation so that
 * xdotool/ydotool actions do not move the user's real cursor or steal focus
 * from their active windows.
 *
 * Usage:
 *   const vd = VirtualDisplay.getInstance();
 *   await vd.ensure();            // starts Xvfb if not running
 *   const display = vd.display;   // ':99' or null if unavailable
 *   vd.stop();                    // call on app exit
 *
 * The display number (:99) is chosen to avoid conflicts with the user's
 * primary display (:0) and common secondary displays (:1–:10).
 * If :99 is taken, we try :98, :97, … down to :90.
 *
 * Xvfb is started with a 1920×1080 24-bit framebuffer. A window manager
 * (openbox/fluxbox) is optionally started if available so that apps launched
 * inside the virtual display can position and resize correctly.
 */

import { spawn, type ChildProcess } from 'child_process';
import { execAsync } from './shared';

const DISPLAY_CANDIDATES = Array.from({ length: 10 }, (_, i) => `:${99 - i}`);
const SCREEN_SPEC = '1920x1080x24';
const SETTLE_MS = 600; // time for Xvfb to open the socket

export class VirtualDisplay {
  private static _instance: VirtualDisplay | null = null;

  private xvfbProc: ChildProcess | null = null;
  private wmProc: ChildProcess | null = null;
  private _display: string | null = null;
  private _startPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): VirtualDisplay {
    if (!VirtualDisplay._instance) {
      VirtualDisplay._instance = new VirtualDisplay();
    }
    return VirtualDisplay._instance;
  }

  /** The display string (e.g. ':99') or null if Xvfb is not running. */
  get display(): string | null {
    return this._display;
  }

  /**
   * Ensure the virtual display is running.
   * Idempotent — safe to call multiple times concurrently.
   * Resolves even if Xvfb is unavailable; check .display afterward.
   */
  async ensure(): Promise<void> {
    if (this._display) return;
    if (this._startPromise) return this._startPromise;
    this._startPromise = this._start().catch((err) => {
      console.warn('[VirtualDisplay] Failed to start Xvfb:', err.message);
      this._startPromise = null;
    });
    return this._startPromise;
  }

  private async _start(): Promise<void> {
    // Check Xvfb binary
    try {
      await execAsync('which Xvfb');
    } catch {
      console.warn('[VirtualDisplay] Xvfb not found — desktop isolation unavailable');
      return;
    }

    // Find a free display number
    const display = await this._findFreeDisplay();
    if (!display) {
      console.warn('[VirtualDisplay] No free display number found in range :90–:99');
      return;
    }

    // Launch Xvfb
    const proc = spawn('Xvfb', [display, '-screen', '0', SCREEN_SPEC, '-ac', '-nolisten', 'tcp'], {
      detached: false,
      stdio: 'ignore',
    });

    proc.on('error', (err) => {
      console.warn(`[VirtualDisplay] Xvfb error: ${err.message}`);
      if (this._display === display) this._display = null;
    });

    proc.on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.warn(`[VirtualDisplay] Xvfb exited with code ${code}`);
      }
      if (this._display === display) this._display = null;
    });

    // Wait for Xvfb to open the Unix socket
    await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS));

    // Verify the display is actually accepting connections
    try {
      await execAsync(`DISPLAY=${display} xdpyinfo`, { timeout: 2000 });
    } catch {
      console.warn(`[VirtualDisplay] Xvfb started but display ${display} not responsive`);
      proc.kill();
      return;
    }

    this.xvfbProc = proc;
    this._display = display;
    console.log(`[VirtualDisplay] Xvfb running on ${display}`);

    // Optionally start a lightweight window manager for proper window layout
    this._tryStartWm(display);
  }

  private async _findFreeDisplay(): Promise<string | null> {
    for (const d of DISPLAY_CANDIDATES) {
      try {
        // If xdpyinfo succeeds, the display is already in use
        await execAsync(`DISPLAY=${d} xdpyinfo 2>/dev/null`, { timeout: 500 });
        // In use — try next
      } catch {
        // Not in use — also check the lock file
        const lockFile = `/tmp/.X${d.slice(1)}-lock`;
        try {
          await execAsync(`test -f ${lockFile}`, { timeout: 200 });
          // Lock file exists — skip
        } catch {
          return d; // free
        }
      }
    }
    return null;
  }

  private _tryStartWm(display: string): void {
    // Try openbox first, then fluxbox, then icewm — all are lightweight.
    // Failure is silent; Xvfb works without a WM.
    for (const wm of ['openbox', 'fluxbox', 'icewm', 'matchbox-window-manager']) {
      try {
        const proc = spawn(wm, [], {
          env: { ...process.env, DISPLAY: display },
          detached: false,
          stdio: 'ignore',
        });
        proc.on('error', () => {}); // binary not found
        proc.on('spawn', () => {
          console.log(`[VirtualDisplay] Window manager "${wm}" started on ${display}`);
          this.wmProc = proc;
        });
        break;
      } catch {
        // try next
      }
    }
  }

  /** Stop the virtual display and WM. Called on app exit. */
  stop(): void {
    this.wmProc?.kill();
    this.wmProc = null;
    this.xvfbProc?.kill();
    this.xvfbProc = null;
    this._display = null;
    this._startPromise = null;
  }
}

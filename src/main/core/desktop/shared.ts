import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

export const execAsync = promisify(exec);
// Desktop timeout budget — increased to 45s for realistic GUI wait times
// (app launches, window detection, screenshot/OCR can be slow on slower hardware)
export const TIMEOUT = 45_000;

/**
 * Run a shell command with DISPLAY set. Returns merged stdout/stderr or [Error].
 *
 * @param display  Override the X11 display (e.g. ':99' for virtual display).
 *                 Defaults to DISPLAY env var or ':0'.
 */
export async function run(command: string, timeout = TIMEOUT, display?: string): Promise<string> {
    try {
        const { stdout, stderr } = await execAsync(command, {
            timeout,
            cwd: os.homedir(),
            env: { ...process.env, DISPLAY: display ?? process.env.DISPLAY ?? ':0' },
            maxBuffer: 1024 * 1024 * 4,
        });
        let result = stdout.trim();
        if (stderr.trim()) result += (result ? '\n[stderr] ' : '[stderr] ') + stderr.trim();
        return result || '[No output]';
    } catch (err: any) {
        const out = err.stdout?.trim() || '';
        const se = err.stderr?.trim() || '';
        return `[Error] ${se || out || err.message}`;
    }
}

/** Run a command with stdout and stderr kept separate (for parseable output like JSON). */
export async function runSeparate(
    command: string,
    timeout = TIMEOUT,
): Promise<{ stdout: string; stderr: string }> {
    try {
        const result = await execAsync(command, {
            timeout,
            cwd: os.homedir(),
            env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
            maxBuffer: 1024 * 1024 * 4,
        });
        return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
    } catch (err: any) {
        return { stdout: '', stderr: err.message };
    }
}

const toolCache: Record<string, boolean> = {};

/** Cached binary existence check. */
export async function cmdExists(cmd: string): Promise<boolean> {
    if (cmd in toolCache) return toolCache[cmd];
    try {
        await execAsync(`which ${cmd} 2>/dev/null`);
        toolCache[cmd] = true;
    } catch {
        toolCache[cmd] = false;
    }
    return toolCache[cmd];
}

/** Invalidate a cached cmdExists result (e.g. after installing a tool). */
export function invalidateCmdCache(cmd: string): void {
    delete toolCache[cmd];
}

export function wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Clipboard tools — read/write/watch the system clipboard.
 *
 * Supports both X11 (xclip/xsel) and Wayland (wl-copy/wl-paste).
 * Auto-detects session type and uses the right backend.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);
const TIMEOUT = 5_000;

// ─── Session detection ────────────────────────────────────────────────────────

function isWayland(): boolean {
  return (process.env.XDG_SESSION_TYPE ?? '').toLowerCase() === 'wayland';
}

async function hasBin(name: string): Promise<boolean> {
  try {
    await execAsync(`which ${name} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

async function getReadCmd(): Promise<string | null> {
  if (isWayland()) {
    if (await hasBin('wl-paste')) return 'wl-paste --no-newline 2>/dev/null';
  }
  if (await hasBin('xclip')) return 'xclip -selection clipboard -o 2>/dev/null';
  if (await hasBin('xsel')) return 'xsel --clipboard --output 2>/dev/null';
  if (await hasBin('wl-paste')) return 'wl-paste --no-newline 2>/dev/null';
  return null;
}

async function getWriteCmd(): Promise<string | null> {
  if (isWayland()) {
    if (await hasBin('wl-copy')) return 'wl-copy';
  }
  if (await hasBin('xclip')) return 'xclip -selection clipboard';
  if (await hasBin('xsel')) return 'xsel --clipboard --input';
  if (await hasBin('wl-copy')) return 'wl-copy';
  return null;
}

// ─── Executor ─────────────────────────────────────────────────────────────────

export async function executeClipboardTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case 'clipboard_read': {
        const cmd = await getReadCmd();
        if (!cmd) {
          return JSON.stringify({
            ok: false,
            error: 'No clipboard tool found. Install: sudo apt install xclip (X11) or wl-clipboard (Wayland)',
          });
        }
        try {
          const { stdout } = await execAsync(cmd, {
            timeout: TIMEOUT,
            env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
          });
          const text = stdout ?? '';
          return JSON.stringify({
            ok: true,
            content: text.slice(0, 10_000),
            length: text.length,
            truncated: text.length > 10_000,
          });
        } catch {
          return JSON.stringify({ ok: true, content: '', length: 0, note: 'Clipboard is empty or contains non-text data.' });
        }
      }

      case 'clipboard_write': {
        const text = input.text as string;
        if (!text && text !== '') {
          return JSON.stringify({ ok: false, error: 'text is required.' });
        }
        const cmd = await getWriteCmd();
        if (!cmd) {
          return JSON.stringify({
            ok: false,
            error: 'No clipboard tool found. Install: sudo apt install xclip (X11) or wl-clipboard (Wayland)',
          });
        }
        const child = require('child_process').spawn(cmd.split(' ')[0], cmd.split(' ').slice(1), {
          env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        child.stdin.write(text);
        child.stdin.end();
        await new Promise<void>((resolve, reject) => {
          child.on('close', (code: number | null) => {
            if (code === 0 || code === null) resolve();
            else reject(new Error(`Clipboard write exited with code ${code}`));
          });
          child.on('error', reject);
          setTimeout(() => { child.kill(); reject(new Error('timeout')); }, TIMEOUT);
        });
        return JSON.stringify({ ok: true, written: text.length });
      }

      case 'clipboard_copy_file': {
        const filePath = input.path as string;
        if (!filePath) return JSON.stringify({ ok: false, error: 'path is required.' });
        if (!fs.existsSync(filePath)) {
          return JSON.stringify({ ok: false, error: `File not found: ${filePath}` });
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        // Recurse into clipboard_write
        return executeClipboardTool('clipboard_write', { text: content });
      }

      default:
        return JSON.stringify({ ok: false, error: `Unknown clipboard tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

// ─── Tool schemas ─────────────────────────────────────────────────────────────

export const CLIPBOARD_TOOLS: Anthropic.Tool[] = [
  {
    name: 'clipboard_read',
    description: 'Read the current contents of the system clipboard. Returns the text content. Works on both X11 and Wayland.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'clipboard_write',
    description: 'Write text to the system clipboard. The text can then be pasted into any application. Works on both X11 and Wayland.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to write to the clipboard.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'clipboard_copy_file',
    description: 'Read a file and copy its contents to the system clipboard.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to copy.' },
      },
      required: ['path'],
    },
  },
];

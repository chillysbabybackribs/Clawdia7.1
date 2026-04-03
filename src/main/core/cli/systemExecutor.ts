// src/main/core/cli/systemExecutor.ts
// Executes system-level tools: safeStorage, net.fetch, globalShortcut, RemoteDesktop portal.
import { globalShortcut, net, session, BrowserWindow } from 'electron';
import { storeSecret, retrieveSecret, deleteSecret, listSecretKeys, isEncryptionAvailable } from '../../safeStorage';
import * as remoteDesktop from '../desktop/remoteDesktop';

const PARTITION = 'persist:clawdia-browser';
const MAX_RESPONSE_SIZE = 1_048_576; // 1MB default

// ── Global shortcut state ───────────────────────────────────────────────────────
const registeredShortcuts = new Map<string, string>(); // accelerator → actionName
const shortcutCallbacks: Array<(actionName: string, accelerator: string) => void> = [];

/** Subscribe to global shortcut triggers. */
export function onGlobalShortcut(cb: (actionName: string, accelerator: string) => void): () => void {
  shortcutCallbacks.push(cb);
  return () => {
    const idx = shortcutCallbacks.indexOf(cb);
    if (idx >= 0) shortcutCallbacks.splice(idx, 1);
  };
}

export async function executeSystemTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    // ── safeStorage ──
    case 'system_secret_store': {
      if (!isEncryptionAvailable()) {
        return { ok: false, error: 'OS keychain encryption not available (libsecret/gnome-keyring not running)' };
      }
      const success = storeSecret(input.key as string, input.value as string);
      return { ok: success };
    }
    case 'system_secret_retrieve': {
      if (!isEncryptionAvailable()) {
        return { ok: false, error: 'OS keychain encryption not available' };
      }
      const value = retrieveSecret(input.key as string);
      if (value === null) return { ok: false, error: `Secret "${input.key}" not found` };
      return { ok: true, value };
    }
    case 'system_secret_delete': {
      const deleted = deleteSecret(input.key as string);
      return { ok: deleted };
    }
    case 'system_secret_list': {
      return { ok: true, keys: listSecretKeys() };
    }

    // ── net.fetch (cookie-aware) ──
    case 'system_fetch': {
      return performFetch(input);
    }

    // ── globalShortcut ──
    case 'system_global_shortcut_register': {
      const accelerator = input.accelerator as string;
      const actionName = input.actionName as string;

      if (registeredShortcuts.has(accelerator)) {
        return { ok: false, error: `Shortcut "${accelerator}" already registered as "${registeredShortcuts.get(accelerator)}"` };
      }

      const success = globalShortcut.register(accelerator, () => {
        for (const cb of shortcutCallbacks) cb(actionName, accelerator);
        // Also bring Clawdia to front
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) {
          const win = wins[0];
          if (win.isMinimized()) win.restore();
          win.focus();
        }
      });

      if (success) {
        registeredShortcuts.set(accelerator, actionName);
        return { ok: true, message: `Global shortcut "${accelerator}" registered for "${actionName}"` };
      }
      return { ok: false, error: `Failed to register shortcut "${accelerator}" — may be in use by another application` };
    }
    case 'system_global_shortcut_unregister': {
      const accelerator = input.accelerator as string;
      globalShortcut.unregister(accelerator);
      registeredShortcuts.delete(accelerator);
      return { ok: true };
    }
    case 'system_global_shortcut_list': {
      const shortcuts: Array<{ accelerator: string; actionName: string }> = [];
      for (const [accel, action] of registeredShortcuts) {
        shortcuts.push({ accelerator: accel, actionName: action });
      }
      return { ok: true, shortcuts };
    }

    // ── XDG RemoteDesktop portal ──
    case 'system_remote_desktop_init': {
      return remoteDesktop.initSession();
    }
    case 'system_remote_desktop_click': {
      await remoteDesktop.portalClick(input.x as number, input.y as number, input.button as number ?? 1);
      return { ok: true };
    }
    case 'system_remote_desktop_type': {
      await remoteDesktop.portalType(input.text as string);
      return { ok: true };
    }
    case 'system_remote_desktop_key': {
      await remoteDesktop.notifyKeysym(input.keysym as number, input.pressed as boolean);
      return { ok: true };
    }
    case 'system_remote_desktop_move': {
      await remoteDesktop.notifyPointerMotionAbsolute(input.x as number, input.y as number);
      return { ok: true };
    }
    case 'system_remote_desktop_close': {
      await remoteDesktop.closeSession();
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown system tool: ${name}` };
  }
}

async function performFetch(input: Record<string, unknown>): Promise<unknown> {
  const url = input.url as string;
  const method = (input.method as string) || 'GET';
  const headers = (input.headers as Record<string, string>) || {};
  const body = input.body as string | undefined;
  const maxSize = (input.maxResponseSize as number) || MAX_RESPONSE_SIZE;

  try {
    // Use the browser partition's session so cookies are shared
    const ses = session.fromPartition(PARTITION);
    const fetchOpts: RequestInit & { session?: Electron.Session } = {
      method,
      headers,
    };
    if (body && method !== 'GET' && method !== 'HEAD') {
      fetchOpts.body = body;
    }

    // net.fetch uses Chromium's network stack with the app's session
    const response = await net.fetch(url, {
      method,
      headers: headers as any,
      body: body && method !== 'GET' && method !== 'HEAD' ? body : undefined,
      bypassCustomProtocolHandlers: false,
    });

    const status = response.status;
    const statusText = response.statusText;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Read body with size limit
    const contentType = response.headers.get('content-type') || '';
    const isText = contentType.includes('text') || contentType.includes('json') || contentType.includes('xml') || contentType.includes('javascript');

    let responseBody: string;
    if (isText) {
      const text = await response.text();
      responseBody = text.length > maxSize ? text.slice(0, maxSize) + `\n[truncated at ${maxSize} bytes]` : text;
    } else {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > maxSize) {
        responseBody = `[Binary response: ${buffer.byteLength} bytes, content-type: ${contentType}]`;
      } else {
        responseBody = Buffer.from(buffer).toString('base64');
      }
    }

    return {
      ok: true,
      status,
      statusText,
      headers: responseHeaders,
      body: responseBody,
      isText,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

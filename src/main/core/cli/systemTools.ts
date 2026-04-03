// src/main/core/cli/systemTools.ts
// System-level tools: globalShortcut, net.fetch (cookie-aware), safeStorage, RemoteDesktop portal.
import type Anthropic from '@anthropic-ai/sdk';

export const SYSTEM_TOOLS: Anthropic.Tool[] = [
  // ── safeStorage (OS keychain) ─────────────────────────────────────────────────
  {
    name: 'system_secret_store',
    description:
      'Encrypt and store a secret using the OS keychain (GNOME Keyring / libsecret on Linux). ' +
      'Stored secrets persist across restarts and are encrypted at rest.',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Secret name (e.g. "github_token", "api_key_openai")' },
        value: { type: 'string', description: 'Secret value to encrypt and store' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'system_secret_retrieve',
    description: 'Retrieve and decrypt a secret from the OS keychain.',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Secret name to retrieve' },
      },
      required: ['key'],
    },
  },
  {
    name: 'system_secret_delete',
    description: 'Delete a secret from the OS keychain.',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Secret name to delete' },
      },
      required: ['key'],
    },
  },
  {
    name: 'system_secret_list',
    description: 'List all stored secret key names (not values).',
    input_schema: { type: 'object' as const, properties: {} },
  },

  // ── net.fetch (cookie-aware HTTP from main process) ───────────────────────────
  {
    name: 'system_fetch',
    description:
      'Make an HTTP request from the main process using Chromium\'s network stack. ' +
      'Unlike browser_evaluate_js fetch(), this shares the browser\'s cookie jar and proxy settings. ' +
      'Use to call authenticated APIs using cookies the user logged into via the browser.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        method: { type: 'string', description: 'HTTP method (default: GET)' },
        headers: {
          type: 'object',
          description: 'Request headers as key-value pairs',
          additionalProperties: { type: 'string' },
        },
        body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
        maxResponseSize: { type: 'number', description: 'Max response size in bytes (default: 1048576 = 1MB)' },
      },
      required: ['url'],
    },
  },

  // ── globalShortcut ────────────────────────────────────────────────────────────
  {
    name: 'system_global_shortcut_register',
    description:
      'Register an OS-wide keyboard shortcut that works even when Clawdia is not focused. ' +
      'The shortcut triggers a named action that will be reported in tool activity. ' +
      'Examples: "CommandOrControl+Shift+Space", "Alt+F1".',
    input_schema: {
      type: 'object' as const,
      properties: {
        accelerator: { type: 'string', description: 'Electron accelerator string (e.g. "CommandOrControl+Shift+Space", "Alt+F1")' },
        actionName: { type: 'string', description: 'Name for this shortcut action (e.g. "invoke_assistant", "screenshot")' },
      },
      required: ['accelerator', 'actionName'],
    },
  },
  {
    name: 'system_global_shortcut_unregister',
    description: 'Unregister a previously registered OS-wide keyboard shortcut.',
    input_schema: {
      type: 'object' as const,
      properties: {
        accelerator: { type: 'string', description: 'Accelerator string to unregister' },
      },
      required: ['accelerator'],
    },
  },
  {
    name: 'system_global_shortcut_list',
    description: 'List all registered global shortcuts.',
    input_schema: { type: 'object' as const, properties: {} },
  },

  // ── XDG RemoteDesktop portal ──────────────────────────────────────────────────
  {
    name: 'system_remote_desktop_init',
    description:
      'Initialize an XDG RemoteDesktop portal session for GNOME Wayland input injection. ' +
      'This is the correct, compositor-agnostic way to inject keyboard and mouse input on GNOME Wayland ' +
      '(which blocks xdotool/ydotool). Triggers a user consent dialog on first use.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'system_remote_desktop_click',
    description: 'Click at absolute screen coordinates via the XDG RemoteDesktop portal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        button: { type: 'number', description: 'Button: 1=left, 2=middle, 3=right (default: 1)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'system_remote_desktop_type',
    description: 'Type text via the XDG RemoteDesktop portal (character by character via keysyms).',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['text'],
    },
  },
  {
    name: 'system_remote_desktop_key',
    description: 'Press/release a keyboard key via the XDG RemoteDesktop portal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keysym: { type: 'number', description: 'X11 keysym value (e.g. 0xff0d for Return, 0xff1b for Escape)' },
        pressed: { type: 'boolean', description: 'true=press, false=release' },
      },
      required: ['keysym', 'pressed'],
    },
  },
  {
    name: 'system_remote_desktop_move',
    description: 'Move the pointer to absolute coordinates via the XDG RemoteDesktop portal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'system_remote_desktop_close',
    description: 'Close the XDG RemoteDesktop portal session.',
    input_schema: { type: 'object' as const, properties: {} },
  },
];

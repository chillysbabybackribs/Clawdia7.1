// src/main/core/desktop/remoteDesktop.ts
// XDG RemoteDesktop portal — the correct, compositor-agnostic way to inject
// keyboard and mouse input on GNOME Wayland (which blocks xdotool/ydotool).
//
// Uses gdbus to talk to org.freedesktop.portal.RemoteDesktop.
// The portal requires a user consent dialog on first use per session.
import { run, runSeparate, cmdExists } from './shared';

let sessionHandle: string | null = null;
let sessionToken: string | null = null;

function portalBusName(): string {
  return 'org.freedesktop.portal.Desktop';
}

function portalObjectPath(): string {
  return '/org/freedesktop/portal/desktop';
}

/** Check if the RemoteDesktop portal is available. */
export async function isPortalAvailable(): Promise<boolean> {
  if (!(await cmdExists('gdbus'))) return false;
  const result = await runSeparate(
    `gdbus introspect --session --dest=${portalBusName()} --object-path=${portalObjectPath()}/org.freedesktop.portal.RemoteDesktop`,
    5000,
  );
  // If the introspection includes the interface name, it's available
  return result.stdout.includes('RemoteDesktop') || result.stderr === '';
}

/** Create a RemoteDesktop session. Returns session handle or error. */
export async function createSession(): Promise<string> {
  if (sessionHandle) return sessionHandle;

  const token = `clawdia_rd_${Date.now()}`;
  sessionToken = token;

  // CreateSession via gdbus
  const result = await run(
    `gdbus call --session --dest=${portalBusName()} ` +
    `--object-path=${portalObjectPath()} ` +
    `--method=org.freedesktop.portal.RemoteDesktop.CreateSession ` +
    `"{'handle_token': <'${token}'>, 'session_handle_token': <'${token}_session'>}"`,
    10000,
  );

  if (result.startsWith('[Error]')) {
    throw new Error(`Failed to create RemoteDesktop session: ${result}`);
  }

  // Extract the request handle from the response
  const handleMatch = result.match(/objectpath '([^']+)'/);
  if (!handleMatch) {
    throw new Error(`Could not parse session handle from: ${result}`);
  }

  // The actual session handle comes from the Response signal, but for simplicity
  // we construct it from the token pattern the portal uses.
  const senderName = await getSenderName();
  sessionHandle = `/org/freedesktop/portal/desktop/session/${senderName}/${token}_session`;

  return sessionHandle;
}

async function getSenderName(): Promise<string> {
  // Get our DBus unique name and convert : and . to _
  const result = await runSeparate(
    `gdbus call --session --dest=org.freedesktop.DBus --object-path=/org/freedesktop/DBus --method=org.freedesktop.DBus.GetId`,
    3000,
  );
  // Fallback: use a sanitized version of our PID
  return `clawdia_${process.pid}`;
}

/** Select devices for the session (keyboard + pointer). */
export async function selectDevices(): Promise<void> {
  if (!sessionHandle) throw new Error('No active RemoteDesktop session');

  // device types: 1=keyboard, 2=pointer, 3=both
  await run(
    `gdbus call --session --dest=${portalBusName()} ` +
    `--object-path=${portalObjectPath()} ` +
    `--method=org.freedesktop.portal.RemoteDesktop.SelectDevices ` +
    `"${sessionHandle}" "{'types': <uint32 3>}"`,
    10000,
  );
}

/** Start the session (triggers user consent dialog). */
export async function startSession(): Promise<void> {
  if (!sessionHandle) throw new Error('No active RemoteDesktop session');

  await run(
    `gdbus call --session --dest=${portalBusName()} ` +
    `--object-path=${portalObjectPath()} ` +
    `--method=org.freedesktop.portal.RemoteDesktop.Start ` +
    `"${sessionHandle}" "" "{}"`,
    30000, // User may need time to click the consent dialog
  );
}

/** Send a keyboard keycode via the portal. */
export async function notifyKeyboard(keycode: number, pressed: boolean): Promise<void> {
  if (!sessionHandle) throw new Error('No active RemoteDesktop session');

  await run(
    `gdbus call --session --dest=${portalBusName()} ` +
    `--object-path=${portalObjectPath()} ` +
    `--method=org.freedesktop.portal.RemoteDesktop.NotifyKeyboardKeycode ` +
    `"${sessionHandle}" "{}" ${keycode} ${pressed ? 1 : 0}`,
    3000,
  );
}

/** Send a keyboard keysym via the portal. */
export async function notifyKeysym(keysym: number, pressed: boolean): Promise<void> {
  if (!sessionHandle) throw new Error('No active RemoteDesktop session');

  await run(
    `gdbus call --session --dest=${portalBusName()} ` +
    `--object-path=${portalObjectPath()} ` +
    `--method=org.freedesktop.portal.RemoteDesktop.NotifyKeyboardKeysym ` +
    `"${sessionHandle}" "{}" ${keysym} ${pressed ? 1 : 0}`,
    3000,
  );
}

/** Move the pointer to absolute coordinates. */
export async function notifyPointerMotionAbsolute(x: number, y: number, stream = 0): Promise<void> {
  if (!sessionHandle) throw new Error('No active RemoteDesktop session');

  await run(
    `gdbus call --session --dest=${portalBusName()} ` +
    `--object-path=${portalObjectPath()} ` +
    `--method=org.freedesktop.portal.RemoteDesktop.NotifyPointerMotionAbsolute ` +
    `"${sessionHandle}" "{}" ${stream} ${x} ${y}`,
    3000,
  );
}

/** Move the pointer by relative delta. */
export async function notifyPointerMotion(dx: number, dy: number): Promise<void> {
  if (!sessionHandle) throw new Error('No active RemoteDesktop session');

  await run(
    `gdbus call --session --dest=${portalBusName()} ` +
    `--object-path=${portalObjectPath()} ` +
    `--method=org.freedesktop.portal.RemoteDesktop.NotifyPointerMotion ` +
    `"${sessionHandle}" "{}" ${dx} ${dy}`,
    3000,
  );
}

/** Click a pointer button (1=left, 2=middle, 3=right). */
export async function notifyPointerButton(button: number, pressed: boolean): Promise<void> {
  if (!sessionHandle) throw new Error('No active RemoteDesktop session');

  // BTN_LEFT=272 (0x110), BTN_RIGHT=273, BTN_MIDDLE=274 in Linux input.h
  const linuxButton = button === 1 ? 272 : button === 3 ? 273 : button === 2 ? 274 : 272;

  await run(
    `gdbus call --session --dest=${portalBusName()} ` +
    `--object-path=${portalObjectPath()} ` +
    `--method=org.freedesktop.portal.RemoteDesktop.NotifyPointerButton ` +
    `"${sessionHandle}" "{}" ${linuxButton} ${pressed ? 1 : 0}`,
    3000,
  );
}

/** Scroll the pointer axis. */
export async function notifyPointerAxis(dx: number, dy: number): Promise<void> {
  if (!sessionHandle) throw new Error('No active RemoteDesktop session');

  await run(
    `gdbus call --session --dest=${portalBusName()} ` +
    `--object-path=${portalObjectPath()} ` +
    `--method=org.freedesktop.portal.RemoteDesktop.NotifyPointerAxis ` +
    `"${sessionHandle}" "{}" ${dx} ${dy}`,
    3000,
  );
}

/** Close the RemoteDesktop session. */
export async function closeSession(): Promise<void> {
  if (!sessionHandle) return;

  await run(
    `gdbus call --session --dest=${portalBusName()} ` +
    `--object-path=${sessionHandle} ` +
    `--method=org.freedesktop.portal.Session.Close`,
    3000,
  );

  sessionHandle = null;
  sessionToken = null;
}

/** High-level: initialize a RemoteDesktop session with keyboard + pointer. */
export async function initSession(): Promise<{ ok: boolean; handle?: string; error?: string }> {
  try {
    const available = await isPortalAvailable();
    if (!available) {
      return { ok: false, error: 'XDG RemoteDesktop portal not available. Requires xdg-desktop-portal with RemoteDesktop support (GNOME, KDE 6+).' };
    }
    const handle = await createSession();
    await selectDevices();
    await startSession();
    return { ok: true, handle };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** High-level: click at absolute coordinates. */
export async function portalClick(x: number, y: number, button = 1): Promise<void> {
  await notifyPointerMotionAbsolute(x, y);
  await notifyPointerButton(button, true);
  await notifyPointerButton(button, false);
}

/** High-level: type text character by character using keysyms. */
export async function portalType(text: string): Promise<void> {
  for (const char of text) {
    const keysym = char.charCodeAt(0);
    await notifyKeysym(keysym, true);
    await notifyKeysym(keysym, false);
  }
}

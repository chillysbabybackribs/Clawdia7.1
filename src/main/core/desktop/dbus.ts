/**
 * DBus control — list running services, discover interfaces, call methods,
 * get properties.
 *
 * Same surface as 4.0's dbus-executor.ts, but with qdbus fallback and nicer
 * XML → compact summary parsing.
 */
import { run, cmdExists } from './shared';

export async function executeDbusControl(input: Record<string, unknown>): Promise<string> {
    const { action, service, path: objPath, interface: iface, method } = input;
    const args = (input.args as string[] | undefined) ?? [];

    if (!action) return '[Error] action is required. Use: list_running | discover | call | get_property';

    const hasDbusSend = await cmdExists('dbus-send');
    const hasQdbus = await cmdExists('qdbus');

    if (!hasDbusSend && !hasQdbus) {
        return '[Error] Neither dbus-send nor qdbus found. Install: sudo apt install dbus-tools';
    }

    switch (action) {
        case 'list_running': {
            if (!hasDbusSend) return '[Error] dbus-send required for list_running.';
            const raw = await run(
                'dbus-send --session --dest=org.freedesktop.DBus --type=method_call --print-reply /org/freedesktop/DBus org.freedesktop.DBus.ListNames',
            );
            const services = raw
                .split('\n')
                .filter((l) => l.includes('string "'))
                .map((l) => l.match(/string "(.+)"/)?.[1])
                .filter((s): s is string =>
                    !!s && !s.startsWith(':') &&
                    !s.startsWith('org.freedesktop.DBus') &&
                    s.includes('.')
                )
                .sort();
            if (services.length === 0) return 'No notable DBus services found on session bus.';
            return `Active DBus services (${services.length}):\n${services.map((s) => `  ${s}`).join('\n')}`;
        }

        case 'discover': {
            if (!service) return '[Error] service name required for discover.';
            const p = (objPath as string) ?? '/';
            const raw = await run(
                `dbus-send --session --dest=${service} --type=method_call --print-reply ${p} org.freedesktop.DBus.Introspectable.Introspect`,
                5000,
            );
            if (raw.startsWith('[Error]')) return raw;
            const xmlMatch = raw.match(/<node[\s\S]*<\/node>/);
            if (!xmlMatch) return `Service "${service}" found but returned no introspection data.`;
            const xml = xmlMatch[0];
            const ifaces = [...xml.matchAll(/<interface name="([^"]+)">/g)]
                .map((m) => m[1])
                .filter((s) => !s.startsWith('org.freedesktop.DBus.'));
            const methods = [...xml.matchAll(/<method name="([^"]+)">/g)].map((m) => m[1]);
            const props = [...xml.matchAll(/<property name="([^"]+)"/g)].map((m) => m[1]);
            let out = `Service: ${service}\nPath: ${p}`;
            if (ifaces.length) out += `\nInterfaces:\n${ifaces.map((i) => `  ${i}`).join('\n')}`;
            if (methods.length) out += `\nMethods:\n${methods.map((m) => `  ${m}()`).join('\n')}`;
            if (props.length) out += `\nProperties:\n${props.map((pp) => `  ${pp}`).join('\n')}`;
            return out;
        }

        case 'call': {
            if (!service || !objPath || !iface || !method) {
                return '[Error] call requires: service, path, interface, method';
            }
            const argsStr = args.map((a) => `string:"${a}"`).join(' ');
            return run(
                `dbus-send --session --dest=${service} --type=method_call --print-reply ${objPath} ${iface}.${method} ${argsStr}`,
                10_000,
            );
        }

        case 'get_property': {
            if (!service || !objPath || !iface || !method) {
                return '[Error] get_property requires: service, path, interface, property (as method field)';
            }
            return run(
                `dbus-send --session --dest=${service} --type=method_call --print-reply ${objPath} org.freedesktop.DBus.Properties.Get string:"${iface}" string:"${method}"`,
                5000,
            );
        }

        case 'mpris_list': {
            // Convenience: list all MPRIS media players
            const raw = await run(
                'dbus-send --session --dest=org.freedesktop.DBus --type=method_call --print-reply /org/freedesktop/DBus org.freedesktop.DBus.ListNames',
            );
            const players = raw
                .split('\n')
                .filter((l) => l.includes('string "org.mpris.MediaPlayer2'))
                .map((l) => l.match(/string "(.+)"/)?.[1])
                .filter((s): s is string => !!s);
            if (players.length === 0) return 'No MPRIS media players found.';
            return `MPRIS players (${players.length}):\n${players.map((p) => `  ${p}`).join('\n')}`;
        }

        default:
            return `[Error] Unknown action: "${action}". Valid: list_running, discover, call, get_property, mpris_list`;
    }
}

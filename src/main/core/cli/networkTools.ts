/**
 * Network awareness tools — connectivity, interfaces, DNS, downloads, HTTP.
 *
 * Structured wrappers around common network operations that go beyond
 * raw shell_exec. These return parsed, structured JSON results.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);
const TIMEOUT = 30_000;
const ENV = { ...process.env, DISPLAY: process.env.DISPLAY || ':0' };

// ─── Executor ─────────────────────────────────────────────────────────────────

export async function executeNetworkTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case 'network_status': {
        const parts = await Promise.all([
          // Connection status
          execAsync('nmcli -t -f NAME,TYPE,DEVICE,STATE connection show --active 2>/dev/null || echo "nmcli_unavailable"', { timeout: 5000, env: ENV })
            .then(r => r.stdout.trim()).catch(() => 'unavailable'),
          // IP addresses
          execAsync("ip -4 addr show scope global | grep inet | awk '{print $2, $NF}'", { timeout: 5000, env: ENV })
            .then(r => r.stdout.trim()).catch(() => ''),
          // Default gateway
          execAsync("ip route | grep default | awk '{print $3}'", { timeout: 5000, env: ENV })
            .then(r => r.stdout.trim()).catch(() => ''),
          // DNS servers
          execAsync("cat /etc/resolv.conf 2>/dev/null | grep nameserver | awk '{print $2}'", { timeout: 3000, env: ENV })
            .then(r => r.stdout.trim()).catch(() => ''),
          // External IP (best effort)
          execAsync('curl -s --max-time 3 ifconfig.me 2>/dev/null || echo "unavailable"', { timeout: 5000, env: ENV })
            .then(r => r.stdout.trim()).catch(() => 'unavailable'),
          // WiFi info
          execAsync('nmcli -t -f SSID,SIGNAL,SECURITY dev wifi list --rescan no 2>/dev/null | head -5 || echo ""', { timeout: 5000, env: ENV })
            .then(r => r.stdout.trim()).catch(() => ''),
        ]);

        const [connections, ips, gateway, dns, externalIp, wifi] = parts;

        const activeConnections = connections === 'nmcli_unavailable' ? [] :
          connections.split('\n').filter(Boolean).map(line => {
            const [name, type, device, state] = line.split(':');
            return { name, type, device, state };
          });

        const interfaces = ips.split('\n').filter(Boolean).map(line => {
          const [cidr, iface] = line.trim().split(/\s+/);
          return { interface: iface, ip: cidr };
        });

        const wifiNetworks = wifi ? wifi.split('\n').filter(Boolean).map(line => {
          const [ssid, signal, security] = line.split(':');
          return { ssid, signal: parseInt(signal || '0'), security };
        }) : [];

        return JSON.stringify({
          ok: true,
          online: activeConnections.length > 0,
          connections: activeConnections,
          interfaces,
          gateway: gateway || null,
          dns: dns ? dns.split('\n').filter(Boolean) : [],
          externalIp: externalIp !== 'unavailable' ? externalIp : null,
          wifiNetworks: wifiNetworks.slice(0, 5),
        });
      }

      case 'network_ping': {
        const host = input.host as string;
        if (!host) return JSON.stringify({ ok: false, error: 'host is required.' });
        const count = Math.min((input.count as number) ?? 3, 10);

        try {
          const { stdout } = await execAsync(
            `ping -c ${count} -W 3 ${host} 2>&1`,
            { timeout: count * 4000 + 5000, env: ENV },
          );

          const statLine = stdout.match(/(\d+) packets transmitted, (\d+) received/);
          const rttLine = stdout.match(/rtt min\/avg\/max\/mdev = ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/);

          return JSON.stringify({
            ok: true,
            host,
            transmitted: statLine ? parseInt(statLine[1]) : count,
            received: statLine ? parseInt(statLine[2]) : 0,
            packetLoss: statLine ? `${Math.round((1 - parseInt(statLine[2]) / parseInt(statLine[1])) * 100)}%` : '100%',
            rttMs: rttLine ? {
              min: parseFloat(rttLine[1]),
              avg: parseFloat(rttLine[2]),
              max: parseFloat(rttLine[3]),
            } : null,
            reachable: statLine ? parseInt(statLine[2]) > 0 : false,
          });
        } catch (err: any) {
          return JSON.stringify({
            ok: true,
            host,
            reachable: false,
            error: 'Host unreachable or timeout.',
          });
        }
      }

      case 'network_dns_lookup': {
        const domain = input.domain as string;
        if (!domain) return JSON.stringify({ ok: false, error: 'domain is required.' });
        const recordType = (input.type as string) ?? 'A';

        try {
          const { stdout } = await execAsync(
            `dig +short ${recordType} ${domain} 2>/dev/null || nslookup ${domain} 2>/dev/null | grep Address | tail -n+2`,
            { timeout: 10_000, env: ENV },
          );
          const records = stdout.trim().split('\n').filter(Boolean);
          return JSON.stringify({
            ok: true,
            domain,
            type: recordType,
            records,
          });
        } catch {
          return JSON.stringify({ ok: false, error: `DNS lookup failed for ${domain}` });
        }
      }

      case 'network_download': {
        const url = input.url as string;
        if (!url) return JSON.stringify({ ok: false, error: 'url is required.' });
        const outputDir = (input.output_dir as string) || path.join(os.homedir(), 'Downloads');
        const filename = (input.filename as string) || '';

        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        const outFlag = filename
          ? `-o "${path.join(outputDir, filename)}"`
          : `--output-dir "${outputDir}" -OJ`;

        try {
          const { stdout, stderr } = await execAsync(
            `curl -L --max-time 120 --progress-bar ${outFlag} "${url}" 2>&1`,
            { timeout: 130_000, env: ENV, cwd: outputDir },
          );

          // Try to determine the saved filename
          const savedMatch = (stdout + stderr).match(/Saved to:\s*'?([^\s']+)/i)
            || (stdout + stderr).match(/(\S+)\s+100%/);
          let savedPath = filename ? path.join(outputDir, filename) : null;
          if (!savedPath && savedMatch) {
            savedPath = savedMatch[1];
          }

          // List the output directory to find the most recent file
          if (!savedPath || !fs.existsSync(savedPath)) {
            const files = fs.readdirSync(outputDir)
              .map(f => ({ name: f, mtime: fs.statSync(path.join(outputDir, f)).mtimeMs }))
              .sort((a, b) => b.mtime - a.mtime);
            if (files.length > 0 && Date.now() - files[0].mtime < 10_000) {
              savedPath = path.join(outputDir, files[0].name);
            }
          }

          if (savedPath && fs.existsSync(savedPath)) {
            const stat = fs.statSync(savedPath);
            return JSON.stringify({
              ok: true,
              path: savedPath,
              size: stat.size,
              sizeHuman: stat.size > 1_000_000 ? `${(stat.size / 1_000_000).toFixed(1)} MB` : `${(stat.size / 1_000).toFixed(1)} KB`,
            });
          }

          return JSON.stringify({
            ok: true,
            note: 'Download completed but could not determine output path.',
            output: (stdout + stderr).slice(0, 500),
          });
        } catch (err: any) {
          return JSON.stringify({ ok: false, error: `Download failed: ${err.message.slice(0, 300)}` });
        }
      }

      case 'network_http_request': {
        const url = input.url as string;
        if (!url) return JSON.stringify({ ok: false, error: 'url is required.' });
        const method = ((input.method as string) ?? 'GET').toUpperCase();
        const headers = (input.headers as Record<string, string>) ?? {};
        const body = input.body as string | undefined;
        const maxResponseChars = Math.min((input.max_response_chars as number) ?? 5000, 20_000);

        let headerArgs = Object.entries(headers).map(([k, v]) => `-H "${k}: ${v}"`).join(' ');
        let bodyArg = '';
        if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
          bodyArg = `-d '${body.replace(/'/g, "'\\''")}'`;
        }

        try {
          const { stdout } = await execAsync(
            `curl -s -w "\\n---HTTP_STATUS:%{http_code}---\\n---CONTENT_TYPE:%{content_type}---" -X ${method} ${headerArgs} ${bodyArg} "${url}" 2>/dev/null`,
            { timeout: TIMEOUT, env: ENV },
          );

          const statusMatch = stdout.match(/---HTTP_STATUS:(\d+)---/);
          const ctMatch = stdout.match(/---CONTENT_TYPE:([^-]*)---/);
          const responseBody = stdout.replace(/\n---HTTP_STATUS:\d+---\n---CONTENT_TYPE:[^-]*---$/, '');

          return JSON.stringify({
            ok: true,
            url,
            method,
            statusCode: statusMatch ? parseInt(statusMatch[1]) : null,
            contentType: ctMatch ? ctMatch[1].trim() : null,
            body: responseBody.slice(0, maxResponseChars),
            truncated: responseBody.length > maxResponseChars,
          });
        } catch (err: any) {
          return JSON.stringify({ ok: false, error: `HTTP request failed: ${err.message.slice(0, 300)}` });
        }
      }

      case 'network_listen_ports': {
        try {
          const { stdout } = await execAsync(
            'ss -tlnp 2>/dev/null | tail -n+2',
            { timeout: 5000, env: ENV },
          );

          const ports = stdout.trim().split('\n').filter(Boolean).map(line => {
            const parts = line.split(/\s+/);
            const localAddr = parts[3] ?? '';
            const pidMatch = line.match(/pid=(\d+)/);
            const procMatch = line.match(/users:\(\("([^"]+)"/);
            return {
              localAddress: localAddr,
              port: parseInt(localAddr.split(':').pop() ?? '0'),
              pid: pidMatch ? parseInt(pidMatch[1]) : null,
              process: procMatch ? procMatch[1] : null,
            };
          }).filter(p => p.port > 0);

          return JSON.stringify({ ok: true, count: ports.length, ports });
        } catch {
          return JSON.stringify({ ok: false, error: 'Could not list listening ports.' });
        }
      }

      default:
        return JSON.stringify({ ok: false, error: `Unknown network tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

// ─── Tool schemas ─────────────────────────────────────────────────────────────

export const NETWORK_TOOLS: Anthropic.Tool[] = [
  {
    name: 'network_status',
    description: 'Get full network status: active connections, interfaces, IPs, gateway, DNS, WiFi networks, external IP.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'network_ping',
    description: 'Ping a host to check reachability and measure latency.',
    input_schema: {
      type: 'object' as const,
      properties: {
        host: { type: 'string', description: 'Hostname or IP to ping.' },
        count: { type: 'number', description: 'Number of pings (default: 3, max: 10).' },
      },
      required: ['host'],
    },
  },
  {
    name: 'network_dns_lookup',
    description: 'Perform DNS lookup for a domain. Returns A, AAAA, MX, CNAME, etc. records.',
    input_schema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Domain name to look up.' },
        type: { type: 'string', description: 'Record type: A (default), AAAA, MX, CNAME, TXT, NS, SOA.' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'network_download',
    description: 'Download a file from a URL to a local directory. Returns the saved path and file size.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to download.' },
        output_dir: { type: 'string', description: 'Directory to save to (default: ~/Downloads).' },
        filename: { type: 'string', description: 'Output filename (auto-detected if omitted).' },
      },
      required: ['url'],
    },
  },
  {
    name: 'network_http_request',
    description: 'Make an HTTP request (GET, POST, PUT, DELETE, etc.) and return the response body and status code. Useful for API calls.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'Request URL.' },
        method: { type: 'string', description: 'HTTP method (default: GET).' },
        headers: { type: 'object', description: 'Request headers as key-value pairs.' },
        body: { type: 'string', description: 'Request body (for POST/PUT/PATCH).' },
        max_response_chars: { type: 'number', description: 'Max chars of response body to return (default: 5000).' },
      },
      required: ['url'],
    },
  },
  {
    name: 'network_listen_ports',
    description: 'List all TCP ports currently listening on this machine, with the process name and PID for each.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

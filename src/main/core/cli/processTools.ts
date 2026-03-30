/**
 * Process management tools — launch, monitor, signal, inspect OS processes.
 *
 * Goes beyond shell_exec by providing structured process lifecycle management
 * with PID tracking, background execution, and resource monitoring.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const TIMEOUT = 15_000;
const ENV = { ...process.env, DISPLAY: process.env.DISPLAY || ':0' };

/** Validate that a filter string is safe (no shell metacharacters). */
function isSafeFilter(value: string): boolean {
  return /^[a-zA-Z0-9._/ -]*$/.test(value);
}

/** Validate that a PID is a positive integer. */
function isValidPid(pid: unknown): pid is number {
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0;
}

// Track background processes launched by the agent
const backgroundProcesses = new Map<number, {
  pid: number;
  command: string;
  startedAt: number;
  label?: string;
}>();

// ─── Executor ─────────────────────────────────────────────────────────────────

export async function executeProcessTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case 'process_list': {
        const filter = (input.filter as string) ?? '';
        const sortBy = (input.sort_by as string) ?? 'cpu';
        const limit = Math.min((input.limit as number) ?? 20, 50);

        if (filter && !isSafeFilter(filter)) {
          return JSON.stringify({ ok: false, error: 'Invalid filter — only alphanumeric, dots, hyphens, slashes, spaces allowed.' });
        }

        const sortFlag = sortBy === 'memory' ? '-%mem' : '-%cpu';
        let cmd: string;
        if (filter) {
          // Use execFile for the grep to avoid injection via filter
          cmd = `ps aux --sort=${sortFlag} | head -1; ps aux --sort=${sortFlag} | grep -i -F -- ${JSON.stringify(filter)} | grep -v grep | head -${limit}`;
        } else {
          cmd = `ps aux --sort=${sortFlag} | head -${limit + 1}`;
        }

        const { stdout } = await execAsync(cmd, { timeout: TIMEOUT, env: ENV });
        const lines = stdout.trim().split('\n');
        if (lines.length <= 1) {
          return JSON.stringify({ ok: true, processes: [], note: filter ? `No processes matching "${filter}"` : 'No processes found.' });
        }

        const header = lines[0];
        const processes = lines.slice(1).map(line => {
          const parts = line.split(/\s+/);
          return {
            user: parts[0],
            pid: parseInt(parts[1]),
            cpu: parseFloat(parts[2]),
            mem: parseFloat(parts[3]),
            vsz: parts[4],
            rss: parts[5],
            stat: parts[7],
            start: parts[8],
            time: parts[9],
            command: parts.slice(10).join(' '),
          };
        });

        return JSON.stringify({ ok: true, count: processes.length, processes });
      }

      case 'process_info': {
        const pid = input.pid as number;
        if (!isValidPid(pid)) return JSON.stringify({ ok: false, error: 'pid must be a positive integer.' });

        const cmds = {
          stat: `cat /proc/${pid}/status 2>/dev/null | head -20`,
          cmdline: `cat /proc/${pid}/cmdline 2>/dev/null | tr '\\0' ' '`,
          cwd: `readlink /proc/${pid}/cwd 2>/dev/null`,
          environ_count: `cat /proc/${pid}/environ 2>/dev/null | tr '\\0' '\\n' | wc -l`,
          fd_count: `ls /proc/${pid}/fd 2>/dev/null | wc -l`,
          children: `pgrep -P ${pid} 2>/dev/null | tr '\\n' ',' | sed 's/,$//'`,
          ports: `ss -tlnp 2>/dev/null | grep "pid=${pid}" | awk '{print $4}'`,
        };

        const results: Record<string, string> = {};
        await Promise.all(
          Object.entries(cmds).map(async ([key, cmd]) => {
            try {
              const { stdout } = await execAsync(cmd, { timeout: 5000, env: ENV });
              results[key] = stdout.trim();
            } catch {
              results[key] = '';
            }
          }),
        );

        // Parse /proc/PID/status for structured info
        const statusLines = results.stat.split('\n');
        const info: Record<string, string> = {};
        for (const line of statusLines) {
          const [key, ...rest] = line.split(':');
          if (key && rest.length) info[key.trim()] = rest.join(':').trim();
        }

        return JSON.stringify({
          ok: true,
          pid,
          name: info.Name ?? 'unknown',
          state: info.State ?? 'unknown',
          ppid: parseInt(info.PPid ?? '0'),
          threads: parseInt(info.Threads ?? '0'),
          vmRssKb: parseInt((info.VmRSS ?? '0').replace(/\D/g, '')),
          vmSizeKb: parseInt((info.VmSize ?? '0').replace(/\D/g, '')),
          cmdline: results.cmdline || 'unknown',
          cwd: results.cwd || 'unknown',
          fdCount: parseInt(results.fd_count || '0'),
          childPids: results.children ? results.children.split(',').filter(Boolean).map(Number) : [],
          listeningPorts: results.ports ? results.ports.split('\n').filter(Boolean) : [],
        });
      }

      case 'process_launch_bg': {
        const command = input.command as string;
        if (!command) return JSON.stringify({ ok: false, error: 'command is required.' });
        const label = (input.label as string) || command.split(/\s+/)[0];

        const child = spawn('bash', ['-c', command], {
          detached: true,
          stdio: 'ignore',
          env: ENV,
          cwd: (input.cwd as string) || os.homedir(),
        });
        child.unref();

        const pid = child.pid!;
        backgroundProcesses.set(pid, {
          pid,
          command,
          startedAt: Date.now(),
          label,
        });
        // Auto-clean entry when process exits to prevent unbounded Map growth
        child.on('exit', () => backgroundProcesses.delete(pid));

        return JSON.stringify({
          ok: true,
          pid,
          label,
          command,
          note: 'Process launched in background. Use process_info to check status.',
        });
      }

      case 'process_signal': {
        const pid = input.pid as number;
        const signal = (input.signal as string) ?? 'SIGTERM';
        if (!isValidPid(pid)) return JSON.stringify({ ok: false, error: 'pid must be a positive integer.' });

        const validSignals = ['SIGTERM', 'SIGINT', 'SIGKILL', 'SIGHUP', 'SIGUSR1', 'SIGUSR2', 'SIGSTOP', 'SIGCONT'];
        if (!validSignals.includes(signal)) {
          return JSON.stringify({ ok: false, error: `Invalid signal. Valid: ${validSignals.join(', ')}` });
        }

        try {
          await execFileAsync('kill', [`-${signal}`, String(pid)], { timeout: 5000, env: ENV });
          backgroundProcesses.delete(pid);
          return JSON.stringify({ ok: true, pid, signal, note: `Signal ${signal} sent to PID ${pid}.` });
        } catch (err: any) {
          return JSON.stringify({ ok: false, error: `Failed to signal PID ${pid}: ${err.message}` });
        }
      }

      case 'process_port_lookup': {
        const port = input.port as number;
        if (!port || !Number.isInteger(port) || port < 1 || port > 65535) {
          return JSON.stringify({ ok: false, error: 'port must be an integer between 1 and 65535.' });
        }

        try {
          const { stdout } = await execAsync(
            `ss -tlnp 2>/dev/null | grep ":${port} " || lsof -i :${port} -P -n 2>/dev/null | head -5`,
            { timeout: 5000, env: ENV },
          );
          if (!stdout.trim()) {
            return JSON.stringify({ ok: true, port, inUse: false, note: `No process listening on port ${port}.` });
          }

          // Try to extract PID
          const pidMatch = stdout.match(/pid=(\d+)/);
          const lsofPid = stdout.match(/\n\S+\s+(\d+)/);
          const foundPid = pidMatch?.[1] ?? lsofPid?.[1] ?? null;

          return JSON.stringify({
            ok: true,
            port,
            inUse: true,
            pid: foundPid ? parseInt(foundPid) : null,
            raw: stdout.trim().slice(0, 500),
          });
        } catch {
          return JSON.stringify({ ok: true, port, inUse: false, note: 'Could not determine port status.' });
        }
      }

      case 'process_tree': {
        const pid = (input.pid as number) ?? 1;
        try {
          const { stdout } = await execAsync(
            `pstree -p -a ${pid} 2>/dev/null | head -40`,
            { timeout: 5000, env: ENV },
          );
          return JSON.stringify({ ok: true, tree: stdout.trim() || 'No process tree available.' });
        } catch {
          return JSON.stringify({ ok: false, error: 'pstree not available. Install: sudo apt install psmisc' });
        }
      }

      case 'system_resources': {
        const [loadavg, meminfo, uptime, diskUsage] = await Promise.all([
          execAsync('cat /proc/loadavg', { timeout: 3000 }).then(r => r.stdout.trim()).catch(() => ''),
          execAsync("free -m | awk 'NR==2{printf \"%s/%s MB (%.1f%%)\", $3, $2, $3/$2*100}'", { timeout: 3000 }).then(r => r.stdout.trim()).catch(() => ''),
          execAsync('uptime -p 2>/dev/null || uptime', { timeout: 3000 }).then(r => r.stdout.trim()).catch(() => ''),
          execAsync("df -h / | awk 'NR==2{printf \"%s/%s (%s used)\", $3, $2, $5}'", { timeout: 3000 }).then(r => r.stdout.trim()).catch(() => ''),
        ]);

        const [load1, load5, load15] = (loadavg || '0 0 0').split(' ').map(Number);

        return JSON.stringify({
          ok: true,
          cpuCores: os.cpus().length,
          loadAverage: { '1m': load1, '5m': load5, '15m': load15 },
          memory: meminfo || 'unknown',
          disk: diskUsage || 'unknown',
          uptime: uptime || 'unknown',
          platform: `${os.type()} ${os.release()} ${os.arch()}`,
          hostname: os.hostname(),
        });
      }

      default:
        return JSON.stringify({ ok: false, error: `Unknown process tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

// ─── Tool schemas ─────────────────────────────────────────────────────────────

export const PROCESS_TOOLS: Anthropic.Tool[] = [
  {
    name: 'process_list',
    description: 'List running processes with CPU/memory usage. Filter by name. Sort by cpu or memory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filter: { type: 'string', description: 'Filter processes by name (case-insensitive grep).' },
        sort_by: { type: 'string', description: '"cpu" (default) or "memory".' },
        limit: { type: 'number', description: 'Max processes to return (default: 20, max: 50).' },
      },
    },
  },
  {
    name: 'process_info',
    description: 'Get detailed info about a specific process by PID: memory, threads, child PIDs, open file descriptors, listening ports, cwd, command line.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pid: { type: 'number', description: 'Process ID to inspect.' },
      },
      required: ['pid'],
    },
  },
  {
    name: 'process_launch_bg',
    description: 'Launch a command as a detached background process. Returns the PID. Use process_info to check on it later.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command to run in background.' },
        cwd: { type: 'string', description: 'Working directory (default: home).' },
        label: { type: 'string', description: 'Friendly label for this process.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'process_signal',
    description: 'Send a signal to a process. Use SIGTERM for graceful shutdown, SIGKILL to force kill.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pid: { type: 'number', description: 'Process ID to signal.' },
        signal: { type: 'string', description: 'Signal name: SIGTERM (default), SIGINT, SIGKILL, SIGHUP, SIGUSR1, SIGUSR2, SIGSTOP, SIGCONT.' },
      },
      required: ['pid'],
    },
  },
  {
    name: 'process_port_lookup',
    description: 'Check which process is listening on a given TCP port.',
    input_schema: {
      type: 'object' as const,
      properties: {
        port: { type: 'number', description: 'Port number to check.' },
      },
      required: ['port'],
    },
  },
  {
    name: 'process_tree',
    description: 'Show the process tree rooted at a PID (default: init/PID 1). Shows parent-child relationships.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pid: { type: 'number', description: 'Root PID for the tree (default: 1 = full system).' },
      },
    },
  },
  {
    name: 'system_resources',
    description: 'Get system resource overview: CPU cores, load average, memory usage, disk usage, uptime, platform info.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

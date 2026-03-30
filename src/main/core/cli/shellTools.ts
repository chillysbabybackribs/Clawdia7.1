import { exec } from 'child_process';
import * as fs from 'fs';
import { truncateToolResult, SHELL_MAX, FILE_MAX } from './truncate';

// Timeout passed to exec so the OS process is killed when it overruns.
// dispatch.ts also has a Promise.race timeout at 30 s; this inner limit matches
// it so the child is guaranteed terminated before the outer race fires.
const EXEC_TIMEOUT_MS = 30_000;

function execAsync(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: EXEC_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        // Attach stdout/stderr so the existing error handler in executeShellTool
        // can surface them — matches the shape promisify(exec) would produce.
        (err as any).stdout = stdout;
        (err as any).stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/** Execute a shell or file-edit tool call by name+args. Returns a result string. */
export async function executeShellTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === 'shell_exec' || name === 'bash') {
      const command = (args.command ?? args.cmd) as string;
      try {
        const { stdout, stderr } = await execAsync(command);
        return truncateToolResult(JSON.stringify({
          ok: true,
          exitCode: 0,
          command,
          stdout: (stdout ?? '').trim(),
          stderr: (stderr ?? '').trim(),
          hasOutput: Boolean((stdout ?? '').trim() || (stderr ?? '').trim()),
        }), SHELL_MAX);
      } catch (err: any) {
        const stdout = (err.stdout ?? '').toString().trim();
        const stderr = (err.stderr ?? '').toString().trim();
        const exitCode = typeof err.code === 'number' ? err.code : 'unknown';
        return truncateToolResult(JSON.stringify({
          ok: false,
          exitCode,
          command,
          stdout,
          stderr,
          hasOutput: Boolean(stdout || stderr),
        }), SHELL_MAX);
      }
    }
    if (name === 'file_list_directory') {
      const dirPath = args.path as string;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const result = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        size: e.isFile() ? fs.statSync(`${dirPath}/${e.name}`).size : undefined,
      }));
      return JSON.stringify(result);
    }
    if (name === 'file_search') {
      const pattern = args.pattern as string;
      const searchPath = (args.path as string) || '.';
      const glob = (args.glob as string) || '*';
      const { stdout } = await execAsync(
        `grep -rn --include=${JSON.stringify(glob)} -m 5 ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)} 2>/dev/null || true`
      );
      const lines = stdout.trim().split('\n').filter(Boolean).slice(0, 20);
      const matches = lines.map(line => {
        const m = line.match(/^(.+?):(\d+):(.*)$/);
        return m ? { file: m[1], line: parseInt(m[2]), text: m[3].trim() } : { raw: line };
      });
      return truncateToolResult(JSON.stringify(matches), SHELL_MAX);
    }
    if (name === 'file_edit' || name === 'str_replace_based_edit_tool') {
      const cmd = args.command as string;
      const filePath = args.path as string;
      if (cmd === 'view') {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return truncateToolResult(raw, FILE_MAX);
      }
      if (cmd === 'create') {
        fs.writeFileSync(filePath, (args.file_text as string) ?? '', 'utf-8');
        return `File created at ${filePath}`;
      }
      if (cmd === 'str_replace') {
        const text = fs.readFileSync(filePath, 'utf-8');
        const count = text.split(args.old_str as string).length - 1;
        if (count === 0) return 'Error: old_str not found in file.';
        if (count > 1) return 'Error: old_str found multiple times.';
        fs.writeFileSync(filePath, text.replace(args.old_str as string, args.new_str as string), 'utf-8');
        return 'File updated successfully.';
      }
      return `Executed ${cmd} on ${filePath} (unrecognised command).`;
    }
    return `Error: Unknown tool ${name}`;
  } catch (err: unknown) {
    return `Error executing tool: ${(err as Error).message}`;
  }
}

/** OpenAI-compatible tool definitions for shell + file access. */
export const SHELL_TOOLS_OPENAI = [
  {
    type: 'function' as const,
    function: {
      name: 'shell_exec',
      description: 'Execute a bash shell command on the local system.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'file_edit',
      description: 'Read and edit files on the local filesystem.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Action: view, create, or str_replace.' },
          path: { type: 'string', description: 'Absolute file path.' },
          file_text: { type: 'string', description: 'File content (required for create).' },
          old_str: { type: 'string', description: 'Text to replace (required for str_replace).' },
          new_str: { type: 'string', description: 'Replacement text (required for str_replace).' },
        },
        required: ['command', 'path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'file_list_directory',
      description: 'List the contents of a directory. Returns structured JSON with name, type, and size.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute directory path to list.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'file_search',
      description: 'Search for a pattern in files. Returns structured JSON matches with file path, line number, and matching text.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (regex).' },
          path:    { type: 'string', description: 'Directory to search in (default: current directory).' },
          glob:    { type: 'string', description: 'File glob pattern to filter (e.g. "*.ts", "*.py"). Default: all files.' },
        },
        required: ['pattern'],
      },
    },
  },
];

// src/main/claudeCodeClient.ts
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getClaudeMcpConfigPath } from './mcpBridge';
import { classify } from './agent/classify';
import { buildPromptComposition } from './skills/promptComposition';
import type { ToolCall } from '../shared/types';

const sessions = new Map<string, string>();

export interface RunClaudeCodeOptions {
  conversationId: string;
  prompt: string;
  attachments?: import('../shared/types').MessageAttachment[];
  onText: (delta: string) => void;
  onToolActivity?: (activity: ToolCall) => void;
  skipPermissions?: boolean;
  /** Seed the in-memory cache from a previously persisted session id (e.g. loaded from DB on startup). */
  persistedSessionId?: string | null;
  /** When aborted, the spawned claude process will be killed immediately. */
  signal?: AbortSignal;
}

export interface RunClaudeCodeResult {
  finalText: string;
  sessionId: string | null;
}

export function clearSessions(): void {
  sessions.clear();
}

export function buildClaudeCodePrompt(prompt: string): string {
  const profile = classify(prompt);
  const promptComposition = buildPromptComposition({
    message: prompt,
    toolGroup: profile.toolGroup,
    executor: 'agentLoop',
  });

  if (!promptComposition.promptBlock) return prompt;

  return `${promptComposition.promptBlock}

[User task]
${prompt}`;
}

// ── Tool-name → human-readable summary helpers ────────────────────────────────

function toolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
      return `Editing file: ${input.file_path ?? input.path ?? '?'}`;
    case 'Write':
      return `Writing file: ${input.file_path ?? input.path ?? '?'}`;
    case 'Read':
      return `Reading: ${input.file_path ?? input.path ?? '?'}`;
    case 'Bash': {
      const cmd = String(input.command ?? '').trim();
      return `Shell: ${cmd.length > 80 ? cmd.slice(0, 77) + '…' : cmd || '?'}`;
    }
    case 'Glob':
      return `Glob: ${input.pattern ?? '?'}`;
    case 'Grep':
      return `Grep: ${input.pattern ?? '?'}`;
    case 'WebSearch':
      return `Web search: ${input.query ?? '?'}`;
    case 'WebFetch':
      return `Fetch: ${input.url ?? '?'}`;
    case 'TodoWrite':
      return 'Updating task list';
    case 'Agent':
      return `Launching agent: ${input.description ?? '?'}`;
    case 'clawdia_browser_navigate':
      return `Browser navigate: ${input.url ?? '?'}`;
    case 'clawdia_browser_click':
      return `Browser click: ${input.selector ?? input.element ?? '?'}`;
    case 'clawdia_browser_type':
      return `Browser type in: ${input.selector ?? '?'}`;
    case 'clawdia_browser_screenshot':
      return 'Browser screenshot';
    case 'clawdia_browser_find_elements':
      return `Browser find: ${input.selector ?? '?'}`;
    case 'clawdia_browser_extract_text':
      return `Browser extract text: ${input.selector ?? 'page'}`;
    case 'clawdia_fs_read_file':
      return `Read file: ${input.path ?? '?'}`;
    case 'clawdia_fs_write_file':
      return `Write file: ${input.path ?? '?'}`;
    case 'clawdia_fs_list_dir':
      return `List dir: ${input.path ?? '?'}`;
    case 'shell_exec':
      return `Shell: ${String(input.command ?? '').slice(0, 80) || '?'}`;
    case 'clawdia_terminal_spawn':
      return `Terminal: ${String(input.command ?? '?').slice(0, 80)}`;
    case 'clawdia_terminal_write':
      return `Terminal input: ${String(input.input ?? '?').slice(0, 60)}`;
    default:
      return name;
  }
}

// ── Tool result parsing ───────────────────────────────────────────────────────

function parseToolResult(content: unknown): { text: string; isError: boolean } {
  if (typeof content === 'string') return { text: content, isError: false };
  if (Array.isArray(content)) {
    const isError = content.some(
      (b: unknown) => typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'tool_result_error'
    );
    const text = content
      .filter((b: unknown) => typeof b === 'object' && b !== null)
      .map((b: unknown) => {
        const block = b as Record<string, unknown>;
        if (typeof block.text === 'string') return block.text;
        if (block.type === 'image') return '[image]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
    return { text, isError };
  }
  return { text: String(content ?? ''), isError: false };
}

export function runClaudeCode(options: RunClaudeCodeOptions): Promise<RunClaudeCodeResult> {
  const { conversationId, prompt, attachments, onText, onToolActivity, skipPermissions, persistedSessionId, signal } = options;
  const claudeBin = process.env.CLAUDE_BIN || 'claude';

  // Seed the in-memory cache from a durable persisted value when the process
  // has no live entry yet (e.g. first run after an app restart).
  if (persistedSessionId && !sessions.has(conversationId)) {
    sessions.set(conversationId, persistedSessionId);
  }

  const sessionId = sessions.get(conversationId);

  return getClaudeMcpConfigPath(conversationId).then((mcpConfigPath) => {
  // Write attachments to temp files and append their paths/content to the prompt
  const tmpFiles: string[] = [];
  let finalPrompt = buildClaudeCodePrompt(prompt);
  for (const a of (attachments ?? [])) {
    try {
      if (a.kind === 'image') {
        let filePath = a.path;
        if (!filePath && a.dataUrl) {
          const m = a.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (m) {
            const ext = m[1].replace('image/', '') || 'png';
            filePath = path.join(os.tmpdir(), `clawdia-attach-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`);
            fs.writeFileSync(filePath, Buffer.from(m[2], 'base64'));
            tmpFiles.push(filePath);
          }
        }
        if (filePath) {
          finalPrompt += `\n\n[Image attached: ${filePath}]`;
        }
      } else if (a.kind === 'file') {
        if (a.textContent) {
          // Write text content to a temp file so Claude can read it
          const ext = a.name?.split('.').pop() || 'txt';
          const filePath = path.join(os.tmpdir(), `clawdia-attach-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`);
          fs.writeFileSync(filePath, a.textContent, 'utf8');
          tmpFiles.push(filePath);
          finalPrompt += `\n\n[File attached: ${a.name ?? 'file'} → ${filePath}]`;
        } else if (a.path) {
          finalPrompt += `\n\n[File attached: ${a.name ?? a.path} → ${a.path}]`;
        }
      }
    } catch { /* skip unreadable attachments */ }
  }

  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--input-format', 'text',
    '--mcp-config', mcpConfigPath,
  ];

  if (skipPermissions || process.env.CLAUDE_SKIP_PERMISSIONS === '1') {
    args.splice(1, 0, '--dangerously-skip-permissions');
  }

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Kill the subprocess immediately when the abort signal fires.
    if (signal) {
      if (signal.aborted) {
        child.kill('SIGTERM');
      } else {
        signal.addEventListener('abort', () => {
          child.kill('SIGTERM');
        }, { once: true });
      }
    }

    if (finalPrompt) {
      child.stdin.write(finalPrompt);
    }
    child.stdin.end();

    let buffer = '';
    let finalText = '';
    let resolvedSessionId: string | null = null;
    let stderr = '';

    // Track in-flight tool calls: id → { name, startMs, input }
    const pendingTools = new Map<string, { name: string; startMs: number; input: Record<string, unknown> }>();

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (typeof msg.session_id === 'string') {
          resolvedSessionId = msg.session_id;
        }

        // ── assistant message: extract text + tool_use blocks ──────────────
        if (msg.type === 'assistant') {
          const message = msg.message;
          if (message && typeof message === 'object' && !Array.isArray(message)) {
            const msgRecord = message as Record<string, unknown>;
            const content = msgRecord.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                const b = block as Record<string, unknown>;

                // Stream text content
                if (b?.type === 'text' && typeof b.text === 'string') {
                  finalText += b.text;
                  onText(b.text);
                }

                // Detect tool_use — emit 'running' activity
                if (b?.type === 'tool_use' && onToolActivity) {
                  const toolId = typeof b.id === 'string' ? b.id : `cc-tool-${Date.now()}`;
                  const toolName = typeof b.name === 'string' ? b.name : 'unknown';
                  const input = (b.input && typeof b.input === 'object' && !Array.isArray(b.input))
                    ? (b.input as Record<string, unknown>)
                    : {};
                  const summary = toolSummary(toolName, input);

                  // Only emit 'running' once per tool id
                  if (!pendingTools.has(toolId)) {
                    pendingTools.set(toolId, { name: toolName, startMs: Date.now(), input });
                    onToolActivity({
                      id: toolId,
                      name: toolName,
                      status: 'running',
                      detail: summary,
                      input: JSON.stringify(input, null, 2),
                    });
                  }
                }
              }
            }
          }
        }

        // ── user message: contains tool_result blocks ──────────────────────
        if (msg.type === 'user' && onToolActivity) {
          const message = msg.message;
          if (message && typeof message === 'object' && !Array.isArray(message)) {
            const msgRecord = message as Record<string, unknown>;
            const content = msgRecord.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                const b = block as Record<string, unknown>;
                if (b?.type === 'tool_result') {
                  const toolId = typeof b.tool_use_id === 'string' ? b.tool_use_id : '';
                  if (!toolId || !pendingTools.has(toolId)) continue;

                  const pending = pendingTools.get(toolId)!;
                  pendingTools.delete(toolId);

                  const durationMs = Date.now() - pending.startMs;
                  const isError = b.is_error === true;
                  const { text: outputText } = parseToolResult(b.content);

                  onToolActivity({
                    id: toolId,
                    name: pending.name,
                    status: isError ? 'error' : 'success',
                    detail: outputText.slice(0, 200),
                    output: outputText,
                    durationMs,
                  });
                }
              }
            }
          }
        }

        if (msg.type === 'result') {
          const sid = msg.session_id;
          if (typeof sid === 'string') resolvedSessionId = sid;
          const resultText = msg.result;
          if (typeof resultText === 'string' && resultText.trim()) {
            finalText = resultText;
          }
        }
      }
    });

    child.on('error', (err: Error) => {
      for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });

    child.on('close', (code) => {
      for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim()) as Record<string, unknown>;
          if (typeof msg.session_id === 'string') resolvedSessionId = msg.session_id;
        } catch {
          // Ignore trailing partial JSON.
        }
      }

      // Fail any tools that never received a result (e.g. process crash)
      if (onToolActivity) {
        for (const [toolId, pending] of pendingTools) {
          onToolActivity({
            id: toolId,
            name: pending.name,
            status: 'error',
            detail: 'No result received',
            durationMs: Date.now() - pending.startMs,
          });
        }
        pendingTools.clear();
      }

      if (code !== 0) {
        // If we had a resume session id and the CLI failed, the stored session
        // may be stale/invalid.  Evict it from the in-memory cache so the next
        // run starts a fresh session instead of looping on the same bad id.
        // The caller (ChatIpc) is responsible for clearing the persisted DB value.
        if (sessionId) {
          sessions.delete(conversationId);
        }
        reject(new Error(
          `claude exited with code ${code ?? 'null'}. stderr: ${stderr.slice(0, 500)}`,
        ));
        return;
      }

      if (resolvedSessionId) {
        sessions.set(conversationId, resolvedSessionId);
      }

      resolve({ finalText: finalText.trim(), sessionId: resolvedSessionId });
    });
  });
  });
}

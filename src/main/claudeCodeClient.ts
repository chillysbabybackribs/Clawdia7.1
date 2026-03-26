// src/main/claudeCodeClient.ts
import { spawn } from 'child_process';

const sessions = new Map<string, string>();

export interface RunClaudeCodeOptions {
  conversationId: string;
  prompt: string;
  onText: (delta: string) => void;
}

export interface RunClaudeCodeResult {
  finalText: string;
  sessionId: string | null;
}

export function clearSessions(): void {
  sessions.clear();
}

export function runClaudeCode(options: RunClaudeCodeOptions): Promise<RunClaudeCodeResult> {
  const { conversationId, prompt, onText } = options;
  const claudeBin = process.env.CLAUDE_BIN || 'claude';
  const sessionId = sessions.get(conversationId);

  const args = [
    '--print',
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--include-partial-messages',
  ];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  args.push(prompt);

  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    let finalText = '';
    let resolvedSessionId: string | null = null;
    let stderr = '';

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

        if (msg.type === 'assistant') {
          const content = (msg as any).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block?.type === 'text' && typeof block.text === 'string') {
                finalText += block.text;
                onText(block.text);
              }
            }
          }
        }

        if (msg.type === 'result') {
          if (typeof (msg as any).session_id === 'string') {
            resolvedSessionId = (msg as any).session_id;
          }
          if (!finalText.trim() && typeof (msg as any).result === 'string') {
            finalText = (msg as any).result;
            onText(finalText);
          }
        }
      }
    });

    child.on('error', (err: Error) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });

    child.on('close', (code) => {
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim()) as Record<string, unknown>;
          if (typeof msg.session_id === 'string') resolvedSessionId = msg.session_id;
        } catch { /* ignore */ }
      }

      if (!finalText.trim() && code !== 0) {
        reject(new Error(
          `claude exited with code ${code ?? 'null'} and no output. stderr: ${stderr.slice(0, 300)}`,
        ));
        return;
      }

      if (resolvedSessionId) {
        sessions.set(conversationId, resolvedSessionId);
      }

      resolve({ finalText: finalText.trim(), sessionId: resolvedSessionId });
    });
  });
}

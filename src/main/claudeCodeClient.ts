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
    '--input-format', 'text',
  ];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin.write(prompt);
    child.stdin.end();

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
          const message = msg.message;
          if (message && typeof message === 'object' && !Array.isArray(message)) {
            const msgRecord = message as Record<string, unknown>;
            const content = msgRecord.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                const b = block as Record<string, unknown>;
                if (b?.type === 'text' && typeof b.text === 'string') {
                  finalText += b.text;
                  onText(b.text);
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
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });

    child.on('close', (code) => {
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim()) as Record<string, unknown>;
          if (typeof msg.session_id === 'string') resolvedSessionId = msg.session_id;
        } catch { /* ignore */ }
      }

      if (code !== 0) {
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
}

import { spawn } from 'child_process';
import { getCodexMcpConfigArgs } from './mcpBridge';
import { getConversation, updateConversation } from './db';
import { loadSettings } from './settingsStore';

const sessions = new Map<string, string>();

export interface RunCodexCliOptions {
  conversationId: string;
  prompt: string;
  onText: (delta: string) => void;
  onEvent?: (event: { type: string; threadId?: string | null }) => void;
}

export interface RunCodexCliResult {
  finalText: string;
  sessionId: string | null;
}

export function clearCodexSessions(): void {
  sessions.clear();
}

export function runCodexCli(options: RunCodexCliOptions): Promise<RunCodexCliResult> {
  const { conversationId, prompt, onText, onEvent } = options;
  const codexBin = process.env.CODEX_BIN || 'codex';
  const inMemorySessionId = sessions.get(conversationId);
  const persistedSessionId = getConversation(conversationId)?.codex_chat_thread_id ?? null;
  const sessionId = inMemorySessionId ?? persistedSessionId ?? null;
  if (sessionId) sessions.set(conversationId, sessionId);
  return getCodexMcpConfigArgs(conversationId).then((mcpConfigArgs) => new Promise((resolve, reject) => {
    const args = sessionId
      ? [...mcpConfigArgs, 'exec', '--dangerously-bypass-approvals-and-sandbox', '--json', 'resume', sessionId, '-']
      : [...mcpConfigArgs, 'exec', '--dangerously-bypass-approvals-and-sandbox', '--json', '-'];

    const settings = loadSettings();
    const openaiKey = settings.providerKeys?.openai?.trim() || '';
    const child = spawn(codexBin, args, {
      env: { ...process.env, ...(openaiKey ? { OPENAI_API_KEY: openaiKey } : {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin.write(prompt);
    child.stdin.end();

    let buffer = '';
    let finalText = '';
    let resolvedSessionId: string | null = sessionId ?? null;
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

        if (msg.type === 'thread.started' && typeof msg.thread_id === 'string') {
          resolvedSessionId = msg.thread_id;
          sessions.set(conversationId, resolvedSessionId);
          updateConversation(conversationId, { codex_chat_thread_id: resolvedSessionId });
          onEvent?.({ type: 'thread.started', threadId: resolvedSessionId });
          continue;
        }

        if (typeof msg.type === 'string') {
          onEvent?.({ type: msg.type, threadId: resolvedSessionId });
        }

        if (msg.type !== 'item.completed') continue;
        const item = msg.item;
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const itemRecord = item as Record<string, unknown>;
        if (itemRecord.type !== 'agent_message' || typeof itemRecord.text !== 'string') continue;

        const text = itemRecord.text.trim();
        if (!text) continue;

        finalText = finalText ? `${finalText}\n\n${text}` : text;
        onText(text);
      }
    });

    // Fail fast if codex hangs (e.g. chatgpt.com blocked, network timeout)
    const hangTimeout = setTimeout(() => {
      child.kill();
      reject(new Error('Codex timed out (no response in 60s). Check that chatgpt.com is reachable and your OpenAI API key is valid.'));
    }, 60_000);

    child.on('error', (err: Error) => {
      clearTimeout(hangTimeout);
      reject(new Error(`Failed to spawn codex: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(hangTimeout);
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim()) as Record<string, unknown>;
          if (msg.type === 'thread.started' && typeof msg.thread_id === 'string') {
            resolvedSessionId = msg.thread_id;
          }
        } catch {
          // Ignore trailing partial JSON.
        }
      }

      if (code !== 0) {
        reject(new Error(
          `codex exited with code ${code ?? 'null'}. stderr: ${stderr.slice(0, 500)}`,
        ));
        return;
      }

      if (resolvedSessionId) {
        sessions.set(conversationId, resolvedSessionId);
        updateConversation(conversationId, { codex_chat_thread_id: resolvedSessionId });
      }

      resolve({ finalText, sessionId: resolvedSessionId });
    });
  }));
}

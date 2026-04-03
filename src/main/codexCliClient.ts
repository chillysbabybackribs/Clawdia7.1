import { spawn } from 'child_process';
import { getCodexMcpConfigArgs } from './mcpBridge';
import { getConversation, updateConversation } from './db';
import { loadSettings } from './settingsStore';
import { classify } from './agent/classify';
import { buildPromptComposition } from './skills/promptComposition';
import type { ToolCall } from '../shared/types';

const sessions = new Map<string, string>();

export interface RunCodexCliOptions {
  conversationId: string;
  prompt: string;
  onText: (delta: string) => void;
  onToolActivity?: (activity: ToolCall) => void;
  onEvent?: (event: { type: string; threadId?: string | null }) => void;
  signal?: AbortSignal;
}

export interface RunCodexCliResult {
  finalText: string;
  sessionId: string | null;
}

export function clearCodexSessions(): void {
  sessions.clear();
}

export function buildCodexPrompt(prompt: string): string {
  const profile = classify(prompt);
  const promptComposition = buildPromptComposition({
    message: prompt,
    toolGroup: profile.toolGroup,
    executor: 'codex',
    provider: 'openai',
    modelTier: profile.modelTier,
  });

  if (!promptComposition.promptBlock) return prompt;

  return `${promptComposition.promptBlock}

[User task]
${prompt}`;
}

function codexItemToolName(itemType: string): string {
  return `codex_${itemType}`;
}

function codexItemDetail(item: Record<string, unknown>): string {
  const candidates = [
    item.label,
    item.title,
    item.name,
    item.command,
    item.path,
    item.description,
    item.summary,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return String(item.type ?? 'activity');
}

/** Strip noisy/internal fields from a Codex item record to produce clean input args for display. */
function codexItemInput(item: Record<string, unknown>): Record<string, unknown> {
  const SKIP = new Set(['id', 'status', 'aggregated_output', 'exit_code', 'type']);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if (!SKIP.has(k)) out[k] = v;
  }
  return out;
}

function codexItemOutput(item: Record<string, unknown>): string {
  const candidates = [item.output, item.result, item.summary, item.text, item.error];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  try {
    return JSON.stringify(item, null, 2);
  } catch {
    return String(item.type ?? 'activity');
  }
}

function codexItemText(item: Record<string, unknown>): string | null {
  const candidates = [item.text, item.summary, item.markdown];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return null;
}

export function runCodexCli(options: RunCodexCliOptions): Promise<RunCodexCliResult> {
  const { conversationId, prompt, onText, onToolActivity, onEvent, signal } = options;
  const compiledPrompt = buildCodexPrompt(prompt);
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

    if (signal) {
      if (signal.aborted) {
        child.kill('SIGTERM');
      } else {
        signal.addEventListener('abort', () => {
          child.kill('SIGTERM');
        }, { once: true });
      }
    }

    child.stdin.write(compiledPrompt);
    child.stdin.end();

    let buffer = '';
    let finalText = '';
    let resolvedSessionId: string | null = sessionId ?? null;
    let stderr = '';
    const pendingActivities = new Map<string, { name: string; detail: string; input: string; startedAt: number }>();
    const streamedTextByItemId = new Map<string, string>();

    // Kill only if there has been zero stdout activity for 10 minutes.
    // This allows long-running tasks (large codebases, complex analysis) to
    // complete while still catching truly hung/network-dead processes.
    const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
    let hangTimeout = setTimeout(() => {
      child.kill();
      reject(new Error('Codex timed out (no output for 10 minutes). Check that the OpenAI API is reachable and your API key is valid.'));
    }, INACTIVITY_TIMEOUT_MS);

    function resetHangTimeout() {
      clearTimeout(hangTimeout);
      hangTimeout = setTimeout(() => {
        child.kill();
        reject(new Error('Codex timed out (no output for 10 minutes). Check that the OpenAI API is reachable and your API key is valid.'));
      }, INACTIVITY_TIMEOUT_MS);
    }

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.stdout.on('data', (chunk: Buffer) => {
      resetHangTimeout();
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

        const item = msg.item;
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const itemRecord = item as Record<string, unknown>;
        const itemId = typeof itemRecord.id === 'string' ? itemRecord.id : `codex-item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const itemType = typeof itemRecord.type === 'string' ? itemRecord.type : 'activity';
        const isTextualItem = itemType === 'agent_message' || itemType === 'reasoning';

        if ((msg.type === 'item.updated' || msg.type === 'item.completed') && isTextualItem) {
          const nextText = codexItemText(itemRecord);
          if (nextText) {
            const priorText = streamedTextByItemId.get(itemId) ?? '';
            const delta = nextText.startsWith(priorText) ? nextText.slice(priorText.length) : nextText;
            if (delta) onText(delta);
            streamedTextByItemId.set(itemId, nextText);
          }
        }

        if (msg.type === 'item.started' && !isTextualItem && onToolActivity) {
          const detail = codexItemDetail(itemRecord);
          const input = JSON.stringify(codexItemInput(itemRecord), null, 2);
          pendingActivities.set(itemId, {
            name: codexItemToolName(itemType),
            detail,
            input,
            startedAt: Date.now(),
          });
          onToolActivity({
            id: itemId,
            name: codexItemToolName(itemType),
            status: 'running',
            detail,
            input,
          });
          continue;
        }

        if (msg.type === 'item.completed') {
          if (itemType === 'agent_message' && typeof itemRecord.text === 'string') {
            const text = itemRecord.text.trim();
            if (!text) continue;
            finalText = finalText ? `${finalText}\n\n${text}` : text;
            // If this item was never streamed via item.updated, emit the full text now.
            const alreadyStreamed = streamedTextByItemId.get(itemId) ?? '';
            const remainder = text.startsWith(alreadyStreamed) ? text.slice(alreadyStreamed.length) : text;
            if (remainder) onText(remainder);
            streamedTextByItemId.set(itemId, text);
            continue;
          }

          if (itemType === 'reasoning') continue;

          if (onToolActivity) {
            const pending = pendingActivities.get(itemId);
            pendingActivities.delete(itemId);
            onToolActivity({
              id: itemId,
              name: pending?.name ?? codexItemToolName(itemType),
              status: 'success',
              detail: pending?.detail ?? codexItemDetail(itemRecord),
              input: pending?.input ?? JSON.stringify(codexItemInput(itemRecord), null, 2),
              output: codexItemOutput(itemRecord),
              durationMs: pending ? Date.now() - pending.startedAt : undefined,
            });
          }
          continue;
        }

        if (msg.type === 'item.failed' && onToolActivity) {
          const pending = pendingActivities.get(itemId);
          pendingActivities.delete(itemId);
          onToolActivity({
            id: itemId,
            name: pending?.name ?? codexItemToolName(itemType),
            status: 'error',
            detail: pending?.detail ?? codexItemDetail(itemRecord),
            input: pending?.input ?? JSON.stringify(codexItemInput(itemRecord), null, 2),
            output: codexItemOutput(itemRecord),
            durationMs: pending ? Date.now() - pending.startedAt : undefined,
          });
        }
      }
    });

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

/**
 * Workspace awareness tools — give the agent read-only visibility into
 * the Clawdia workspace: open conversation tabs, running agents, settings, model.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { getWorkspaceState } from './workspaceState';
import { loadSettings } from '../../settingsStore';
import { listConversations, getConversation, getMessages } from '../../db';

// ── Tool executor ─────────────────────────────────────────────────────────────

export async function executeWorkspaceTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {

      case 'workspace_status': {
        const state = getWorkspaceState();
        const settings = loadSettings();
        const allConvs = listConversations();
        const activeIds = state?.getActiveConversationIds() ?? [];
        const runningIds = activeIds.filter(id => state?.isConversationRunning(id));

        return JSON.stringify({
          ok: true,
          provider: settings.provider,
          model: settings.models[settings.provider] ?? 'unknown',
          unrestrictedMode: settings.unrestrictedMode,
          openConversations: activeIds.length,
          runningAgents: runningIds.length,
          runningConversationIds: runningIds,
          totalConversationsInHistory: allConvs.length,
        });
      }

      case 'workspace_list_conversations': {
        const limit = Math.min((input.limit as number) ?? 20, 50);
        const convs = listConversations().slice(0, limit);
        const state = getWorkspaceState();
        return JSON.stringify({
          ok: true,
          conversations: convs.map(c => ({
            id: c.id,
            title: c.title,
            mode: c.mode,
            updatedAt: c.updated_at,
            isOpen: state?.getActiveConversationIds().includes(c.id) ?? false,
            isRunning: state?.isConversationRunning(c.id) ?? false,
          })),
        });
      }

      case 'workspace_get_conversation': {
        const id = input.conversation_id as string;
        if (!id) return JSON.stringify({ ok: false, error: 'conversation_id required' });

        const conv = getConversation(id);
        if (!conv) return JSON.stringify({ ok: false, error: `Conversation ${id} not found` });

        const msgLimit = Math.min((input.message_limit as number) ?? 20, 100);
        const rows = getMessages(id);
        const messages = rows.slice(-msgLimit).map(r => {
          try {
            const parsed = JSON.parse(r.content);
            return {
              role: r.role,
              content: typeof parsed.content === 'string'
                ? parsed.content.slice(0, 500)
                : String(parsed.content ?? r.content).slice(0, 500),
              timestamp: parsed.timestamp ?? r.created_at,
            };
          } catch {
            return { role: r.role, content: r.content.slice(0, 500), timestamp: r.created_at };
          }
        });

        const state = getWorkspaceState();
        return JSON.stringify({
          ok: true,
          id: conv.id,
          title: conv.title,
          mode: conv.mode,
          updatedAt: conv.updated_at,
          isRunning: state?.isConversationRunning(id) ?? false,
          messageCount: rows.length,
          recentMessages: messages,
        });
      }

      case 'workspace_get_settings': {
        const settings = loadSettings();
        // Redact actual key values — only expose whether they're set
        const providerKeyStatus: Record<string, boolean> = {};
        for (const [provider, key] of Object.entries(settings.providerKeys)) {
          providerKeyStatus[provider] = Boolean(key);
        }
        return JSON.stringify({
          ok: true,
          provider: settings.provider,
          models: settings.models,
          providerKeysConfigured: providerKeyStatus,
          unrestrictedMode: settings.unrestrictedMode,
          policyProfile: settings.policyProfile,
          performanceStance: settings.performanceStance,
        });
      }

      case 'workspace_get_model': {
        const settings = loadSettings();
        const provider = (input.provider as string) ?? settings.provider;
        const model = settings.models[provider as keyof typeof settings.models] ?? 'unknown';
        return JSON.stringify({
          ok: true,
          activeProvider: settings.provider,
          activeModel: settings.models[settings.provider] ?? 'unknown',
          queriedProvider: provider,
          queriedModel: model,
        });
      }

      default:
        return JSON.stringify({ ok: false, error: `Unknown workspace tool: ${name}` });
    }
  } catch (err: unknown) {
    return JSON.stringify({ ok: false, error: (err as Error).message });
  }
}

// ── Tool definitions (Anthropic schema) ──────────────────────────────────────

export const WORKSPACE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'workspace_status',
    description: 'Get a snapshot of the current Clawdia workspace: active provider and model, how many conversation tabs are open, how many agents are currently running, and total conversation history count. This refers to Clawdia conversation tabs, not browser tabs. Call this to understand the current workspace state at a glance.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'workspace_list_conversations',
    description: 'List recent conversations from history, including their titles, modes (chat/claude_terminal/codex_terminal), last-updated timestamps, and whether they are currently open as conversation tabs or have a running agent. This is about chat/conversation tabs, not browser tabs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of conversations to return (default 20, max 50). Most recent first.',
        },
      },
    },
  },
  {
    name: 'workspace_get_conversation',
    description: 'Read the messages from a specific conversation by ID. Returns metadata and recent messages (truncated to 500 chars each). Use workspace_list_conversations first to find conversation IDs. This reads a Clawdia conversation, not a browser tab.',
    input_schema: {
      type: 'object' as const,
      properties: {
        conversation_id: {
          type: 'string',
          description: 'The ID of the conversation to read (e.g. "conv-1234567890").',
        },
        message_limit: {
          type: 'number',
          description: 'How many of the most recent messages to return (default 20, max 100).',
        },
      },
      required: ['conversation_id'],
    },
  },
  {
    name: 'workspace_get_settings',
    description: 'Read the current Clawdia settings: active provider, configured models per provider, which API keys are set (without exposing the actual key values), unrestricted mode status, policy profile, and performance stance.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'workspace_get_model',
    description: 'Get the currently active AI provider and model. Optionally query what model is configured for a specific provider.',
    input_schema: {
      type: 'object' as const,
      properties: {
        provider: {
          type: 'string',
          description: 'Optional: provider to query (anthropic, openai, gemini). Defaults to the active provider.',
        },
      },
    },
  },
];

export const WORKSPACE_TOOL_NAMES = new Set(WORKSPACE_TOOLS.map(t => t.name));

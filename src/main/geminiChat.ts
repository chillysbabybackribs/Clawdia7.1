import { GoogleGenAI, Type } from '@google/genai';
import type { WebContents } from 'electron';
import * as fs from 'fs';
import { IPC_EVENTS } from './ipc-channels';
import type { MessageAttachment } from '../shared/types';
import { executeShellTool } from './core/cli/shellTools';
import { executeBrowserTool } from './core/cli/browserTools';
import { getSearchToolGemini, executeSearchTools, toGeminiDeclaration, searchTools } from './core/cli/toolRegistry';
import type { BrowserService } from './core/browser/BrowserService';
import { truncateBrowserResult } from './core/cli/truncate';
import { buildSharedSystemPrompt } from './core/cli/systemPrompt';
import { executeGuiInteract, DESKTOP_TOOL_NAMES, renderCapabilities } from './core/desktop';
import { evaluatePolicy } from './agent/policy-engine';
import { startRun, trackToolCall, trackToolResult, completeRun, failRun } from './runTracker';
import type { ToolUseBlock, LLMTurn, LoopOptions } from './agent/types';

// ── Module-level constants (kept for reference) ───────────────────────────────
// GEMINI_TOOLS is no longer used directly in the loop — tools are loaded on demand
// via the search_tools meta-tool. Kept here for reference only.
const GEMINI_TOOLS = null; // eslint-disable-line @typescript-eslint/no-unused-vars

const MAX_TOOL_TURNS = 20;

// ── StreamParams type ────────────────────────────────────────────────────────

type StreamParams = {
    webContents: WebContents;
    apiKey: string;
    modelRegistryId: string;
    userText: string;
    attachments?: MessageAttachment[];
    sessionMessages: any[];
    signal: AbortSignal;
    browserService?: BrowserService;
    unrestrictedMode?: boolean;
    conversationId?: string;
};

// ── streamGeminiChat function ────────────────────────────────────────────────

export async function streamGeminiChat({
    webContents,
    apiKey,
    modelRegistryId,
    userText,
    attachments,
    sessionMessages,
    signal,
    browserService,
    unrestrictedMode = false,
    conversationId,
}: StreamParams): Promise<{ response: string; error?: string; toolCalls?: any[] }> {
    // Use the optimized Google GenAI SDK
    const ai = new GoogleGenAI({ apiKey });
    const runId = conversationId ? startRun(conversationId, 'gemini', modelRegistryId) : null;

    // Map attachments to Gemini inlineData
    const parts: any[] = [];
    if (userText) parts.push({ text: userText });
    if (attachments) {
        for (const a of attachments) {
            if (a.kind === 'image' && (a.dataUrl || a.path)) {
                let base64 = '';
                let mediaType = a.mimeType || 'image/png';
                if (a.dataUrl) {
                    const m = a.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
                    if (m) {
                        mediaType = m[1];
                        base64 = m[2];
                    }
                } else if (a.path) {
                    try {
                        base64 = fs.readFileSync(a.path).toString('base64');
                    } catch {
                        continue;
                    }
                }
                if (base64) {
                    parts.push({
                        inlineData: {
                            data: base64,
                            mimeType: mediaType,
                        },
                    });
                }
            } else if (a.textContent) {
                parts.push({ text: `[Attachment: ${a.name}]\n${a.textContent}` });
            }
        }
    }

    const userMessage = {
        role: 'user',
        parts,
    };

    const sendThinking = (t: string) => {
        if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_THINKING, t);
    };
    const sendText = (chunk: string) => {
        if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, chunk);
    };

    const sessionLengthBeforeRequest = sessionMessages.length;

    try {
        sessionMessages.push(userMessage);

        let allToolCalls: any[] = [];
        let finalResponseText = '';
        let turns = 0;

        // Build active tools list — start with search + pre-loaded shell tools
        let activeGeminiTools: any[] = [
            {
                functionDeclarations: [
                    getSearchToolGemini(),
                    // Pre-load shell tools since they're small and almost always needed
                    ...searchTools({ names: ['shell_exec', 'file_edit', 'file_list_directory', 'file_search'] }).map(toGeminiDeclaration),
                ]
            }
        ];

        while (turns < MAX_TOOL_TURNS) {
            turns++;
            if (signal.aborted) throw new Error('AbortError');

            sendThinking('Gemini is thinking…');

            const caps = await renderCapabilities();
            const systemPrompt = await buildSharedSystemPrompt(unrestrictedMode, caps);

            const chat = ai.chats.create({
                model: modelRegistryId,
                config: {
                    systemInstruction: systemPrompt,
                    tools: activeGeminiTools,
                    temperature: 0,
                },
                history: sessionMessages.slice(0, -1), // Everything except the last turn
            });

            // We stream the last message in the sessionMessages array
            const responseStream = await chat.sendMessageStream({
                message: sessionMessages[sessionMessages.length - 1].parts
            });

            let turnText = '';
            let functionCalls: any[] = [];

            for await (const chunk of responseStream) {
                if (signal.aborted) throw new Error('AbortError');
                if (chunk.text) {
                    turnText += chunk.text;
                }
                if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                    functionCalls.push(...chunk.functionCalls);
                }
            }

            // Record assistant's turn
            const assistantMessage: any = { role: 'model', parts: [] };
            if (turnText) assistantMessage.parts.push({ text: turnText });
            if (functionCalls.length > 0) {
                for (const fc of functionCalls) {
                    assistantMessage.parts.push({ functionCall: fc });
                }
            }

            if (assistantMessage.parts.length === 0) {
                assistantMessage.parts.push({ text: '' });
            }

            sessionMessages.push(assistantMessage);
            finalResponseText += turnText;

            if (functionCalls.length === 0) {
                // Final turn — stream as real text content
                if (turnText) sendText(turnText);
                break;
            }

            // Intermediate turn: route narration to shimmer/thinking instead of
            // content area so it shows as a single rotating status line.
            if (turnText) {
                const line = turnText.trim().split(/[\n\r]/)[0].replace(/^[-*>#]+\s*/, '').trim();
                if (line) sendThinking(line.length > 80 ? line.slice(0, 77) + '…' : line);
            }

            // Execute tool calls
            const toolResultParts: any[] = [];
            for (const fc of functionCalls) {
                const uiName = fc.name;
                const detail = fc.name === 'shell_exec' ? fc.args.command : JSON.stringify(fc.args);
                const tcId = `tc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
                const tcStartMs = Date.now();
                const argsSummary = JSON.stringify(fc.args).slice(0, 120);
                const eventId = (runId && fc.name !== 'search_tools') ? trackToolCall(runId, fc.name, argsSummary) : '';

                const tcObj = { id: tcId, name: uiName, status: 'running' as const, detail, input: JSON.stringify(fc.args, null, 2) };
                allToolCalls.push(tcObj);

                if (!webContents.isDestroyed()) {
                    webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, tcObj);
                }

                // Handle search_tools meta-tool
                if (fc.name === 'search_tools') {
                    const searchArgs: Record<string, unknown> = fc.args as Record<string, unknown>;
                    const searchResultStr = executeSearchTools(searchArgs);
                    const parsed = JSON.parse(searchResultStr);
                    // Add newly discovered tools to active declarations
                    if (parsed.schemas) {
                        const currentDecls = (activeGeminiTools[0] as any).functionDeclarations as any[];
                        for (const schema of parsed.schemas) {
                            if (!currentDecls.find((d: any) => d.name === schema.name)) {
                                currentDecls.push(toGeminiDeclaration(schema));
                            }
                        }
                    }
                    if (!webContents.isDestroyed()) {
                        webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
                            id: tcId,
                            name: 'search_tools',
                            status: 'success',
                            detail: `Loaded: ${parsed.tools_loaded?.join(', ') ?? 'catalog'}`,
                        });
                    }
                    toolResultParts.push({
                        functionResponse: {
                            name: 'search_tools',
                            response: { result: searchResultStr },
                        }
                    });
                    continue;
                }

                let resultStr: string;

                // ── Policy gate ───────────────────────────────────────────────
                const policyDecision = evaluatePolicy(
                    fc.name,
                    fc.args as Record<string, unknown>,
                );

                if (policyDecision.effect === 'deny') {
                    resultStr = `[POLICY DENIED] ${policyDecision.reason} (rule: ${policyDecision.ruleId ?? 'none'}, profile: ${policyDecision.profileName})`;
                    if (!webContents.isDestroyed()) {
                        webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
                            id: tcId,
                            name: uiName,
                            status: 'error',
                            detail: `Policy denied: ${policyDecision.reason}`,
                            policyDenied: true,
                        });
                    }
                    toolResultParts.push({
                        functionResponse: { name: fc.name, response: { result: resultStr, error: true } },
                    });
                    continue;
                }

                if (policyDecision.effect === 'require_approval') {
                    resultStr = `[POLICY HELD] This action requires your approval: ${policyDecision.reason}. ` +
                        `Tool "${fc.name}" was not executed. Change the policy profile in Settings to allow it.`;
                    if (!webContents.isDestroyed()) {
                        webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
                            id: tcId,
                            name: uiName,
                            status: 'error',
                            detail: `Requires approval: ${policyDecision.reason}`,
                            policyHeld: true,
                        });
                    }
                    toolResultParts.push({
                        functionResponse: { name: fc.name, response: { result: resultStr } },
                    });
                    continue;
                }
                // ── End policy gate ───────────────────────────────────────────────

                if (fc.name.startsWith('browser_') && browserService) {
                    const output = await executeBrowserTool(fc.name, fc.args as Record<string, unknown>, browserService);
                    resultStr = truncateBrowserResult(JSON.stringify(output));
                } else if (DESKTOP_TOOL_NAMES.has(fc.name)) {
                    resultStr = await executeGuiInteract(fc.args as Record<string, unknown>);
                } else {
                    resultStr = await executeShellTool(fc.name, fc.args as Record<string, unknown>);
                }

                if (runId && eventId) {
                    trackToolResult(runId, eventId, resultStr.slice(0, 200), Date.now() - tcStartMs);
                }

                toolResultParts.push({
                    functionResponse: {
                        name: fc.name,
                        response: { result: resultStr },
                    }
                });

                const successTcObj = { ...tcObj, status: 'success' as const, detail: resultStr.substring(0, 500), output: resultStr };
                if (!webContents.isDestroyed()) {
                    webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, successTcObj);
                }
            }

            // Reply with tool results
            sessionMessages.push({
                role: 'user',
                parts: toolResultParts,
            });
            // The while loop continues and will send these results to the model
        }

        if (turns >= MAX_TOOL_TURNS && finalResponseText === '') {
            finalResponseText = '[Tool loop reached maximum turn limit]';
            sendText(finalResponseText);
        }

        if (!webContents.isDestroyed()) {
            webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true });
        }

        if (runId) completeRun(runId, 0, 0);
        return { response: finalResponseText, toolCalls: allToolCalls };
    } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (err.name === 'AbortError') {
            if (runId) failRun(runId, 'Cancelled by user');
            if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, cancelled: true });
            return { response: '', error: 'Stopped' };
        }
        if (runId) failRun(runId, err.message);
        sessionMessages.splice(sessionLengthBeforeRequest);
        if (!webContents.isDestroyed()) {
            webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message });
        }
        return { response: '', error: err.message };
    }
}

export async function streamGeminiLLM(
  sessionMessages: any[],
  systemPrompt: string,
  tools: any[],
  options: LoopOptions,
): Promise<LLMTurn> {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  const chat = ai.chats.create({
    model: options.model,
    config: {
      systemInstruction: systemPrompt,
      tools,
      temperature: 0,
    },
    history: sessionMessages.slice(0, -1),
  });

  const responseStream = await chat.sendMessageStream({
    message: sessionMessages[sessionMessages.length - 1].parts,
  });

  let text = '';
  const functionCalls: any[] = [];

  for await (const chunk of responseStream) {
    if (options.signal?.aborted) throw new Error('AbortError');
    if (chunk.text) {
      text += chunk.text;
      options.onText(chunk.text);
    }
    if (chunk.functionCalls?.length) functionCalls.push(...chunk.functionCalls);
  }

  const toolBlocks: ToolUseBlock[] = functionCalls.map((fc, i) => ({
    id: `gc-${Date.now()}-${i}`,
    name: fc.name,
    input: fc.args as Record<string, unknown>,
  }));

  return { text, toolBlocks };
}

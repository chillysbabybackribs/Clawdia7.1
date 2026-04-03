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
import { checkBudget } from './agent/spending-budget';
import { detectStall, detectRecoveryFromTurn, buildRecoveryGuidanceMessage } from './agent/recoveryGuidance';
import { trimGeminiHistory } from './agent/historyTrimmer';
import { initBrowserBudget, checkBrowserBudget, updateBrowserBudget, checkBrowserScreenshotPolicy } from './agent/browserBudget';
import { getMemoryContext } from './db/memory';
import { startRun, trackToolCall, trackToolResult, completeRun, failRun } from './runTracker';
import type { BrowserBudgetState, ToolCallRecord, ToolUseBlock, LLMTurn, LoopOptions } from './agent/types';
import { prepareGeminiMessagesForSend } from './core/providers/geminiMessageProtocol';

// ── Module-level constants (kept for reference) ───────────────────────────────
// GEMINI_TOOLS is no longer used directly in the loop — tools are loaded on demand
// via the search_tools meta-tool. Kept here for reference only.
const GEMINI_TOOLS = null; // eslint-disable-line @typescript-eslint/no-unused-vars

const MAX_TOOL_TURNS = 20;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Tool timed out after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

const TOOL_TIMEOUTS: Record<string, number> = {
  browser: 60_000,
  desktop: 15_000,
  shell: 30_000,
};

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

        // Inject memory context as a prefill pair so the model has relevant stored facts
        const memoryContext = getMemoryContext(userText);
        if (memoryContext) {
            sessionMessages.push({ role: 'user', parts: [{ text: `[Memory context]\n${memoryContext}` }] });
            sessionMessages.push({ role: 'model', parts: [{ text: 'Understood.' }] });
        }

        let allToolCalls: any[] = [];
        const toolCallHistory: ToolCallRecord[] = [];
        const browserBudget: BrowserBudgetState = initBrowserBudget();
        let finalResponseText = '';
        let turns = 0;

        // Build system prompt once — rebuilt per iteration is wasteful and adds latency
        const caps = await renderCapabilities();
        const systemPrompt = buildSharedSystemPrompt(unrestrictedMode, userText) + (caps ? `\n\nOS CONTEXT:\n${caps}` : '');

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

            const budgetCheck = checkBudget(1);
            if (!budgetCheck.allowed) {
                throw new Error(`Budget exceeded: ${budgetCheck.periodLimit} cents limit reached for ${budgetCheck.blockedBy} period.`);
            }

            sendThinking('Gemini is thinking…');

            trimGeminiHistory(sessionMessages);

            // Inject iteration hint + stall detection before each LLM call
            {
                const hints: string[] = [`[Iteration ${turns} | Tools called so far: ${toolCallHistory.length}]`];
                if (turns >= 15) hints.push('You are approaching the iteration limit. Begin wrapping up and produce a final answer.');
                if (detectStall(toolCallHistory)) {
                    hints.push('Stall detected: you are repeating the same tool pattern without new evidence. Change strategy immediately.');
                }
                const hintText = hints.join('\n');
                sessionMessages.push({ role: 'user', parts: [{ text: hintText }] });
                sessionMessages.push({ role: 'model', parts: [{ text: 'Understood.' }] });
            }

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
            // Collect raw parts from candidates to preserve thoughtSignature.
            // chunk.functionCalls strips thoughtSignature; raw parts carry it.
            const rawParts: any[] = [];

            for await (const chunk of responseStream) {
                if (signal.aborted) throw new Error('AbortError');
                if (chunk.text) {
                    turnText += chunk.text;
                }
                const chunkParts: any[] = chunk.candidates?.[0]?.content?.parts ?? [];
                for (const p of chunkParts) {
                    if (p.functionCall) rawParts.push(p);
                }
            }

            // functionCalls derived from raw parts for tool execution below
            const functionCalls: any[] = rawParts.map((p: any) => p.functionCall);

            // Record assistant's turn — use raw parts to preserve thoughtSignature
            const assistantMessage: any = { role: 'model', parts: [] };
            if (turnText) assistantMessage.parts.push({ text: turnText });
            // Push each raw part as-is; thoughtSignature is a sibling of functionCall
            for (const p of rawParts) {
                assistantMessage.parts.push(p);
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

            // Browser budget check before executing tools this turn
            const turnToolBlocks: ToolUseBlock[] = functionCalls.map((fc: any, i: number) => ({
                id: `tc-budget-${i}`,
                name: fc.name,
                input: (fc.args ?? {}) as Record<string, unknown>,
            }));
            const budgetViolation = unrestrictedMode
                ? null
                : checkBrowserBudget(turnToolBlocks, browserBudget)
                  ?? checkBrowserScreenshotPolicy(turnToolBlocks, userText, toolCallHistory);
            if (budgetViolation) {
                sessionMessages.push({ role: 'user', parts: [{ text: `[POLICY] ${budgetViolation}` }] });
                continue;
            }

            // Execute tool calls in parallel (order preserved via index)
            const toolResultParts: any[] = await Promise.all(functionCalls.map(async (fc: any) => {
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
                            id: tcId, name: 'search_tools', status: 'success',
                            detail: `Loaded: ${parsed.tools_loaded?.join(', ') ?? 'catalog'}`,
                        });
                    }
                    return { functionResponse: { name: 'search_tools', response: { result: searchResultStr } } };
                }

                let resultStr: string;

                // ── Policy gate ───────────────────────────────────────────────
                const policyDecision = evaluatePolicy(fc.name, fc.args as Record<string, unknown>);

                if (policyDecision.effect === 'deny') {
                    resultStr = `[POLICY DENIED] ${policyDecision.reason} (rule: ${policyDecision.ruleId ?? 'none'}, profile: ${policyDecision.profileName})`;
                    if (!webContents.isDestroyed()) {
                        webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
                            id: tcId, name: uiName, status: 'error',
                            detail: `Policy denied: ${policyDecision.reason}`, policyDenied: true,
                        });
                    }
                    return { functionResponse: { name: fc.name, response: { result: resultStr, error: true } } };
                }

                if (policyDecision.effect === 'require_approval') {
                    resultStr = `[POLICY HELD] This action requires your approval: ${policyDecision.reason}. ` +
                        `Tool "${fc.name}" was not executed. Change the policy profile in Settings to allow it.`;
                    if (!webContents.isDestroyed()) {
                        webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
                            id: tcId, name: uiName, status: 'error',
                            detail: `Requires approval: ${policyDecision.reason}`, policyHeld: true,
                        });
                    }
                    return { functionResponse: { name: fc.name, response: { result: resultStr } } };
                }
                // ── End policy gate ───────────────────────────────────────────────

                let screenshotInlineData: { mimeType: string; data: string } | null = null;
                let tcIsError = false;
                try {
                    if (fc.name.startsWith('browser_') && browserService) {
                        const output = await withTimeout(executeBrowserTool(fc.name, fc.args as Record<string, unknown>, browserService, conversationId), TOOL_TIMEOUTS.browser, fc.name);
                        // Screenshots: extract inlineData so Gemini can actually see the image
                        if (fc.name === 'browser_screenshot' && (output as any)?.data) {
                            const shot = output as { type: string; mimeType: string; data: string; width?: number; height?: number };
                            resultStr = JSON.stringify({ ok: true, width: shot.width, height: shot.height, note: 'Screenshot captured — image provided as vision content.' });
                            screenshotInlineData = { mimeType: shot.mimeType, data: shot.data };
                        } else {
                            resultStr = truncateBrowserResult(JSON.stringify(output));
                        }
                    } else if (DESKTOP_TOOL_NAMES.has(fc.name)) {
                        resultStr = await withTimeout(executeGuiInteract(fc.args as Record<string, unknown>), TOOL_TIMEOUTS.desktop, fc.name);
                    } else {
                        resultStr = await withTimeout(executeShellTool(fc.name, fc.args as Record<string, unknown>), TOOL_TIMEOUTS.shell, fc.name);
                    }
                } catch (err) {
                    resultStr = JSON.stringify({ ok: false, error: (err as Error).message });
                    tcIsError = true;
                }

                const tcEndMs = Date.now();
                const tcElapsedMs = tcEndMs - tcStartMs;
                if (runId && eventId) {
                    trackToolResult(runId, eventId, resultStr.slice(0, 200), tcElapsedMs);
                }

                toolCallHistory.push({ id: tcId, name: fc.name, input: fc.args as Record<string, unknown>, result: resultStr, startMs: tcStartMs, endMs: tcEndMs, elapsed_ms: tcElapsedMs, success: !tcIsError });
                const successTcObj = { ...tcObj, status: 'success' as const, detail: resultStr.substring(0, 500), output: resultStr };
                if (!webContents.isDestroyed()) {
                    webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, successTcObj);
                }
                // For screenshots, inject inlineData as an extra part alongside the functionResponse
                const resultPart: any = { functionResponse: { name: fc.name, response: { result: resultStr } } };
                if (screenshotInlineData) {
                    return [resultPart, { inlineData: screenshotInlineData }];
                }
                return resultPart;
            }));

            // Flatten: screenshot returns [functionResponse, inlineData] pair; others return single part
            const flatToolResultParts: any[] = (toolResultParts as any[]).flat();

            // Extract result strings for budget tracking (look for functionResponse parts only)
            const turnResults = flatToolResultParts
                .filter((p: any) => p.functionResponse)
                .map((p: any) => p.functionResponse?.response?.result ?? '');
            updateBrowserBudget(turnToolBlocks, turnResults, browserBudget);

            // Inject recovery guidance if a browser failure pattern was detected
            const recoveryKey = detectRecoveryFromTurn(turnToolBlocks, turnResults);

            // Reply with tool results
            sessionMessages.push({
                role: 'user',
                parts: flatToolResultParts,
            });
            if (recoveryKey) {
                sessionMessages.push({ role: 'user', parts: [{ text: buildRecoveryGuidanceMessage(recoveryKey) }] });
                sessionMessages.push({ role: 'model', parts: [{ text: 'Understood, adjusting approach.' }] });
            }
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
  const prepared = prepareGeminiMessagesForSend([...sessionMessages], {
    caller: 'streamGeminiLLM',
    onRepair: (issues) => {
      console.warn(`[gemini] repaired request history: ${issues.join(' | ')}`);
    },
  }).messages;

  const chat = ai.chats.create({
    model: options.model,
    config: {
      systemInstruction: systemPrompt,
      tools,
      temperature: 0,
    },
    history: prepared.slice(0, -1),
  });

  const responseStream = await chat.sendMessageStream({
    message: prepared[prepared.length - 1]?.parts ?? [],
  });

  let text = '';
  // Collect raw parts to preserve thoughtSignature alongside functionCall.
  // chunk.functionCalls strips it; raw parts carry it as a sibling field.
  const rawFcParts: any[] = [];

  for await (const chunk of responseStream) {
    if (options.signal?.aborted) throw new Error('AbortError');
    if (chunk.text) {
      text += chunk.text;
      options.onText(chunk.text);
    }
    const chunkParts: any[] = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const p of chunkParts) {
      if (p.functionCall) rawFcParts.push(p);
    }
  }

  const toolBlocks: ToolUseBlock[] = rawFcParts.map((p, i) => ({
    id: `gc-${Date.now()}-${i}`,
    name: p.functionCall.name,
    input: p.functionCall.args as Record<string, unknown>,
    // thoughtSignature lives on the Part, not inside functionCall
    thoughtSignature: typeof p.thoughtSignature === 'string' ? p.thoughtSignature : undefined,
  }));

  return { text, toolBlocks };
}

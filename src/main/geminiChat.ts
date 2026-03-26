import { GoogleGenAI, Type } from '@google/genai';
import type { WebContents } from 'electron';
import * as fs from 'fs';
import { IPC_EVENTS } from './ipc-channels';
import type { MessageAttachment } from '../shared/types';
import { executeShellTool } from './core/cli/shellTools';
import { BROWSER_TOOLS, executeBrowserTool } from './core/cli/browserTools';
import type { BrowserService } from './core/browser/BrowserService';
import { truncateBrowserResult } from './core/cli/truncate';

type StreamParams = {
    webContents: WebContents;
    apiKey: string;
    modelRegistryId: string;
    userText: string;
    attachments?: MessageAttachment[];
    sessionMessages: any[];
    signal: AbortSignal;
    browserService?: BrowserService;
};

export async function streamGeminiChat({
    webContents,
    apiKey,
    modelRegistryId,
    userText,
    attachments,
    sessionMessages,
    signal,
    browserService,
}: StreamParams): Promise<{ response: string; error?: string; toolCalls?: any[] }> {
    // Use the optimized Google GenAI SDK
    const ai = new GoogleGenAI({ apiKey });

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

    const systemInstruction = `You have access to a local CLI environment and a browser. Use shell_exec to run shell commands, file_edit to read and edit files, and browser_* tools to navigate and interact with the browser. Use these tools efficiently. Do not wait for user permission unless the action is destructive.`;

    // Build browser tool declarations from BROWSER_TOOLS schemas
    const browserDeclarations = BROWSER_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        parameters: {
            type: Type.OBJECT,
            properties: Object.fromEntries(
                Object.entries((t.input_schema as any).properties ?? {}).map(([k, v]: [string, any]) => [
                    k,
                    { type: v.type === 'number' ? Type.NUMBER : Type.STRING, description: v.description ?? '' },
                ])
            ),
            required: (t.input_schema as any).required ?? [],
        },
    }));

    const tools = [{
        functionDeclarations: [
            {
                name: 'shell_exec',
                description: 'Execute a bash shell command and explore the local system.',
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        command: { type: Type.STRING, description: 'The shell command to run.' }
                    },
                    required: ['command']
                }
            },
            {
                name: 'file_edit',
                description: 'Read and edit files on the local system.',
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        command: { type: Type.STRING, description: 'The action to perform: view, create, or str_replace.' },
                        path: { type: Type.STRING, description: 'The file path.' },
                        file_text: { type: Type.STRING, description: 'File content (if create)' },
                        old_str: { type: Type.STRING, description: 'Text to replace (if str_replace)' },
                        new_str: { type: Type.STRING, description: 'New text (if str_replace)' }
                    },
                    required: ['command', 'path']
                }
            },
            ...browserDeclarations,
        ]
    }] as any;

    try {
        sessionMessages.push(userMessage);

        let allToolCalls: any[] = [];
        let finalResponseText = '';

        while (true) {
            if (signal.aborted) throw new Error('AbortError');

            sendThinking('Gemini is thinking…');

            const chat = ai.chats.create({
                model: modelRegistryId,
                config: {
                    systemInstruction,
                    tools,
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
                    sendText(chunk.text);
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
                break; // Done, no tools called
            }

            // Execute tool calls
            const toolResultParts: any[] = [];
            for (const fc of functionCalls) {
                const uiName = fc.name;
                const detail = fc.name === 'shell_exec' ? fc.args.command : JSON.stringify(fc.args);
                const tcId = `tc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

                const tcObj = { id: tcId, name: uiName, status: 'running' as const, detail };
                allToolCalls.push(tcObj);

                if (!webContents.isDestroyed()) {
                    webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, tcObj);
                }

                let resultStr: string;
                if (fc.name.startsWith('browser_') && browserService) {
                    const output = await executeBrowserTool(fc.name, fc.args as Record<string, unknown>, browserService);
                    resultStr = truncateBrowserResult(JSON.stringify(output));
                } else {
                    resultStr = await executeShellTool(fc.name, fc.args as Record<string, unknown>);
                }

                toolResultParts.push({
                    functionResponse: {
                        name: fc.name,
                        response: { result: resultStr },
                    }
                });

                const successTcObj = { ...tcObj, status: 'success' as const, detail: resultStr.substring(0, 500) };
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

        if (!webContents.isDestroyed()) {
            webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true });
        }

        return { response: finalResponseText, toolCalls: allToolCalls };
    } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (err.name === 'AbortError') {
            if (!webContents.isDestroyed()) webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, cancelled: true });
            return { response: '', error: 'Stopped' };
        }
        sessionMessages.pop();
        if (!webContents.isDestroyed()) {
            webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message });
        }
        return { response: '', error: err.message };
    }
}

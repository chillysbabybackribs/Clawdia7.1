# OpenAI Provider — Chat Streaming & Tool-Use Design

**Date:** 2026-03-25
**Status:** Approved

---

## Overview

Implement full OpenAI provider support in Clawdia 7.0, achieving parity with the existing Anthropic provider: streaming chat, bash/file tool use, and browser tool-use agentic loop. A provider-neutral `NeutralMessage` session format enables shared conversation history across providers.

---

## 1. Neutral Message Format

Add to `src/shared/types.ts`:

```typescript
export type NeutralContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; base64: string }
  | { type: 'file'; name: string; text: string };

export interface NeutralMessage {
  role: 'user' | 'assistant';
  parts: NeutralContentPart[];
}
```

- `registerIpc.ts` session store changes from `Map<string, Anthropic.MessageParam[]>` to `Map<string, NeutralMessage[]>`
- `toUiMessages()` reads `NeutralMessage[]`: `text` parts → content, `image` parts → `[Image]`, `file` parts → `[Attachment: name]`
- Both provider functions accept and mutate the same `NeutralMessage[]` session

---

## 2. File Changes

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `NeutralMessage`, `NeutralContentPart` |
| `src/main/openaiChat.ts` | New — full OpenAI provider implementation |
| `src/main/anthropicChat.ts` | Update `StreamParams` to `NeutralMessage[]`, add `toAnthropicMessages()`, remove old `buildUserContent` |
| `src/main/core/cli/browserTools.ts` | Add `BROWSER_TOOLS_OPENAI` export |
| `src/main/registerIpc.ts` | Switch session store, remove Anthropic-only guard, add OpenAI dispatch |
| `package.json` | Add `openai` production dependency |

No renderer changes required — IPC events are provider-agnostic.

---

## 3. Provider Translation

### Anthropic (`anthropicChat.ts`)
Replace `buildUserContent` with `toAnthropicMessages(neutral: NeutralMessage[]): Anthropic.MessageParam[]`:
- `text` parts → `{ type: 'text', text }`
- `image` parts → `{ type: 'image', source: { type: 'base64', media_type, data } }`
- `file` parts → `{ type: 'text', text: '[Attachment: name]\ncontent' }`

### OpenAI (`openaiChat.ts`)
`toOpenAIMessages(neutral: NeutralMessage[]): OpenAI.ChatCompletionMessageParam[]`:
- Text-only messages → `{ role, content: string }`
- Mixed messages → `{ role, content: ContentPart[] }` where image parts become `{ type: 'image_url', image_url: { url: 'data:mimeType;base64,...' } }`
- File parts → text content blocks with `[Attachment: name]` prefix

---

## 4. OpenAI Execution Paths

### Path A — Standard Streaming (no browserService)
```
client.chat.completions.create({ model, messages, stream: true })
  → async iterator over chunks
  → emit CHAT_STREAM_TEXT per delta.content
  → emit CHAT_STREAM_END on completion
```
No reasoning/thinking — text only. Bash and file tools are not available in this path; they require the agentic loop (Path B).

### Path B — Agentic Tool-Use Loop (with browserService)
```
while turns < 20:
  client.chat.completions.create({ model, messages: loopMessages, tools: BROWSER_TOOLS_OPENAI })
  extract tool_calls from response
  emit CHAT_STREAM_TEXT for any text content
  if no tool_calls or finish_reason === 'stop': break
  execute tools via executeBrowserTool()
  emit CHAT_TOOL_ACTIVITY per tool
  push { role: 'tool', tool_call_id, content } messages to loopMessages
  repeat
sync final user + assistant NeutralMessages back to sessionMessages
```

Bash and `str_replace_based_edit_tool` are available in both paths via OpenAI function calling format (same executor, different tool schema).

---

## 5. Browser Tools — OpenAI Format

Add `BROWSER_TOOLS_OPENAI: OpenAI.ChatCompletionTool[]` to `src/main/core/cli/browserTools.ts`. Same 13 tools re-expressed as:
```typescript
{
  type: 'function',
  function: {
    name: 'browser_navigate',
    description: '...',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
  }
}
```
`executeBrowserTool(name, input, browserService)` requires no changes — already provider-agnostic.

---

## 6. Session Mutation Contract

Both provider functions follow the same contract:
1. Push user `NeutralMessage` to `sessionMessages` at the start
2. On success: push assistant `NeutralMessage` (streaming path) or sync all loop turns (agentic path)
3. On abort: pop user message, emit `CHAT_STREAM_END { ok: false, cancelled: true }`
4. On error: pop user message, emit `CHAT_STREAM_END { ok: false, error }`

Intermediate tool-role messages stay in `loopMessages` only — never written to `sessionMessages`.

---

## 7. registerIpc.ts Changes

- Session store: `const sessions = new Map<string, NeutralMessage[]>()`
- `CHAT_SEND` handler: remove `provider !== 'anthropic'` guard, dispatch on `settings.provider`:
  ```typescript
  if (settings.provider === 'openai') {
    return streamOpenAIChat({ ... sessionMessages, ... });
  }
  return streamAnthropicChat({ ... sessionMessages, ... });
  ```
- `toUiMessages()` updated to accept `NeutralMessage[]`

---

## 8. Error Handling

| Condition | Behavior |
|---|---|
| Invalid API key (401) | Return `{ error: 'Invalid OpenAI API key.' }` |
| Model not found (404) | Return `{ error: 'Model not available.' }` |
| Abort | Detect `AbortError`, emit cancelled stream end |
| Unknown provider | Return `{ error: 'Unsupported provider.' }` (replaces old Anthropic-only guard) |

---

## 9. Tests

- `tests/main/openaiChat.test.ts` — streaming path (mock client), tool-use loop (mock browser service)
- `tests/main/anthropicChat.test.ts` — update to `NeutralMessage[]` session format
- `tests/main/core/cli/browserTools.test.ts` — add `BROWSER_TOOLS_OPENAI` shape coverage (13 tools, correct function calling format)

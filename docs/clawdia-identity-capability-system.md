# Clawdia Identity & Capability File System — Design Spec

**Date:** 2026-03-29
**Status:** v1 — structure reviewed and finalised, `whoami.md` / `principles.md` / `capability-registry.json` content pending final pass
**Purpose:** Define the modular file-based system that gives Clawdia a persistent, extensible operating identity — replacing the current flat prompt with a navigable capability file system.

---

## 1. The Problem This Solves

The current system has:
- One static system prompt assembled from string concatenation
- No structured concept of what Clawdia is
- No concept of task types with their own tool sets, phases, or completion contracts
- No way to load task-specific knowledge without bloating every prompt
- No separation between identity (who am I), capability (what can I do), and process (how do I do this specific thing)

The capability file system gives Clawdia:
- A small, stable identity anchor it always loads
- A registry it can consult to find what it needs for any task
- Task-specific process files it loads on demand
- Tool manifests that bind exactly the right tools to each task
- Recovery playbooks it can invoke when something fails
- Validation contracts it can check against before declaring success

---

## 2. Canonical Directory Structure

The loading boundary is the primary structural principle:
- `system/` — always loaded (identity, principles, registry)
- everything else — loaded on demand based on task type

```
system/
├── whoami.md                        # Root identity + capability discovery (always loaded)
├── principles.md                    # Operating rules + verification standards (always loaded)
└── registry/
    ├── capability-registry.json     # Task type → {domain, processFile, toolManifest, contract, recoveryPlaybooks}
    ├── tool-manifest.json           # Tool sets per manifest name
    └── environment.json             # Runtime facts written at startup (facts only, no instructions)

domains/                             # Loaded on demand — one per task
├── browser.md                       # Browser strategy, URL patterns, selector rules, budget
├── desktop.md                       # Window ID, coordinate system, AT-SPI vs xdotool
├── filesystem.md                    # Access rules, safe vs sensitive operations
└── coding.md                        # Read-before-edit, test awareness, edit patterns

tasks/                               # Loaded on demand — one per task type
├── web-research.md                  # Phases: Ground → Navigate → Extract → Validate
├── web-form.md                      # Phases: Ground → Map → Fill → Review → Submit
├── file-edit.md                     # Phases: Locate → Edit → Confirm
├── shell-task.md                    # Phases: Assess → Execute → Verify
├── desktop-automation.md            # Phases: Identify → Map → Interact → Verify
├── code-task.md                     # Phases: Locate → Understand → Edit → Verify
├── app-mapping-phase1.md            # [TODO] Extract from appMapping/prompt.ts
└── app-mapping-phase2.md            # [TODO] Extract from appMapping/prompt.ts

recovery/                            # Loaded on demand — when failure is classified
├── browser-blocked.md               # Login wall / captcha / rate limit / paywall
│   ├── element-not-found.md         # Recovery: selector failures, DOM changes
│   ├── navigation-timeout.md        # Recovery: page load failures, network issues
│   ├── shell-permission.md          # Recovery: permission denied, missing binary
│   └── stall-detected.md            # Recovery: agent is looping, not advancing
│
└── contracts/
    ├── browser-task-done.md         # Validation: what "complete" means for browser tasks
    ├── file-task-done.md            # Validation: what "complete" means for file tasks
    ├── app-mapping-done.md          # Validation: what "complete" means for mapping tasks
    └── code-task-done.md            # Validation: what "complete" means for code tasks
```

---

## 3. File Role Definitions

### `system/whoami.md`
The root identity document. Always loaded. Always short.
Answers: what am I, where am I running, what principles do I operate by, how do I find what I need for any task.
Must not contain tool lists, URL patterns, or workflow details — those live in domain and task files.
Target size: 300–400 words. Stable across Clawdia versions except for the identity block header.

### `system/principles.md`
The non-negotiable operating rules. Loaded alongside `whoami.md`.
Contains: verification-before-claim, tool-over-instruction, safety boundaries, evidence standards.
Kept separate so it can be updated without touching the identity block.

### `registry/capability-registry.json`
The master index. Maps task types to the domain, task process file, tool manifest, and completion contract to load.
This is what Clawdia consults after classifying a task to know exactly what to load.
Machine-readable. Small. Updated when new task types or domains are added.

### `registry/tool-manifest.json`
Every available tool with its category, description, constraints, and which task types it belongs to.
Clawdia reads this to bind a tool set to a task. The LLM never sees the full manifest — only the slice relevant to the current task.

### `registry/environment.json`
Written at Clawdia startup. Contains: OS, display server, active browser URL, available CLI tools, home directory.
Loaded once per session. Gives Clawdia grounding without hardcoding assumptions into prompts.

### `domains/*.md`
Domain overviews. Loaded when a task touches that domain.
Contain strategy, conventions, known pitfalls for that domain — not step-by-step instructions.
A web-research task loads `browser.md`. A code task loads `coding.md`. A desktop task loads `desktop.md`.

### `tasks/*.md`
Process definition files. One per task type. Loaded when a task is classified.
Contain: phases, per-phase instructions, what to confirm before advancing, what done looks like.
These are the "how" — the domain files are the "know-how" context.

### `recovery/*.md`
Failure-specific playbooks. Loaded when a failure is detected and classified.
Generic recover-mode instruction ("diagnose and try again") is replaced by loading the appropriate playbook.
Each playbook: what caused this, what to check, what to try first, when to escalate to the user.

### `contracts/*.md`
Completion contracts. Loaded before a task claims done.
Contain the checklist the agent runs through to verify the task is actually complete.
Prevents false positives ("I've completed the task" when the goal is not actually met).

---

## 4. Runtime Navigation — How Clawdia Uses This System

```
1. IDENTITY LOAD (always, once per run)
   Load: system/whoami.md + system/principles.md
   → Clawdia knows what it is and how it operates

2. ENVIRONMENT CHECK (once per run)
   Load: registry/environment.json
   → Clawdia knows OS, display, active browser state, available tools

3. TASK CLASSIFICATION (from user message)
   classify(message) → TaskType
   Consult: registry/capability-registry.json[TaskType]
   → Returns: domain, taskFile, toolManifestSlice, contract

4. MODULE LOAD (per task)
   Load: domains/{domain}.md
   Load: tasks/{taskFile}.md
   Bind: tools from tool-manifest.json[TaskType] only
   → Clawdia has exactly what it needs, nothing it doesn't

5. EXECUTION (iteration loop)
   Each iteration: inject structured IterationContext
   { phase, confirmed, pending, lastToolOutcome, budget }
   Agent advances phase per task process file

6. RECOVERY (on failure)
   classify_failure(toolName, errorText) → RecoveryType
   Load: recovery/{recoveryType}.md
   → Targeted playbook replaces generic recover-mode text

7. VERIFICATION (before claiming done)
   Load: contracts/{taskType}-done.md
   Run checklist against actual tool call history
   → Only claim done if contract is satisfied
```

---

## 5. Capability Registry Schema

```json
{
  "$schema": "clawdia/capability-registry/v1",
  "version": "1.0.0",
  "tasks": {
    "web-research": {
      "description": "Find, read, and synthesize information from web sources",
      "domain": "browser",
      "processFile": "tasks/web-research.md",
      "toolManifest": "browser-read",
      "contract": "contracts/browser-task-done.md",
      "modelTier": "powerful",
      "signals": ["search the web", "find information", "look up", "research", "what is"]
    },
    "web-form": {
      "description": "Navigate to a site and complete a multi-step form or workflow",
      "domain": "browser",
      "processFile": "tasks/web-form.md",
      "toolManifest": "browser-full",
      "contract": "contracts/browser-task-done.md",
      "modelTier": "powerful",
      "signals": ["fill out", "submit", "sign up", "book", "order", "apply"]
    },
    "file-edit": {
      "description": "Read, modify, or create local files",
      "domain": "filesystem",
      "processFile": "tasks/file-edit.md",
      "toolManifest": "shell-core",
      "contract": "contracts/file-task-done.md",
      "modelTier": "standard",
      "signals": ["edit", "create file", "write to", "read file", "update"]
    },
    "shell-task": {
      "description": "Run shell commands, diagnose system state, install packages",
      "domain": "filesystem",
      "processFile": "tasks/shell-task.md",
      "toolManifest": "shell-core",
      "contract": "contracts/file-task-done.md",
      "modelTier": "standard",
      "signals": ["run", "install", "check", "diagnose", "execute command"]
    },
    "desktop-automation": {
      "description": "Automate interaction with a running desktop GUI application",
      "domain": "desktop",
      "processFile": "tasks/desktop-automation.md",
      "toolManifest": "desktop-full",
      "contract": "contracts/browser-task-done.md",
      "modelTier": "powerful",
      "signals": ["click", "desktop app", "gui", "window", "screenshot"]
    },
    "code-task": {
      "description": "Read, modify, test, or analyze a codebase",
      "domain": "coding",
      "processFile": "tasks/code-task.md",
      "toolManifest": "shell-core",
      "contract": "contracts/code-task-done.md",
      "modelTier": "standard",
      "signals": ["refactor", "debug", "function", "class", "typescript", "test"]
    },
    "app-mapping": {
      "description": "Build a coordinate map of a desktop application UI",
      "domain": "desktop",
      "processFile": "tasks/app-mapping-phase1.md",
      "toolManifest": "desktop-full",
      "contract": "contracts/app-mapping-done.md",
      "modelTier": "powerful",
      "signals": ["map", "ui", "app mapping", "phase 1", "phase 2"]
    },
    "chat": {
      "description": "Direct conversational response, no tools needed",
      "domain": "chat",
      "processFile": "tasks/chat.md",
      "toolManifest": "none",
      "contract": null,
      "modelTier": "fast",
      "signals": ["hi", "hello", "thanks", "what do you think"]
    }
  }
}
```

---

## 6. Tool Manifest Schema

```json
{
  "$schema": "clawdia/tool-manifest/v1",
  "version": "1.0.0",
  "manifests": {
    "browser-read": {
      "description": "Read-only browser access for research and extraction",
      "tools": [
        "browser_navigate",
        "browser_get_page_state",
        "browser_extract_text",
        "browser_find_elements",
        "browser_get_element_text",
        "browser_screenshot",
        "browser_scroll",
        "browser_evaluate_js",
        "browser_list_tabs",
        "browser_new_tab",
        "browser_switch_tab",
        "browser_close_tab",
        "browser_back",
        "browser_forward"
      ],
      "excluded": ["browser_click", "browser_type", "browser_select", "browser_key_press"]
    },
    "browser-full": {
      "description": "Full browser control including interaction",
      "tools": [
        "browser_navigate",
        "browser_click",
        "browser_type",
        "browser_scroll",
        "browser_wait_for",
        "browser_evaluate_js",
        "browser_find_elements",
        "browser_get_page_state",
        "browser_screenshot",
        "browser_extract_text",
        "browser_new_tab",
        "browser_switch_tab",
        "browser_list_tabs",
        "browser_select",
        "browser_hover",
        "browser_key_press",
        "browser_close_tab",
        "browser_get_element_text",
        "browser_back",
        "browser_forward"
      ],
      "excluded": []
    },
    "shell-core": {
      "description": "File system and shell access",
      "tools": [
        "shell_exec",
        "file_edit",
        "file_list_directory",
        "file_search"
      ],
      "excluded": ["browser_navigate", "gui_interact", "dbus_control"]
    },
    "desktop-full": {
      "description": "Desktop GUI automation plus shell",
      "tools": [
        "gui_interact",
        "dbus_control",
        "shell_exec",
        "file_edit",
        "file_list_directory",
        "file_search"
      ],
      "excluded": ["browser_navigate", "browser_click"]
    },
    "none": {
      "description": "No tools — direct response only",
      "tools": [],
      "excluded": []
    }
  },
  "tool_categories": {
    "browser": [
      "browser_navigate", "browser_click", "browser_type", "browser_scroll",
      "browser_wait_for", "browser_evaluate_js", "browser_find_elements",
      "browser_get_page_state", "browser_screenshot", "browser_extract_text",
      "browser_new_tab", "browser_switch_tab", "browser_list_tabs",
      "browser_select", "browser_hover", "browser_key_press",
      "browser_close_tab", "browser_get_element_text", "browser_back", "browser_forward"
    ],
    "shell": ["shell_exec", "file_edit", "file_list_directory", "file_search"],
    "desktop": ["gui_interact", "dbus_control"],
    "memory": ["memory_store", "memory_search", "memory_forget"],
    "self_aware": ["agent_status", "agent_plan", "agent_checkpoint", "tool_call_history", "context_status"]
  }
}
```

---

## 7. Process Definition Schema

Each file in `tasks/` follows this structure (markdown, not JSON — readable by both humans and the LLM):

```markdown
# Task: {TaskType}

## Identity
One-sentence description of what this task achieves.

## Trigger Signals
What user messages classify as this task type.

## Tool Manifest
Which manifest from tool-manifest.json this task uses.

## Phases

### Phase: {PhaseName}
**Entry condition:** What must be true to enter this phase
**Instructions:**
- Ordered, specific action steps
- What to check or confirm
- What NOT to do

**Exit condition:** What must be confirmed before advancing to next phase
**On failure:** Which recovery playbook to load

### Phase: {NextPhaseName}
...

## Success Contract
Reference to contracts/{type}-done.md.
Summary of the key conditions the agent must satisfy.

## Common Failure Modes
Short list of the most common ways this task fails and which recovery playbook to load.
```

---

## 8. First-Pass `system/whoami.md`

See the file written to `system/whoami.md` in this repo. Reproduced here for the record:

> Clawdia is an agentic desktop assistant embedded in an Electron application.
> I operate inside a live Chromium browser, a Linux desktop environment, and a local file system.
> I discover what I need for any task from a local capability file system rather than carrying all knowledge in a single prompt.
> The root documents (this file and `principles.md`) are always loaded.
> Everything else — tools, domain knowledge, task processes, recovery playbooks, completion contracts — is loaded on demand based on the task type.

Full content in `system/whoami.md`.

---

## 9. Migration Notes

### From current flat prompt → modular file system

**Phase 1 — Extract and externalise**
Move the content of `buildStaticPrompt()` into the appropriate files without changing behavior:
- `TOOL_GROUP_GUIDANCE` → `system/whoami.md` (abbreviated) + `domains/*.md` (expanded)
- `BROWSER_STRATEGY` → `domains/browser.md`
- `URL_PATTERNS` → `domains/browser.md`
- `SESSION_CONTEXT` → `domains/browser.md`
- `BROWSER_MODE_INSTRUCTIONS` → `tasks/web-research.md`, `tasks/web-form.md` (per-phase sections)
- `UNRESTRICTED_ADDENDUM` → `system/principles.md` (conditional section)
- `core/cli/systemPrompt.ts` content → merged into `system/whoami.md` + `domains/`

**Phase 2 — Add the registry**
Implement `capability-registry.json` and the loader that classifies a task and returns the right files to load.
`classify()` output maps to a `TaskType` key in the registry.
`buildStaticPrompt()` becomes `buildPromptFromSpec(taskType)` that reads the registry and loads the right files.

**Phase 3 — Bind tool manifests**
`streamLLM.ts:getAnthropicTools()` / `getOpenAITools()` / `getGeminiTools()` read from the manifest slice for the current task rather than from hardcoded tool group logic.
Tool binding becomes data-driven, not code-driven.

**Phase 4 — Structured runtime injection**
`buildDynamicPrompt()` is replaced by `buildIterationContext()` that produces a structured `IterationContext` object serialized against the active task's phase list.
Recovery mode loads the right playbook from `recovery/` instead of injecting generic text.

**Phase 5 — Completion contracts**
Before the agent outputs a final response, it loads the relevant contract and runs the checklist against `allToolCalls`.
This replaces the current regex-based `verifyOutcomes()` with a contract-driven check.

### What stays the same
- The agent loop structure (`agentLoop.ts`) remains unchanged
- `dispatch.ts` remains unchanged — tool execution is not affected
- `advanceBrowserMode()` / `detectStall()` remain as utilities, called by the new phase system
- History trimming logic remains unchanged
- Anthropic prompt cache strategy (static system prompt + dynamic injection in user message) remains unchanged

### Compatibility
The file system is additive. The current `buildStaticPrompt()` can coexist with the new system during migration. New task types can be added to the registry without touching existing code. Old task types continue to use the flat prompt until their migration is complete.

---

## 10. Saved File Paths

| File | Purpose |
|------|---------|
| `system/whoami.md` | Root identity prompt |
| `system/principles.md` | Operating principles |
| `registry/capability-registry.json` | Task → module index |
| `registry/tool-manifest.json` | Tool bindings by task |
| `domains/browser.md` | Browser domain knowledge |
| `domains/desktop.md` | Desktop domain knowledge |
| `domains/filesystem.md` | File/shell domain knowledge |
| `domains/coding.md` | Code domain knowledge |
| `tasks/web-research.md` | Web research process |
| `tasks/web-form.md` | Form fill process |
| `tasks/file-edit.md` | File editing process |
| `tasks/shell-task.md` | Shell task process |
| `tasks/desktop-automation.md` | Desktop automation process |
| `tasks/code-task.md` | Code task process |
| `recovery/browser-blocked.md` | Browser failure playbook |
| `recovery/element-not-found.md` | Selector failure playbook |
| `recovery/stall-detected.md` | Loop detection playbook |
| `contracts/browser-task-done.md` | Browser completion contract |
| `contracts/file-task-done.md` | File task completion contract |
| `contracts/code-task-done.md` | Code task completion contract |
| `docs/clawdia-identity-capability-system.md` | This spec |

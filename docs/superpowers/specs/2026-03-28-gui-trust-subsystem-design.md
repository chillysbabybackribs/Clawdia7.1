# GUI Trust Subsystem Design

**Date:** 2026-03-28
**Status:** Proposed
**Scope:** Recursive trust mapping and CLI compilation for desktop GUIs that do not expose accessibility trees, APIs, or source code

---

## Overview

Clawdia already has three important foundations:

- coordinate-oriented screen mapping in `src/main/core/desktop/screen-map.ts`
- execution primitives and desktop macros in `src/main/core/desktop/guiExecutor.ts`
- app-specific validation workflows and artifacts under `docs/app-mapping-*` and `artifacts/app-mapping/*`

Those pieces are useful, but they still treat coordinates as the primary asset. That is not durable enough for hostile or tree-less GUIs.

This subsystem extends the current architecture so Clawdia can:

1. open a target app and lock onto the correct monitor/window
2. infer a synthetic top-layer UI graph from pixels
3. probe safe elements and validate state transitions
4. descend recursively into menus, dropdowns, modals, tabs, and child panels
5. assign trust scores to elements and transitions
6. compile trusted elements and workflows into stable CLI commands

The key design rule is:

> Coordinates are a cached execution detail, not the source of truth.

The source of truth becomes a synthetic interaction graph built from visual evidence and repeated validation.

---

## Goals

- Make no-tree desktop GUIs operable through a trusted recursive mapping system.
- Turn trusted GUI elements and workflows into reusable CLI-addressable commands.
- Preserve compatibility with existing screen-map and app-mapping artifacts.
- Support gradual improvement through repeated runs, rather than requiring full remapping every session.
- Keep unsafe actions out of autonomous probing unless explicitly allowed.

## Non-Goals

- Replacing the existing `gui_interact` tool surface.
- Solving arbitrary canvas-only editing semantics in v1.
- Requiring model retraining to improve reliability.
- Blindly crawling dangerous actions such as delete, submit, purchase, overwrite, or quit.

---

## Design Principles

### 1. Synthetic Graph Over Raw Coordinates

The system should infer UI elements and relationships from screenshots, OCR, icon cues, geometry, and repeated state transitions.

### 2. Trust Must Be Earned

An element becomes trusted only after repeated successful activation with consistent outcomes.

### 3. Closed-Loop Execution

Every action must define an expected postcondition and verify it from the next observed state.

### 4. Relative And Semantic Anchoring

Each element should be addressable by multiple anchors:

- absolute screen coordinates
- window-relative coordinates
- parent-relative coordinates
- text/OCR anchors
- icon or visual embeddings
- expected neighboring elements

### 5. Recursive Descent

The crawler should validate top-level surfaces first, then descend into children only after the parent transition is trusted.

### 6. CLI Compilation From Trust, Not Guessing

Commands are generated only from trusted nodes and trusted workflows.

---

## System Model

The subsystem is a layered compiler:

1. **Observe** the current app state
2. **Infer** candidate UI elements
3. **Probe** safe interactions
4. **Verify** resulting state transitions
5. **Persist** trust and recovery knowledge
6. **Compile** trusted nodes into commands

This creates an app-specific interaction graph rather than a one-off screenshot map.

---

## Core Concepts

### App Profile

Describes the target application and the operating assumptions for a crawl.

```ts
interface GuiAppProfile {
  appId: string;                 // "gimp", "obs", "inkscape"
  displayName: string;
  windowMatchers: string[];      // title/class hints
  baselineLayout: 'windowed' | 'maximized' | 'fullscreen';
  monitorPolicy: 'follow-window' | 'lock-primary' | 'lock-discovered';
  probePolicyId: string;
  versionFingerprint?: string;
}
```

### UI State Fingerprint

Represents a stable snapshot of a particular visible app state.

```ts
interface GuiStateFingerprint {
  stateId: string;
  appId: string;
  windowBounds: { x: number; y: number; width: number; height: number };
  monitor: { name: string; width: number; height: number; originX: number; originY: number };
  perceptualHash: string;
  ocrSummary: string[];
  visibleRegionHash: string[];
  activeDialog?: string;
  parentStateId?: string;
  enteredByEdgeId?: string;
  screenshotPath: string;
  createdAt: string;
}
```

### Synthetic Element Node

Represents an inferred interactable target on screen.

```ts
type GuiElementRole =
  | 'menu_item'
  | 'button'
  | 'tab'
  | 'dialog'
  | 'input'
  | 'checkbox'
  | 'radio'
  | 'list'
  | 'list_item'
  | 'dropdown'
  | 'toolbar_button'
  | 'icon_button'
  | 'panel'
  | 'canvas'
  | 'unknown';

interface GuiElementNode {
  elementId: string;
  stateId: string;
  role: GuiElementRole;
  label: string | null;
  bbox: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  confidence: number;            // perception confidence
  interactableScore: number;     // likely clickable/focusable
  enabledGuess: boolean | null;
  selectedGuess: boolean | null;
  iconEmbeddingRef?: string;
  textAnchor?: string;
  parentElementId?: string;
  parentStateId?: string;
  childSurfaceHint?: 'menu' | 'dialog' | 'panel' | 'dropdown' | 'tab';
  neighbors: string[];
}
```

### Trust Edge

Represents an action on an element and the observed resulting state.

```ts
type GuiActionKind =
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'hover'
  | 'focus'
  | 'type'
  | 'shortcut'
  | 'scroll';

interface GuiTrustEdge {
  edgeId: string;
  sourceStateId: string;
  sourceElementId: string;
  action: GuiActionKind;
  actionArgs?: Record<string, string | number | boolean>;
  expectedSurface: 'same_state' | 'menu' | 'dialog' | 'dropdown' | 'tab_switch' | 'unknown';
  targetStateId?: string;
  verificationMode: 'state_diff' | 'ocr' | 'pixel_change' | 'window_title' | 'manual';
  successCount: number;
  failureCount: number;
  trustScore: number;
  avgLatencyMs?: number;
  lastVerifiedAt?: string;
  rollbackAction?: {
    action: GuiActionKind;
    actionArgs?: Record<string, string | number | boolean>;
  };
  notes?: string;
}
```

### Command Spec

CLI output compiled from trusted nodes or multi-step trusted workflows.

```ts
interface GuiCommandSpec {
  commandId: string;             // "gimp.file.open"
  appId: string;
  kind: 'element' | 'workflow';
  description: string;
  entryStateId: string;
  targetElementId?: string;
  workflowEdgeIds: string[];
  requiredTrustScore: number;
  params?: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'path';
    required: boolean;
    labelHint?: string;
  }>;
  verify: {
    mode: 'state_diff' | 'ocr' | 'window_title';
    cues: string[];
  };
}
```

---

## Relationship To Existing Code

### Existing Pieces To Reuse

- `src/main/core/desktop/screen-map.ts`
  Existing coordinate capture and monitor detection should become the lowest-level anchoring layer.
- `src/main/core/desktop/screen-map-types.ts`
  Existing `MapPoint` and session models should be extended rather than discarded.
- `src/main/core/desktop/guiExecutor.ts`
  Existing click, key, type, focus, screenshot, OCR, and macro support should become the action backend for trust probing.
- `src/main/core/desktop/screenshot.ts`
  Existing screenshot and OCR helpers should feed state fingerprinting and validation.
- `docs/app-mapping-validation-process.md`
  Existing map-freeze, validation, calibration, and structural-failure rules should be preserved as acceptance policy.
- `artifacts/app-mapping/*`
  Existing artifacts remain valid input and migration material.

### New Subsystem Modules

Proposed new module area:

- `src/main/core/desktop/gui-trust/`

Suggested files:

- `types.ts`
- `state-fingerprint.ts`
- `element-inference.ts`
- `probe-policy.ts`
- `trust-crawler.ts`
- `trust-store.ts`
- `command-compiler.ts`
- `replay.ts`
- `risk-policy.ts`
- `artifact-writer.ts`

This keeps the new system adjacent to, but not tangled with, the generic executor.

---

## End-To-End Flow

## 1. Session Bootstrap

Inputs:

- target app name or profile
- launch/focus policy
- monitor/window matching rules
- risk policy

Steps:

1. locate or launch the target app
2. focus and maximize/fullscreen according to profile
3. detect monitor and window geometry
4. capture baseline full-monitor screenshot
5. capture app-window screenshot
6. create initial `GuiStateFingerprint`

Outputs:

- `session.json`
- `geometry.json`
- `monitor.png`
- `app.png`
- initial synthetic state graph node

## 2. Element Inference

For the active state:

1. run OCR and collect text candidates
2. segment visible control-like regions
3. classify likely roles using geometry, text, icons, alignment, and visual affordances
4. merge OCR text with candidate boxes
5. cluster candidates into likely parents such as menu bar, toolbar, left rail, tab strip, dialog body

Outputs:

- synthetic top-layer element nodes
- confidence scores
- candidate action hints

## 3. Safe Probe Planning

Each candidate is assigned a risk level:

- `safe`
  menu opens, tab switches, focusable controls, help, non-destructive toggles
- `cautious`
  checkbox flips, panel visibility toggles, dialog opens
- `dangerous`
  delete, overwrite, submit, send, purchase, quit

The crawler only auto-probes `safe` by default.

For each probe:

- choose action kind
- choose anchor strategy
- define expected surface change
- define rollback strategy

## 4. Probe Execution

For each planned probe:

1. resolve best anchor for the target element
2. execute via `guiExecutor`
3. capture after-state screenshot
4. compare before/after state
5. verify expected transition
6. record success or failure
7. rollback if needed

## 5. Recursive Descent

If a probe opens a child surface:

- menu
- submenu
- dropdown
- modal
- tab content
- properties panel

then the crawler:

1. creates a child state fingerprint
2. links the child state to the triggering edge
3. runs element inference within the child state
4. probes safe child elements
5. repeats until stop conditions are reached

The crawl should be breadth-first across top-level surfaces, then depth-first within an opened child surface.

## 6. Trust Consolidation

After repeated runs, merge equivalent states and elements across sessions using:

- app id
- version fingerprint
- monitor/window-normalized geometry
- perceptual similarity
- OCR similarity
- transition equivalence

This turns one-off runs into a durable trust graph.

## 7. Command Compilation

When trust thresholds are met:

- element-level commands are generated for single trusted actions
- workflow commands are generated for multi-step trusted paths

These commands are registered into Clawdia’s command surface and callable like any other local tool or macro.

---

## Trust Model

Trust is attached to transitions, not just elements.

That matters because an element may be visually stable but semantically ambiguous until the action outcome is repeated.

### Element Trust Inputs

- consistent detection across sessions
- stable label or icon cues
- stable bounding box relative to window or parent
- repeated successful grounding
- no conflicting sibling matches

### Edge Trust Inputs

- repeated successful activation
- expected child surface appears reliably
- rollback works reliably
- low variance in latency
- low user-correction rate

### Suggested Scoring

```text
trustScore =
  0.25 * detection_stability +
  0.20 * anchor_stability +
  0.35 * transition_success_rate +
  0.10 * rollback_reliability +
  0.10 * recency_factor
```

### Suggested Thresholds

- `< 0.40` untrusted
- `0.40 - 0.69` usable with verification on every run
- `0.70 - 0.84` trusted for command generation
- `>= 0.85` trusted and replay-optimized

Dangerous actions should require a higher threshold plus explicit allowlisting.

---

## Anchor Resolution Strategy

At execution time, the system should attempt anchors in priority order:

1. parent-relative semantic anchor
2. text/OCR anchor
3. icon/visual embedding anchor
4. window-relative coordinate
5. absolute screen coordinate

Coordinates should only be used if the current state fingerprint matches a known compatible state.

This is the core mechanism that preserves speed without making the system brittle.

---

## Validation Model

Every action must define:

- action target
- anchor strategy used
- expected postcondition
- verification evidence
- rollback if required

### Postcondition Types

- menu opened
- dialog opened
- tab switched
- selection changed
- field focused
- field value changed
- child panel became visible
- window title changed
- app returned to prior state

### Verification Methods

- OCR cue appears or disappears
- screenshot diff in expected region
- window title match
- focused element moved
- modal presence/absence
- panel content hash change

This is compatible with the existing validation process docs, but formalizes it into state transitions instead of point clicks.

---

## Recursive Crawl Policy

### Crawl Order

1. top menu bar
2. top-level toolbar
3. top-level tabs and side rails
4. safe dialogs reachable from trusted top-level controls
5. dropdown children
6. stable form fields and inspector panes

### Stop Conditions

Stop descending when:

- state depth exceeds policy max
- risk class becomes `dangerous`
- the same state fingerprint has already been trusted
- confidence is too low to pick a unique target
- rollback path is not known

### Exclusions

Never auto-probe without explicit policy:

- destructive confirmation dialogs
- purchase or account flows
- irreversible file writes
- send/publish actions
- app quit/logout/reset actions

---

## CLI Compilation

The subsystem should compile two forms of commands.

### Element Commands

Single trusted element activation.

Examples:

- `gimp.menu.file.open`
- `gimp.menu.help.open`
- `obs.controls.settings.open`

### Workflow Commands

Multi-step trusted navigation path.

Examples:

- `gimp.file.export-as --path /tmp/out.png`
- `obs.scene.create --name DemoScene`
- `inkscape.file.open --path diagram.svg`

### Command Execution Contract

A compiled command must:

1. locate the target app and current compatible state
2. replay trusted edges
3. verify the target postcondition
4. return evidence and final state id

Commands should never be raw coordinate replays without state checks.

---

## Storage And Artifacts

### Durable Store

Proposed storage area:

- `artifacts/gui-trust/<app-id>/`

Suggested files:

- `profile.json`
- `states.json`
- `elements.json`
- `edges.json`
- `commands.json`
- `runs/<timestamp>/session.json`
- `runs/<timestamp>/screens/*.png`
- `runs/<timestamp>/events.jsonl`
- `runs/<timestamp>/validation-report.md`

### Migration Support

Existing artifacts from `artifacts/app-mapping/<app>/` should be importable as seed anchors.

Mapping import behavior:

- existing `validated-map.json` points become seed `GuiElementNode` anchors
- existing validation cases become initial `GuiTrustEdge` candidates
- existing screenshots become baseline state evidence

This allows OBS and GIMP mapping work to seed the trust graph.

---

## Runtime Interfaces

### Proposed Internal APIs

```ts
async function beginGuiTrustSession(profile: GuiAppProfile): Promise<GuiTrustSession>;
async function inferElements(state: GuiStateFingerprint): Promise<GuiElementNode[]>;
async function probeElement(input: ProbeRequest): Promise<ProbeResult>;
async function crawlTrustedSurfaces(session: GuiTrustSession): Promise<CrawlReport>;
async function compileTrustedCommands(appId: string): Promise<GuiCommandSpec[]>;
async function replayGuiCommand(commandId: string, args?: Record<string, unknown>): Promise<ReplayResult>;
```

### Proposed `gui_interact` Extensions

The existing tool can remain the public action layer, but should gain higher-level actions later:

- `trust_begin_session`
- `trust_infer_elements`
- `trust_probe`
- `trust_crawl`
- `trust_compile_commands`
- `trust_replay_command`

These should remain optional wrappers over the new subsystem, not replacements for primitive actions.

---

## Interaction With Models

### Fast Model Responsibilities

- screenshot interpretation
- candidate ranking
- low-risk probe planning
- repeated verification passes
- graph merge suggestions

### Strong Model Responsibilities

- ambiguity resolution
- dangerous-action review
- command schema review
- final trust promotion decisions
- recovery strategy design

This follows the model split already used in app-mapping documents.

---

## Risk And Recovery

### Failure Classes

- `grounding_failure`
  target could not be uniquely located
- `transition_failure`
  action happened but expected surface did not appear
- `verification_failure`
  state changed ambiguously
- `rollback_failure`
  child state opened but could not be cleanly closed
- `drift_failure`
  state visually similar but anchors shifted beyond tolerance

### Recovery Tactics

- retry with alternate anchor
- retry with slower timing
- retry with double-click instead of click
- fallback to keyboard shortcut
- refocus and restore known parent state
- downgrade trust and halt descent

The subsystem should record recoveries so repeated successful recoveries can become normal execution policy for that app.

---

## Phased Implementation

## Phase A: Graph Foundations

Build:

- new `gui-trust` types
- state fingerprinting
- artifact writer
- import path from existing app maps

Success criteria:

- can create state nodes from live app screenshots
- can persist session and graph artifacts
- can seed nodes from current app-mapping artifacts

## Phase B: Synthetic Element Inference

Build:

- OCR + control segmentation merge
- role guessing
- container clustering

Success criteria:

- top-level menus, toolbar icons, tabs, dialogs, and obvious buttons are inferable from screenshots

## Phase C: Safe Probe Engine

Build:

- probe policy
- trust edge recording
- state diff verification
- rollback hooks

Success criteria:

- can validate top-level menu and tab interactions without manual remapping

## Phase D: Recursive Crawl

Build:

- breadth-first top-surface crawl
- child-state creation
- recursive descent
- stop and rollback policy

Success criteria:

- can map one app from top layer to one level of child menus and dialogs

## Phase E: Command Compiler

Build:

- command generation rules
- replay engine
- trust threshold gating

Success criteria:

- trusted commands can reopen the app, navigate to the target, and verify completion

## Phase F: Continuous Learning

Build:

- cross-session graph merge
- correction logging
- trace retrieval
- confidence updates

Success criteria:

- replay gets faster and needs less exploration on later runs

---

## Acceptance Criteria

The subsystem is ready for production use when all of the following are true for at least one hostile or tree-less app:

- top-layer elements are inferred and labeled with useful precision
- safe probes can validate top-level controls through real interactions
- at least one recursive child layer is explored and trusted
- trust scores persist across sessions
- at least five CLI commands are generated from trusted nodes/workflows
- replay uses trust graph data instead of fixed absolute coordinates alone
- failures produce explicit evidence and recovery notes

---

## Recommended First Target

Use GIMP as the first tree-less trust target.

Reason:

- rich mix of menus, icon-heavy toolbars, docks, dialogs, and panels
- partial mapping artifacts already exist under `artifacts/app-mapping/gimp/`
- enough structure to validate recursive descent
- not purely canvas-driven at the top layer

OBS should remain the reference app for migration and compatibility, but GIMP is the better stress test for no-tree visual grounding.

---

## Open Questions

- Should icon embeddings be stored locally on disk, in SQLite, or in the existing memory store?
- Should command compilation write into the existing tool registry directly or through an app-specific generated macro layer first?
- How should user corrections be surfaced in the renderer so trust can be updated explicitly after a misfire?
- Should trust promotion require N successful runs globally, or N successful runs per app version fingerprint?

---

## Recommendation

Implement this as an extension of the current desktop/app-mapping stack, not as a separate automation system.

Specifically:

- keep `guiExecutor` as the action backend
- keep `screen-map` as a low-level anchor source
- add a new `gui-trust` layer that owns inference, recursive validation, trust scoring, and command compilation
- import current OBS and GIMP mapping artifacts as initial seed data

This gives Clawdia a path from "mapped coordinates" to "trusted, replayable desktop commands" without throwing away the work already done.

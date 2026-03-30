import type { MonitorInfo } from '../screen-map-types';

export type GuiLayoutMode = 'windowed' | 'maximized' | 'fullscreen';
export type MonitorPolicy = 'follow-window' | 'lock-primary' | 'lock-discovered';
export type ProbeRiskLevel = 'safe' | 'cautious' | 'dangerous';

export interface GuiAppProfile {
    appId: string;
    displayName: string;
    windowMatchers: string[];
    baselineLayout: GuiLayoutMode;
    monitorPolicy: MonitorPolicy;
    probePolicyId: string;
    versionFingerprint?: string;
}

export interface GuiWindowContext {
    windowId?: string;
    windowTitle: string;
    appName: string;
    bounds: { x: number; y: number; width: number; height: number };
}

export interface GuiStateFingerprint {
    stateId: string;
    appId: string;
    createdAt: string;
    monitor: MonitorInfo;
    windowBounds: { x: number; y: number; width: number; height: number };
    windowTitle: string;
    screenshotPath: string;
    screenshotHash: string;
    /**
     * Phase A fallback: currently derived from file content and OCR summary.
     * Later phases can replace this with a true perceptual hash.
     */
    perceptualHash: string;
    ocrSummary: string[];
    visibleRegionHash: string[];
    activeDialog?: string;
    parentStateId?: string;
    enteredByEdgeId?: string;
}

export type GuiElementRole =
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
    | 'window'
    | 'unknown';

export interface GuiAnchorSet {
    absolute?: { x: number; y: number };
    windowRelative?: { x: number; y: number };
    parentRelative?: { x: number; y: number };
    text?: string;
    iconRef?: string;
}

export interface GuiElementNode {
    elementId: string;
    stateId: string;
    role: GuiElementRole;
    label: string | null;
    bbox: { x: number; y: number; width: number; height: number };
    center: { x: number; y: number };
    confidence: number;
    interactableScore: number;
    enabledGuess: boolean | null;
    selectedGuess: boolean | null;
    anchors: GuiAnchorSet;
    notes?: string;
    parentElementId?: string;
    parentStateId?: string;
    childSurfaceHint?: 'menu' | 'dialog' | 'panel' | 'dropdown' | 'tab';
    neighbors: string[];
    seedSource?: string;
}

export type GuiActionKind =
    | 'click'
    | 'double_click'
    | 'right_click'
    | 'hover'
    | 'focus'
    | 'type'
    | 'shortcut'
    | 'scroll';

export interface GuiTrustEdge {
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
    riskLevel: ProbeRiskLevel;
    seedSource?: string;
}

export interface GuiCommandSpec {
    commandId: string;
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

export interface GuiTrustGraph {
    appId: string;
    createdAt: string;
    updatedAt: string;
    states: GuiStateFingerprint[];
    elements: GuiElementNode[];
    edges: GuiTrustEdge[];
    commands: GuiCommandSpec[];
}

export interface GuiTrustSession {
    sessionId: string;
    app: GuiAppProfile;
    createdAt: string;
    updatedAt: string;
    monitor: MonitorInfo;
    window?: GuiWindowContext;
    baselineStateId?: string;
    artifactRoot: string;
}

export interface GuiSeedImportResult {
    appId: string;
    importedAt: string;
    sourceFiles: string[];
    graph: GuiTrustGraph;
    warnings: string[];
}

export interface GuiProbeRequest {
    state: GuiStateFingerprint;
    element: GuiElementNode;
    action?: GuiActionKind;
    expectedSurface?: GuiTrustEdge['expectedSurface'];
    postActionDelayMs?: number;
}

export interface GuiProbeResult {
    ok: boolean;
    skipped?: boolean;
    reason?: string;
    action: GuiActionKind;
    expectedSurface: GuiTrustEdge['expectedSurface'];
    riskLevel: ProbeRiskLevel;
    verify: {
        ok: boolean;
        method: GuiTrustEdge['verificationMode'];
        evidence: string[];
    };
    beforeState: GuiStateFingerprint;
    afterState?: GuiStateFingerprint;
    edge?: GuiTrustEdge;
    executorResult?: string;
}

export interface GuiCrawlOptions {
    startState: GuiStateFingerprint;
    maxDepth?: number;
    maxElementsPerState?: number;
    maxStates?: number;
}

export interface GuiCrawlReport {
    ok: boolean;
    visitedStateIds: string[];
    probedElementIds: string[];
    discoveredElementIds: string[];
    edgeIds: string[];
    skipped: Array<{ stateId: string; elementId: string; reason: string }>;
    errors: Array<{ stateId: string; elementId?: string; message: string }>;
}

export interface GuiInferenceRegion {
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

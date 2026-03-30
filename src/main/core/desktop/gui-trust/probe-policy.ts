import type {
    GuiActionKind,
    GuiElementNode,
    GuiTrustEdge,
    ProbeRiskLevel,
} from './types';

const DANGEROUS_LABEL_RE = /\b(delete|remove|overwrite|replace|quit|exit|purchase|buy|submit|send|publish|reset|clear all)\b/i;
const CAUTIOUS_LABEL_RE = /\b(close|cancel|apply|save|export|import|browse|toggle|enable|disable)\b/i;

export function classifyProbeRisk(element: GuiElementNode): ProbeRiskLevel {
    const label = element.label ?? '';
    if (DANGEROUS_LABEL_RE.test(label)) return 'dangerous';
    if (CAUTIOUS_LABEL_RE.test(label)) return 'cautious';
    if (element.role === 'dialog' || element.role === 'checkbox' || element.role === 'radio') return 'cautious';
    if (element.role === 'menu_item' || element.role === 'tab' || element.role === 'toolbar_button' || element.role === 'icon_button') {
        return 'safe';
    }
    return 'safe';
}

export function inferProbeAction(element: GuiElementNode): GuiActionKind {
    if (element.role === 'input') return 'focus';
    return 'click';
}

export function inferExpectedSurface(element: GuiElementNode): GuiTrustEdge['expectedSurface'] {
    if (element.childSurfaceHint === 'menu' || element.role === 'menu_item') return 'menu';
    if (element.childSurfaceHint === 'dialog' || element.role === 'dialog') return 'dialog';
    if (element.childSurfaceHint === 'dropdown' || element.role === 'dropdown') return 'dropdown';
    if (element.childSurfaceHint === 'tab' || element.role === 'tab') return 'tab_switch';
    return 'same_state';
}

export function resolveProbePoint(element: GuiElementNode): { x: number; y: number } | undefined {
    if (element.anchors.absolute) return element.anchors.absolute;
    if (element.center) return element.center;
    return undefined;
}

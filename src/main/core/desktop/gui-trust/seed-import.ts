import * as fs from 'fs';
import * as path from 'path';
import type { MonitorInfo } from '../screen-map-types';
import type {
    GuiElementNode,
    GuiElementRole,
    GuiSeedImportResult,
    GuiStateFingerprint,
    GuiTrustEdge,
    GuiTrustGraph,
} from './types';
import { createEmptyGuiTrustGraph } from './artifact-writer';

type LooseRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LooseRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readJsonIfExists(filePath: string): unknown | undefined {
    if (!fs.existsSync(filePath)) return undefined;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function nowIso(): string {
    return new Date().toISOString();
}

function roleFromType(raw: unknown): GuiElementRole {
    const type = typeof raw === 'string' ? raw.toLowerCase() : '';
    if (type.includes('menu')) return 'menu_item';
    if (type.includes('tab')) return 'tab';
    if (type.includes('dropdown')) return 'dropdown';
    if (type.includes('toolbar')) return 'toolbar_button';
    if (type.includes('button')) return 'button';
    if (type.includes('list item')) return 'list_item';
    if (type.includes('list')) return 'list';
    if (type.includes('panel')) return 'panel';
    if (type.includes('dialog')) return 'dialog';
    if (type.includes('input') || type.includes('text')) return 'input';
    return 'unknown';
}

function synthMonitor(bounds?: { x: number; y: number; width: number; height: number }): MonitorInfo {
    return {
        name: 'imported-monitor',
        width: bounds?.width ?? 0,
        height: bounds?.height ?? 0,
        originX: bounds?.x ?? 0,
        originY: bounds?.y ?? 0,
    };
}

function makeState(appId: string, screenshotPath: string | undefined, bounds?: { x: number; y: number; width: number; height: number }, title?: string): GuiStateFingerprint {
    const ts = nowIso();
    return {
        stateId: `seed-state-${appId}`,
        appId,
        createdAt: ts,
        monitor: synthMonitor(bounds),
        windowBounds: bounds ?? { x: 0, y: 0, width: 0, height: 0 },
        windowTitle: title ?? appId,
        screenshotPath: screenshotPath ?? '',
        screenshotHash: '',
        perceptualHash: '',
        ocrSummary: [],
        visibleRegionHash: [],
    };
}

function pushElement(graph: GuiTrustGraph, element: GuiElementNode): void {
    if (!graph.elements.some((existing) => existing.elementId === element.elementId)) {
        graph.elements.push(element);
    }
}

function pushEdge(graph: GuiTrustGraph, edge: GuiTrustEdge): void {
    if (!graph.edges.some((existing) => existing.edgeId === edge.edgeId)) {
        graph.edges.push(edge);
    }
}

function importScreenMapPoints(
    graph: GuiTrustGraph,
    appId: string,
    data: unknown,
    filePath: string,
    warnings: string[],
): void {
    if (!isRecord(data) || !Array.isArray(data.points)) return;
    const firstPoint = data.points.find((point) => isRecord(point)) as LooseRecord | undefined;
    const firstWindowContext = isRecord(firstPoint?.windowContext) ? firstPoint.windowContext as LooseRecord : undefined;
    const windowAppName = typeof firstWindowContext?.appName === 'string' ? firstWindowContext.appName.toLowerCase() : '';
    const windowTitle = typeof firstWindowContext?.windowTitle === 'string' ? firstWindowContext.windowTitle.toLowerCase() : '';
    const appIdLower = appId.toLowerCase();

    if (windowAppName && windowAppName !== appIdLower && !windowTitle.includes(appIdLower)) {
        warnings.push(`Skipped ${path.basename(filePath)} because window context points at "${windowAppName}" / "${windowTitle}" instead of "${appIdLower}"`);
        return;
    }

    const bounds = isRecord(data.points[0]?.windowContext) && isRecord(data.points[0].windowContext.bounds)
        ? {
            x: Number((data.points[0].windowContext.bounds as LooseRecord).x ?? 0),
            y: Number((data.points[0].windowContext.bounds as LooseRecord).y ?? 0),
            width: Number((data.points[0].windowContext.bounds as LooseRecord).width ?? 0),
            height: Number((data.points[0].windowContext.bounds as LooseRecord).height ?? 0),
        }
        : undefined;
    const state = makeState(appId, typeof data.baselineScreenshot === 'string' ? data.baselineScreenshot : undefined, bounds, typeof data.description === 'string' ? data.description : appId);
    if (!graph.states.some((existing) => existing.stateId === state.stateId)) {
        graph.states.push(state);
    }

    for (const point of data.points) {
        if (!isRecord(point)) continue;
        const x = Number(point.x ?? 0);
        const y = Number(point.y ?? 0);
        const label = typeof point.label === 'string' ? point.label : null;
        if (!label) {
            warnings.push(`Skipped screen-map point without label in ${filePath}`);
            continue;
        }
        const relativeX = typeof point.relativeX === 'number' ? point.relativeX : x - (bounds?.x ?? 0);
        const relativeY = typeof point.relativeY === 'number' ? point.relativeY : y - (bounds?.y ?? 0);
        pushElement(graph, {
            elementId: `seed:${appId}:${label}`,
            stateId: state.stateId,
            role: label.startsWith('menu_') ? 'menu_item' : 'unknown',
            label,
            bbox: { x, y, width: 1, height: 1 },
            center: { x, y },
            confidence: 0.6,
            interactableScore: 0.8,
            enabledGuess: true,
            selectedGuess: null,
            anchors: {
                absolute: { x, y },
                windowRelative: { x: relativeX, y: relativeY },
                text: label,
            },
            notes: typeof point.notes === 'string' ? point.notes : `Imported from ${path.basename(filePath)}`,
            neighbors: [],
            seedSource: filePath,
        });
    }
}

function importValidatedMapSections(
    graph: GuiTrustGraph,
    appId: string,
    data: unknown,
    filePath: string,
): void {
    if (!isRecord(data) || !isRecord(data.sections)) return;
    const bounds = isRecord(data.window_bounds)
        ? {
            x: Number(data.window_bounds.x ?? 0),
            y: Number(data.window_bounds.y ?? 0),
            width: Number(data.window_bounds.width ?? 0),
            height: Number(data.window_bounds.height ?? 0),
        }
        : undefined;
    const state = makeState(appId, undefined, bounds, typeof data.app_name === 'string' ? data.app_name : appId);
    if (!graph.states.some((existing) => existing.stateId === state.stateId)) {
        graph.states.push(state);
    }

    for (const [sectionName, sectionValue] of Object.entries(data.sections)) {
        if (!isRecord(sectionValue) || !Array.isArray(sectionValue.elements)) continue;
        for (const rawElement of sectionValue.elements) {
            if (!isRecord(rawElement)) continue;
            const label = typeof rawElement.label === 'string' ? rawElement.label : null;
            const elementId = typeof rawElement.id === 'string'
                ? rawElement.id
                : `${sectionName}:${label ?? 'unknown'}`;
            const x = Number(rawElement.center_x ?? rawElement.x ?? 0);
            const y = Number(rawElement.center_y ?? rawElement.y ?? 0);
            const width = Number(rawElement.w ?? 1);
            const height = Number(rawElement.h ?? 1);
            const validationResult = typeof rawElement.validation_result === 'string'
                ? rawElement.validation_result.toUpperCase()
                : undefined;

            pushElement(graph, {
                elementId: `seed:${appId}:${elementId}`,
                stateId: state.stateId,
                role: roleFromType(rawElement.type),
                label,
                bbox: { x: Number(rawElement.x ?? x), y: Number(rawElement.y ?? y), width, height },
                center: { x, y },
                confidence: Number(rawElement.confidence ?? 0.75),
                interactableScore: 0.8,
                enabledGuess: validationResult === 'FAIL' ? null : true,
                selectedGuess: null,
                anchors: {
                    absolute: { x, y },
                    windowRelative: bounds ? { x: x - bounds.x, y: y - bounds.y } : undefined,
                    text: label ?? undefined,
                },
                parentElementId: `seed:${appId}:section:${sectionName}`,
                notes: typeof rawElement.note === 'string' ? rawElement.note : undefined,
                neighbors: [],
                seedSource: filePath,
            });

            if (validationResult === 'PASS') {
                pushEdge(graph, {
                    edgeId: `seed-edge:${appId}:${elementId}`,
                    sourceStateId: state.stateId,
                    sourceElementId: `seed:${appId}:${elementId}`,
                    action: 'click',
                    expectedSurface: roleFromType(rawElement.type) === 'menu_item' ? 'menu' : 'unknown',
                    verificationMode: 'manual',
                    successCount: 1,
                    failureCount: 0,
                    trustScore: 0.7,
                    riskLevel: 'safe',
                    notes: typeof rawElement.note === 'string' ? rawElement.note : undefined,
                    seedSource: filePath,
                });
            }
        }
    }
}

function importSectionChildren(
    graph: GuiTrustGraph,
    appId: string,
    state: GuiStateFingerprint,
    parentId: string,
    children: LooseRecord,
    filePath: string,
): void {
    for (const [childKey, childValue] of Object.entries(children)) {
        if (!isRecord(childValue)) continue;
        const label = typeof childValue.label === 'string' ? childValue.label : childKey;
        const x = Number(childValue.center_x ?? childValue.x ?? 0);
        const y = Number(childValue.center_y ?? childValue.y ?? 0);
        pushElement(graph, {
            elementId: `seed:${appId}:${parentId}:${childKey}`,
            stateId: state.stateId,
            role: roleFromType(childValue.type ?? childKey),
            label,
            bbox: {
                x: Number(childValue.x ?? x),
                y: Number(childValue.y ?? y),
                width: Number(childValue.w ?? 1),
                height: Number(childValue.h ?? 1),
            },
            center: { x, y },
            confidence: Number(childValue.confidence ?? 0.75),
            interactableScore: 0.8,
            enabledGuess: true,
            selectedGuess: null,
            anchors: {
                absolute: { x, y },
                text: label,
            },
            parentElementId: `seed:${appId}:${parentId}`,
            neighbors: [],
            seedSource: filePath,
        });
    }
}

function importAppMapSections(
    graph: GuiTrustGraph,
    appId: string,
    data: unknown,
    filePath: string,
): void {
    if (!isRecord(data) || !isRecord(data.sections)) return;
    const geometry = isRecord(data.window_geometry)
        ? {
            x: Number(data.window_geometry.x ?? 0),
            y: Number(data.window_geometry.y ?? 0),
            width: Number(data.window_geometry.w ?? 0),
            height: Number(data.window_geometry.h ?? 0),
        }
        : undefined;
    const state = makeState(appId, undefined, geometry, typeof data.window_title === 'string' ? data.window_title : appId);
    if (!graph.states.some((existing) => existing.stateId === state.stateId)) {
        graph.states.push(state);
    }

    for (const [sectionName, sectionValue] of Object.entries(data.sections)) {
        if (!isRecord(sectionValue)) continue;
        const elementId = `seed:${appId}:${sectionName}`;
        const x = Number(sectionValue.center_x ?? sectionValue.x ?? 0);
        const y = Number(sectionValue.center_y ?? sectionValue.y ?? 0);
        pushElement(graph, {
            elementId,
            stateId: state.stateId,
            role: 'panel',
            label: typeof sectionValue.label === 'string' ? sectionValue.label : sectionName,
            bbox: {
                x: Number(sectionValue.x ?? x),
                y: Number(sectionValue.y ?? y),
                width: Number(sectionValue.w ?? 1),
                height: Number(sectionValue.h ?? 1),
            },
            center: { x, y },
            confidence: Number(sectionValue.confidence ?? 0.75),
            interactableScore: 0.5,
            enabledGuess: true,
            selectedGuess: null,
            anchors: {
                absolute: { x, y },
                text: typeof sectionValue.label === 'string' ? sectionValue.label : sectionName,
            },
            neighbors: [],
            seedSource: filePath,
        });

        if (isRecord(sectionValue.children)) {
            importSectionChildren(graph, appId, state, sectionName, sectionValue.children, filePath);
        }
    }
}

export function importGuiTrustSeedFromAppArtifacts(
    appId: string,
    opts: { artifactRoot?: string } = {},
): GuiSeedImportResult {
    const artifactRoot = opts.artifactRoot ?? path.join(process.cwd(), 'artifacts', 'app-mapping', appId);
    const sourceFiles = [
        path.join(artifactRoot, `${appId}-map.smap.json`),
        path.join(artifactRoot, 'validated-map.json'),
        path.join(artifactRoot, 'app-map.json'),
    ].filter((filePath) => fs.existsSync(filePath));
    const warnings: string[] = [];
    const graph = createEmptyGuiTrustGraph(appId);

    for (const filePath of sourceFiles) {
        const data = readJsonIfExists(filePath);
        importScreenMapPoints(graph, appId, data, filePath, warnings);
        importValidatedMapSections(graph, appId, data, filePath);
        importAppMapSections(graph, appId, data, filePath);
    }

    graph.updatedAt = nowIso();

    return {
        appId,
        importedAt: nowIso(),
        sourceFiles,
        graph,
        warnings,
    };
}

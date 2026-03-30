import { executeGuiInteract } from '../guiExecutor';
import { appendStateToGraph } from './artifact-writer';
import { getChildInferenceRegion, getRootInferenceRegions } from './app-zones';
import { inferGuiElements } from './element-inference';
import { probeGuiElement } from './probe-engine';
import { classifyProbeRisk } from './probe-policy';
import type {
    GuiCrawlOptions,
    GuiCrawlReport,
    GuiElementNode,
    GuiStateFingerprint,
    GuiTrustGraph,
    GuiTrustSession,
} from './types';

interface CrawlQueueItem {
    state: GuiStateFingerprint;
    depth: number;
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items) {
        const key = getKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

function getElementsForState(graph: GuiTrustGraph, stateId: string): GuiElementNode[] {
    return graph.elements.filter((element) => element.stateId === stateId);
}

function inferAndStoreElements(
    graph: GuiTrustGraph,
    state: GuiStateFingerprint,
    inferred: GuiElementNode[],
): GuiElementNode[] {
    const existing = getElementsForState(graph, state.stateId);
    const merged = uniqueBy([...existing, ...inferred], (element) => element.elementId);

    graph.elements = graph.elements.filter((element) => element.stateId !== state.stateId);
    graph.elements.push(...merged);
    graph.updatedAt = new Date().toISOString();
    return merged;
}

function shouldDescendFromExpectedSurface(expectedSurface: string): boolean {
    return expectedSurface === 'menu' || expectedSurface === 'dialog' || expectedSurface === 'dropdown' || expectedSurface === 'tab_switch';
}

async function inferStateElementsForContext(
    graph: GuiTrustGraph,
    state: GuiStateFingerprint,
    appId: string,
    opts: {
        root?: boolean;
        sourceElement?: GuiElementNode;
        expectedSurface?: 'menu' | 'dialog' | 'dropdown' | 'tab_switch' | 'same_state' | 'unknown';
    } = {},
): Promise<GuiElementNode[]> {
    if (opts.root) {
        const regions = getRootInferenceRegions(appId, state);
        const regionElements: GuiElementNode[] = [];
        for (const region of regions) {
            const elements = await inferGuiElements(state, { seedGraph: graph, region });
            regionElements.push(...elements);
        }
        return uniqueBy(regionElements, (element) => element.elementId);
    }

    const childRegion = opts.sourceElement && opts.expectedSurface
        ? getChildInferenceRegion(appId, state, opts.sourceElement, opts.expectedSurface)
        : undefined;
    return inferGuiElements(state, { seedGraph: graph, region: childRegion });
}

export async function crawlTrustedSurfaces(
    session: GuiTrustSession,
    graph: GuiTrustGraph,
    opts: GuiCrawlOptions,
): Promise<GuiCrawlReport> {
    const maxDepth = opts.maxDepth ?? 1;
    const maxElementsPerState = opts.maxElementsPerState ?? 12;
    const maxStates = opts.maxStates ?? 8;
    const report: GuiCrawlReport = {
        ok: true,
        visitedStateIds: [],
        probedElementIds: [],
        discoveredElementIds: [],
        edgeIds: [],
        skipped: [],
        errors: [],
    };
    const visitedStates = new Set<string>();

    appendStateToGraph(graph, opts.startState);

    async function closeTransientSurface(): Promise<void> {
        await executeGuiInteract({
            action: 'key',
            text: 'Escape',
            window: session.window?.windowTitle,
            verify: false,
        });
    }

    async function crawlState(current: CrawlQueueItem): Promise<void> {
        const visitKey = `${current.depth}:${current.state.perceptualHash || current.state.stateId}`;
        if (visitedStates.has(visitKey)) return;
        if (report.visitedStateIds.length >= maxStates) {
            report.skipped.push({
                stateId: current.state.stateId,
                elementId: '__state_budget__',
                reason: `Reached maxStates=${maxStates}`,
            });
            return;
        }

        visitedStates.add(visitKey);
        report.visitedStateIds.push(current.state.stateId);

        let stateElements = getElementsForState(graph, current.state.stateId);
        if (stateElements.length === 0) {
            const inferred = await inferStateElementsForContext(graph, current.state, session.app.appId, {
                root: current.depth === 0,
            });
            stateElements = inferAndStoreElements(graph, current.state, inferred);
            report.discoveredElementIds.push(...inferred.map((element) => element.elementId));
        }

        const candidates = stateElements
            .filter((element) => classifyProbeRisk(element) === 'safe')
            .slice(0, maxElementsPerState);

        for (const element of candidates) {
            const probe = await probeGuiElement(session, graph, {
                state: current.state,
                element,
            });
            report.probedElementIds.push(element.elementId);

            if (probe.edge?.edgeId) {
                report.edgeIds.push(probe.edge.edgeId);
            }

            if (probe.skipped) {
                report.skipped.push({
                    stateId: current.state.stateId,
                    elementId: element.elementId,
                    reason: probe.reason ?? 'skipped',
                });
                continue;
            }

            if (!probe.ok || !probe.afterState) {
                report.errors.push({
                    stateId: current.state.stateId,
                    elementId: element.elementId,
                    message: probe.reason ?? (probe.verify.evidence.join(' | ') || 'probe failed'),
                });
                report.ok = false;
                continue;
            }

            const childElements = await inferStateElementsForContext(graph, probe.afterState, session.app.appId, {
                sourceElement: element,
                expectedSurface: probe.expectedSurface,
            });
            inferAndStoreElements(graph, probe.afterState, childElements);
            report.discoveredElementIds.push(...childElements.map((candidate) => candidate.elementId));

            if (current.depth < maxDepth && shouldDescendFromExpectedSurface(probe.expectedSurface)) {
                await crawlState({ state: probe.afterState, depth: current.depth + 1 });
                await closeTransientSurface();
            }
        }
    }

    await crawlState({ state: opts.startState, depth: 0 });

    report.discoveredElementIds = uniqueBy(
        report.discoveredElementIds.map((elementId) => ({ elementId })),
        (item) => item.elementId,
    ).map((item) => item.elementId);

    report.probedElementIds = uniqueBy(
        report.probedElementIds.map((elementId) => ({ elementId })),
        (item) => item.elementId,
    ).map((item) => item.elementId);

    report.edgeIds = uniqueBy(
        report.edgeIds.map((edgeId) => ({ edgeId })),
        (item) => item.edgeId,
    ).map((item) => item.edgeId);

    return report;
}

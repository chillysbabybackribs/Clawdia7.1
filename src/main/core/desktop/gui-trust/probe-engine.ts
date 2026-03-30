import { executeGuiInteract } from '../guiExecutor';
import { wait } from '../shared';
import { appendStateToGraph } from './artifact-writer';
import { captureGuiStateFingerprint } from './state-fingerprint';
import type {
    GuiProbeRequest,
    GuiProbeResult,
    GuiTrustEdge,
    GuiTrustGraph,
    GuiTrustSession,
} from './types';
import {
    classifyProbeRisk,
    inferExpectedSurface,
    inferProbeAction,
    resolveProbePoint,
} from './probe-policy';

let edgeCounter = 0;

function nextEdgeId(): string {
    edgeCounter += 1;
    return `gtrust-edge-${Date.now()}-${edgeCounter}`;
}

function arraysEqual(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function verifyStateTransition(
    beforeState: GuiProbeRequest['state'],
    afterState: GuiProbeRequest['state'],
    expectedSurface: GuiTrustEdge['expectedSurface'],
    elementLabel?: string | null,
): {
    ok: boolean;
    method: GuiTrustEdge['verificationMode'];
    evidence: string[];
} {
    const evidence: string[] = [];
    const hashChanged = beforeState.perceptualHash !== afterState.perceptualHash;
    const ocrChanged = !arraysEqual(beforeState.ocrSummary, afterState.ocrSummary);
    const visibleHashChanged = !arraysEqual(beforeState.visibleRegionHash, afterState.visibleRegionHash);
    const lowerLabel = elementLabel?.toLowerCase() ?? '';
    const labelVisibleAfter = lowerLabel
        ? afterState.ocrSummary.some((line) => line.toLowerCase().includes(lowerLabel))
        : false;

    if (hashChanged) evidence.push('perceptual hash changed');
    if (ocrChanged) evidence.push('ocr summary changed');
    if (visibleHashChanged) evidence.push('visible region hash changed');
    if (labelVisibleAfter) evidence.push(`label visible after action: ${elementLabel}`);

    if (expectedSurface === 'same_state') {
        const ok = hashChanged || ocrChanged || visibleHashChanged;
        return { ok, method: 'state_diff', evidence: ok ? evidence : ['no observable change detected'] };
    }

    if (expectedSurface === 'menu' || expectedSurface === 'dropdown' || expectedSurface === 'dialog' || expectedSurface === 'tab_switch') {
        const ok = hashChanged || ocrChanged || visibleHashChanged || labelVisibleAfter;
        return { ok, method: labelVisibleAfter ? 'ocr' : 'state_diff', evidence: ok ? evidence : ['expected child surface did not appear'] };
    }

    return {
        ok: hashChanged || ocrChanged,
        method: 'state_diff',
        evidence: evidence.length ? evidence : ['unknown transition type'],
    };
}

export async function probeGuiElement(
    session: GuiTrustSession,
    graph: GuiTrustGraph,
    request: GuiProbeRequest,
): Promise<GuiProbeResult> {
    const action = request.action ?? inferProbeAction(request.element);
    const expectedSurface = request.expectedSurface ?? inferExpectedSurface(request.element);
    const riskLevel = classifyProbeRisk(request.element);

    if (riskLevel !== 'safe') {
        return {
            ok: false,
            skipped: true,
            reason: `Probe skipped for ${riskLevel} element`,
            action,
            expectedSurface,
            riskLevel,
            verify: { ok: false, method: 'manual', evidence: ['risk policy rejected automatic probe'] },
            beforeState: request.state,
        };
    }

    const point = resolveProbePoint(request.element);
    if (!point) {
        return {
            ok: false,
            reason: 'No probe point available for element',
            action,
            expectedSurface,
            riskLevel,
            verify: { ok: false, method: 'manual', evidence: ['missing anchor'] },
            beforeState: request.state,
        };
    }

    const executorInput: Record<string, unknown> = {
        action,
        x: point.x,
        y: point.y,
        window: session.window?.windowTitle,
        verify: false,
    };

    const executorResult = await executeGuiInteract(executorInput);
    if (executorResult.startsWith('[Error]')) {
        return {
            ok: false,
            reason: executorResult,
            action,
            expectedSurface,
            riskLevel,
            verify: { ok: false, method: 'manual', evidence: ['executor returned error'] },
            beforeState: request.state,
            executorResult,
        };
    }

    await wait(request.postActionDelayMs ?? 250);
    const afterState = await captureGuiStateFingerprint(session, {
        parentStateId: request.state.stateId,
    });
    appendStateToGraph(graph, afterState);

    const verify = verifyStateTransition(request.state, afterState, expectedSurface, request.element.label);
    const edge: GuiTrustEdge = {
        edgeId: nextEdgeId(),
        sourceStateId: request.state.stateId,
        sourceElementId: request.element.elementId,
        action,
        expectedSurface,
        targetStateId: verify.ok ? afterState.stateId : undefined,
        verificationMode: verify.method,
        successCount: verify.ok ? 1 : 0,
        failureCount: verify.ok ? 0 : 1,
        trustScore: verify.ok ? 0.6 : 0.15,
        lastVerifiedAt: new Date().toISOString(),
        notes: verify.evidence.join(' | '),
        riskLevel,
    };

    graph.edges.push(edge);
    graph.updatedAt = new Date().toISOString();

    return {
        ok: verify.ok,
        action,
        expectedSurface,
        riskLevel,
        verify,
        beforeState: request.state,
        afterState,
        edge,
        executorResult,
    };
}

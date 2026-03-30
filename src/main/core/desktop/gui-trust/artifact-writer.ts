import * as fs from 'fs';
import * as path from 'path';
import type {
    GuiSeedImportResult,
    GuiStateFingerprint,
    GuiTrustGraph,
    GuiTrustSession,
} from './types';
import { getSessionRunDir } from './state-fingerprint';

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath: string, value: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function createEmptyGuiTrustGraph(appId: string): GuiTrustGraph {
    const now = new Date().toISOString();
    return {
        appId,
        createdAt: now,
        updatedAt: now,
        states: [],
        elements: [],
        edges: [],
        commands: [],
    };
}

export function appendStateToGraph(graph: GuiTrustGraph, state: GuiStateFingerprint): GuiTrustGraph {
    const exists = graph.states.some((existing) => existing.stateId === state.stateId);
    if (!exists) {
        graph.states.push(state);
        graph.updatedAt = new Date().toISOString();
    }
    return graph;
}

export function writeGuiTrustSessionArtifacts(
    session: GuiTrustSession,
    graph: GuiTrustGraph,
    opts: { notes?: string[] } = {},
): {
    sessionPath: string;
    graphPath: string;
    stateIndexPath: string;
    notesPath?: string;
    runDir: string;
} {
    const runDir = getSessionRunDir(session);
    const notes = opts.notes ?? [];
    const sessionPath = path.join(runDir, 'session.json');
    const graphPath = path.join(session.artifactRoot, 'graph.json');
    const stateIndexPath = path.join(session.artifactRoot, 'states.json');
    const notesPath = notes.length ? path.join(runDir, 'notes.md') : undefined;

    writeJson(sessionPath, session);
    writeJson(graphPath, graph);
    writeJson(stateIndexPath, graph.states);

    if (notesPath) {
        ensureDir(path.dirname(notesPath));
        fs.writeFileSync(notesPath, `${notes.join('\n')}\n`, 'utf8');
    }

    return { sessionPath, graphPath, stateIndexPath, notesPath, runDir };
}

export function writeGuiSeedImportArtifacts(
    result: GuiSeedImportResult,
    artifactRoot: string,
): {
    importReportPath: string;
    graphPath: string;
    elementsPath: string;
    edgesPath: string;
} {
    const importReportPath = path.join(artifactRoot, 'seed-import.json');
    const graphPath = path.join(artifactRoot, 'graph.json');
    const elementsPath = path.join(artifactRoot, 'elements.json');
    const edgesPath = path.join(artifactRoot, 'edges.json');

    writeJson(importReportPath, result);
    writeJson(graphPath, result.graph);
    writeJson(elementsPath, result.graph.elements);
    writeJson(edgesPath, result.graph.edges);

    return { importReportPath, graphPath, elementsPath, edgesPath };
}

import * as fs from 'fs';
import * as path from 'path';

export interface TrustedAnchor {
    id: string;
    appId: string;
    label: string;
    role: string;
    targetDescription: string;
    sectionLabel?: string;
    sectionBounds?: { x: number; y: number; width: number; height: number };
    x: number;
    y: number;
    confidence: number;
    windowTitle: string;
    windowBounds: { x: number; y: number; width: number; height: number };
    screenshotPath: string;
    trustedAt: string;
    source: 'hybrid-mapper';
    notes?: string;
}

export function getTrustedAnchorsPath(appId: string): string {
    return path.join(process.cwd(), 'artifacts', 'hybrid-mapping', appId, 'trusted-anchors.json');
}

export function loadTrustedAnchors(appId: string): TrustedAnchor[] {
    const filePath = getTrustedAnchorsPath(appId);
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as TrustedAnchor[];
}

export function saveTrustedAnchors(appId: string, anchors: TrustedAnchor[]): string {
    const filePath = getTrustedAnchorsPath(appId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(anchors, null, 2)}\n`, 'utf8');
    return filePath;
}

export function upsertTrustedAnchor(anchor: TrustedAnchor): { anchors: TrustedAnchor[]; filePath: string } {
    const anchors = loadTrustedAnchors(anchor.appId);
    const existingIndex = anchors.findIndex((candidate) => candidate.label === anchor.label);
    if (existingIndex >= 0) {
        anchors[existingIndex] = anchor;
    } else {
        anchors.push(anchor);
    }
    const filePath = saveTrustedAnchors(anchor.appId, anchors);
    return { anchors, filePath };
}

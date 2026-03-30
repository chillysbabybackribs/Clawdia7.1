import type { OcrResult } from '../screenshot';
import { runOcr } from '../screenshot';
import type {
    GuiElementNode,
    GuiInferenceRegion,
    GuiElementRole,
    GuiStateFingerprint,
    GuiTrustGraph,
} from './types';

interface OcrWord {
    label: string;
    x: number;
    y: number;
    bbox: { x: number; y: number; width: number; height: number };
}

interface PhraseCandidate {
    label: string;
    bbox: { x: number; y: number; width: number; height: number };
    center: { x: number; y: number };
    lineIndex: number;
}

const KNOWN_MENU_WORDS = new Set([
    'file',
    'edit',
    'select',
    'view',
    'image',
    'layer',
    'colors',
    'tools',
    'filters',
    'windows',
    'help',
    'scene',
    'docks',
    'profile',
    'collection',
]);

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'item';
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

function intersectsRegion(
    bbox: { x: number; y: number; width: number; height: number },
    region?: GuiInferenceRegion,
): boolean {
    if (!region) return true;
    const bboxRight = bbox.x + bbox.width;
    const bboxBottom = bbox.y + bbox.height;
    const regionRight = region.x + region.width;
    const regionBottom = region.y + region.height;
    return bbox.x < regionRight && bboxRight > region.x && bbox.y < regionBottom && bboxBottom > region.y;
}

function alphaRatio(value: string): number {
    const chars = value.replace(/\s+/g, '');
    if (!chars.length) return 0;
    const alphaChars = chars.replace(/[^a-z]/gi, '');
    return alphaChars.length / chars.length;
}

function clusterWordsIntoLines(words: OcrWord[]): OcrWord[][] {
    const sorted = [...words].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
    const lines: OcrWord[][] = [];
    const verticalThreshold = 16;

    for (const word of sorted) {
        const line = lines.find((candidate) => Math.abs(candidate[0].bbox.y - word.bbox.y) <= verticalThreshold);
        if (line) {
            line.push(word);
        } else {
            lines.push([word]);
        }
    }

    for (const line of lines) {
        line.sort((a, b) => a.bbox.x - b.bbox.x);
    }

    return lines;
}

function mergeLineIntoPhrases(line: OcrWord[], lineIndex: number): PhraseCandidate[] {
    if (line.length === 0) return [];

    const phrases: PhraseCandidate[] = [];
    let currentWords: OcrWord[] = [line[0]];

    const flush = () => {
        if (currentWords.length === 0) return;
        const minX = Math.min(...currentWords.map((word) => word.bbox.x));
        const minY = Math.min(...currentWords.map((word) => word.bbox.y));
        const maxX = Math.max(...currentWords.map((word) => word.bbox.x + word.bbox.width));
        const maxY = Math.max(...currentWords.map((word) => word.bbox.y + word.bbox.height));
        const label = currentWords.map((word) => word.label).join(' ').trim();
        phrases.push({
            label,
            bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
            center: { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) },
            lineIndex,
        });
        currentWords = [];
    };

    for (let i = 1; i < line.length; i++) {
        const prev = line[i - 1];
        const word = line[i];
        const gap = word.bbox.x - (prev.bbox.x + prev.bbox.width);
        const dynamicGapThreshold = Math.min(18, Math.max(8, Math.round(Math.max(prev.bbox.height, word.bbox.height) * 0.5)));
        if (gap <= dynamicGapThreshold) {
            currentWords.push(word);
        } else {
            flush();
            currentWords = [word];
        }
    }
    flush();

    return phrases;
}

function classifyPhraseRole(
    phrase: PhraseCandidate,
    state: GuiStateFingerprint,
    lineSize: number,
): GuiElementRole {
    const windowTop = state.windowBounds.y;
    const relativeY = phrase.bbox.y - windowTop;
    const topBandLimit = Math.max(90, Math.round(state.windowBounds.height * 0.12));
    const lowerTopBandLimit = Math.max(150, Math.round(state.windowBounds.height * 0.20));
    const text = phrase.label.toLowerCase();

    if (relativeY <= 42 && phrase.bbox.width >= 120) {
        return 'unknown';
    }
    if (relativeY <= Math.max(42, Math.round(state.windowBounds.height * 0.06)) && phrase.bbox.width > 320) {
        return 'unknown';
    }
    if (relativeY <= topBandLimit && lineSize >= 4 && phrase.bbox.width <= 180 && phrase.label.split(/\s+/).length <= 3) {
        return 'menu_item';
    }
    if (relativeY <= lowerTopBandLimit && lineSize >= 3 && /(home|settings|layers|channels|paths|history|tool|help|window|view|edit|file)/.test(text)) {
        return 'tab';
    }
    if (/\b(ok|open|cancel|save|apply|close|import|export|browse|search|next|back|finish)\b/.test(text)) {
        return 'button';
    }
    if (/\b(opacity|mode|width|height|name|path|search|size)\b/.test(text)) {
        return 'input';
    }
    if (/\b(menu|file|edit|view|image|layer|colors|tools|filters|windows|help)\b/.test(text)) {
        return 'menu_item';
    }
    return 'unknown';
}

function isLikelyMenuLine(line: OcrWord[], state: GuiStateFingerprint): boolean {
    if (line.length < 4) return false;
    const relativeY = line[0].bbox.y - state.windowBounds.y;
    if (relativeY > Math.max(110, Math.round(state.windowBounds.height * 0.12))) return false;
    const knownCount = line.filter((word) => KNOWN_MENU_WORDS.has(word.label.toLowerCase())).length;
    return knownCount >= Math.max(4, Math.floor(line.length * 0.6));
}

function wordToElement(word: OcrWord, state: GuiStateFingerprint, role: GuiElementRole, note: string): GuiElementNode {
    return {
        elementId: `ocr:${state.stateId}:${slugify(word.label)}:${word.x}:${word.y}`,
        stateId: state.stateId,
        role,
        label: word.label,
        bbox: word.bbox,
        center: { x: word.x, y: word.y },
        confidence: role === 'unknown' ? 0.55 : 0.84,
        interactableScore: role === 'unknown' ? 0.45 : 0.85,
        enabledGuess: true,
        selectedGuess: null,
        anchors: {
            absolute: { x: word.x, y: word.y },
            windowRelative: {
                x: word.x - state.windowBounds.x,
                y: word.y - state.windowBounds.y,
            },
            text: word.label,
        },
        neighbors: [],
        notes: note,
    };
}

function phraseToElement(
    phrase: PhraseCandidate,
    state: GuiStateFingerprint,
    role: GuiElementRole,
): GuiElementNode {
    return {
        elementId: `ocr:${state.stateId}:${slugify(phrase.label)}:${phrase.center.x}:${phrase.center.y}`,
        stateId: state.stateId,
        role,
        label: phrase.label,
        bbox: phrase.bbox,
        center: phrase.center,
        confidence: role === 'unknown' ? 0.55 : 0.8,
        interactableScore: role === 'unknown' ? 0.45 : 0.8,
        enabledGuess: true,
        selectedGuess: null,
        anchors: {
            absolute: phrase.center,
            windowRelative: {
                x: phrase.center.x - state.windowBounds.x,
                y: phrase.center.y - state.windowBounds.y,
            },
            text: phrase.label,
        },
        neighbors: [],
        notes: `OCR phrase candidate from line ${phrase.lineIndex}`,
    };
}

function inferFromOcr(ocr: OcrResult, state: GuiStateFingerprint): GuiElementNode[] {
    return inferFromOcrInRegion(ocr, state);
}

function inferFromOcrInRegion(ocr: OcrResult, state: GuiStateFingerprint, region?: GuiInferenceRegion): GuiElementNode[] {
    const words = (ocr.words ?? [])
        .filter((word): word is OcrWord => !!word?.label && !!word.bbox)
        .filter((word) => intersectsRegion(word.bbox, region));
    const lines = clusterWordsIntoLines(words);
    const elements: GuiElementNode[] = [];

    lines.forEach((line, lineIndex) => {
        if (isLikelyMenuLine(line, state)) {
            for (const word of line) {
                elements.push(wordToElement(word, state, 'menu_item', `OCR menu word from line ${lineIndex}`));
            }
            return;
        }
        const phrases = mergeLineIntoPhrases(line, lineIndex);
        for (const phrase of phrases) {
            if (phrase.label.length < 2) continue;
            const role = classifyPhraseRole(phrase, state, phrases.length);
            elements.push(phraseToElement(phrase, state, role));
        }
    });

    return uniqueBy(elements, (element) => `${element.label}:${element.center.x}:${element.center.y}`);
}

function projectSeedElements(
    state: GuiStateFingerprint,
    seedGraph?: GuiTrustGraph,
    region?: GuiInferenceRegion,
): GuiElementNode[] {
    if (!seedGraph) return [];

    return seedGraph.elements
        .filter((element) => {
            const label = element.label ?? '';
            if (!label && !element.anchors.windowRelative && !element.anchors.absolute) return false;
            if (!['menu_item', 'tab', 'button', 'toolbar_button', 'icon_button'].includes(element.role)) return false;
            if (label.length > 40) return false;
            if (label.includes('desktop/clawdia7.0')) return false;
            if (element.role === 'menu_item' && !label.startsWith('menu_') && alphaRatio(label) < 0.7) return false;
            return true;
        })
        .map((element) => {
            const seedState = seedGraph.states.find((candidate) => candidate.stateId === element.stateId);
            const center = element.anchors.windowRelative
                ? {
                    x: state.windowBounds.x + element.anchors.windowRelative.x,
                    y: state.windowBounds.y + element.anchors.windowRelative.y,
                }
                : element.anchors.absolute ?? element.center;
            const bbox = element.anchors.windowRelative
                ? {
                    x: state.windowBounds.x + (element.bbox.x - (seedState?.windowBounds.x ?? 0)),
                    y: state.windowBounds.y + (element.bbox.y - (seedState?.windowBounds.y ?? 0)),
                    width: element.bbox.width,
                    height: element.bbox.height,
                }
                : element.bbox;

            return {
                ...element,
                elementId: `projected:${state.stateId}:${slugify(element.label ?? element.elementId)}`,
                stateId: state.stateId,
                bbox,
                center,
                confidence: Math.min(0.92, Math.max(element.confidence, 0.72)),
                interactableScore: Math.max(element.interactableScore, 0.75),
                notes: `${element.notes ?? 'Projected from seed graph'} [projected]`,
            };
        })
        .filter((element) => intersectsRegion(element.bbox, region));
}

function mergeCandidates(live: GuiElementNode[], projected: GuiElementNode[]): GuiElementNode[] {
    const merged = [...live];

    for (const projectedElement of projected) {
        const existing = merged.find((liveElement) => {
            const sameLabel = !!liveElement.label && !!projectedElement.label
                && liveElement.label.toLowerCase() === projectedElement.label.toLowerCase();
            const dx = Math.abs(liveElement.center.x - projectedElement.center.x);
            const dy = Math.abs(liveElement.center.y - projectedElement.center.y);
            return sameLabel || (dx <= 18 && dy <= 18);
        });

        if (existing) {
            existing.confidence = Math.min(0.95, Math.max(existing.confidence, projectedElement.confidence) + 0.05);
            existing.interactableScore = Math.max(existing.interactableScore, projectedElement.interactableScore);
            existing.notes = `${existing.notes ?? ''}${existing.notes ? ' | ' : ''}matched projected seed`;
            if (!existing.anchors.windowRelative && projectedElement.anchors.windowRelative) {
                existing.anchors.windowRelative = projectedElement.anchors.windowRelative;
            }
            if (!existing.anchors.absolute && projectedElement.anchors.absolute) {
                existing.anchors.absolute = projectedElement.anchors.absolute;
            }
        } else {
            merged.push(projectedElement);
        }
    }

    return uniqueBy(merged, (element) => `${element.label ?? element.elementId}:${element.center.x}:${element.center.y}`);
}

function isHighSignalElement(element: GuiElementNode, state: GuiStateFingerprint): boolean {
    if (element.role !== 'unknown') return true;
    const label = element.label ?? '';
    const relativeY = element.center.y - state.windowBounds.y;
    if (relativeY <= Math.max(120, Math.round(state.windowBounds.height * 0.15)) && label.length <= 18 && alphaRatio(label) >= 0.75) {
        return true;
    }
    return false;
}

export async function inferGuiElements(
    state: GuiStateFingerprint,
    opts: { seedGraph?: GuiTrustGraph; region?: GuiInferenceRegion } = {},
): Promise<GuiElementNode[]> {
    const ocr = await runOcr(state.screenshotPath, state.windowTitle);
    const live = ocr ? inferFromOcrInRegion(ocr, state, opts.region) : [];
    const projected = projectSeedElements(state, opts.seedGraph, opts.region);
    return mergeCandidates(live, projected).filter((element) => isHighSignalElement(element, state));
}

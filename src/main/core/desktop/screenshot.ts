/**
 * Screenshot capture and OCR analysis.
 *
 * Improvements over 4.0:
 * - gnome-screenshot fallback
 * - Region capture without scrot (via import/ImageMagick or Python+Pillow)
 * - VisionLLM path stubbed for future upgrade (base64 image attachment to model)
 * - Tesseract called with HOCR for coordinate extraction when available
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { cmdExists, run, runSeparate, wait } from './shared';
import { desktopState, cacheTarget, recordScreenshot } from './state';
import { smartFocus } from './smartFocus';

// ─── Screenshot capture ───────────────────────────────────────────────────────

export async function captureScreen(opts: {
    window?: string;
    region?: { x: number; y: number; w: number; h: number };
}): Promise<{ path: string; error?: string }> {
    const filename = path.join(os.tmpdir(), `clawdia-screenshot-${Date.now()}.png`);

    if (opts.window) {
        if (await cmdExists('wmctrl')) {
            await run(`wmctrl -a "${opts.window}" 2>/dev/null`);
        }
        await wait(250);
    }

    if (opts.region) {
        const { x, y, w, h } = opts.region;
        if (await cmdExists('scrot')) {
            await run(`scrot -a ${x},${y},${w},${h} "${filename}"`);
        } else if (await cmdExists('import')) {
            await run(`import -window root -crop ${w}x${h}+${x}+${y} "${filename}"`);
        } else {
            return { path: '', error: 'No region screenshot tool. Install: sudo apt install scrot' };
        }
    } else if (opts.window) {
        if (await cmdExists('scrot')) {
            await run(`scrot -u "${filename}"`);
        } else if (await cmdExists('gnome-screenshot')) {
            await run(`gnome-screenshot -w -f "${filename}"`);
        } else {
            return { path: '', error: 'No screenshot tool. Install: sudo apt install scrot' };
        }
    } else {
        // Full screen
        if (await cmdExists('scrot')) {
            await run(`scrot "${filename}"`);
        } else if (await cmdExists('gnome-screenshot')) {
            await run(`gnome-screenshot -f "${filename}"`);
        } else {
            return { path: '', error: 'No screenshot tool. Install: sudo apt install scrot' };
        }
    }

    if (!fs.existsSync(filename)) {
        return { path: '', error: `Screenshot failed — file not created at ${filename}` };
    }

    recordScreenshot(desktopState);
    return { path: filename };
}

// ─── OCR analysis ─────────────────────────────────────────────────────────────

export interface OcrResult {
    summary: string;
    targets: Array<{ label: string; x: number; y: number; bbox?: { x: number; y: number; width: number; height: number } }>;
    words: Array<{ label: string; x: number; y: number; bbox: { x: number; y: number; width: number; height: number } }>;
    rawText: string;
}

/**
 * Run tesseract OCR on an image and extract click targets.
 * Falls back to raw text when HOCR coordinate parsing fails.
 */
export async function runOcr(imagePath: string, windowTitle = ''): Promise<OcrResult | null> {
    if (!await cmdExists('tesseract')) return null;
    if (!fs.existsSync(imagePath)) return null;

    const basePath = imagePath.replace(/\.png$/i, '');

    // Try HOCR for coordinates, fall back to plain text
    let rawText = '';
    let words: Array<{ label: string; x: number; y: number; bbox: { x: number; y: number; width: number; height: number } }> = [];
    let targets: Array<{ label: string; x: number; y: number; bbox?: { x: number; y: number; width: number; height: number } }> = [];

    try {
        // Plain text pass first (reliable)
        const { stdout: txt } = await runSeparate(`tesseract "${imagePath}" stdout 2>/dev/null`);
        rawText = txt;
    } catch { /* non-fatal */ }

    try {
        // HOCR pass for coordinates
        const hocrPath = `${basePath}.hocr`;
        const { stderr } = await runSeparate(
            `tesseract "${imagePath}" "${basePath}" hocr 2>/dev/null`,
            15_000,
        );
        if (!stderr.includes('Error') && fs.existsSync(hocrPath)) {
            words = parseHocrWords(fs.readFileSync(hocrPath, 'utf8'));
            targets = dedupeHocrWords(words);
            fs.rmSync(hocrPath, { force: true });
        }
    } catch { /* non-fatal — use empty targets */ }

    // Cache discovered targets into desktop state
    for (const t of targets) {
        cacheTarget(desktopState, t.label, t.x, t.y);
    }

    const lines: string[] = [];
    if (windowTitle) lines.push(`Window: ${windowTitle}`);
    if (targets.length > 0) {
        lines.push('Click targets:');
        for (const t of targets.slice(0, 20)) {
            lines.push(`  "${t.label}" at (${t.x}, ${t.y})`);
        }
    }
    if (rawText) {
        const preview = rawText.split('\n').slice(0, 20).join('\n');
        lines.push(`OCR text:\n${preview}`);
    }

    return {
        summary: lines.join('\n'),
        targets,
        words,
        rawText,
    };
}

/** Parse tesseract HOCR output to extract word bounding boxes as click targets. */
function parseHocrWords(hocr: string): Array<{ label: string; x: number; y: number; bbox: { x: number; y: number; width: number; height: number } }> {
    const results: Array<{ label: string; x: number; y: number; bbox: { x: number; y: number; width: number; height: number } }> = [];
    // Match words with bbox: <span class='ocrx_word' ... title='bbox x0 y0 x1 y1...'>text</span>
    const re = /<span[^>]+class=['"]ocrx_word['"][^>]+title=['"][^'"]*bbox\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)[^'"]*['"][^>]*>([^<]+)<\/span>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(hocr)) !== null) {
        const [, x0, y0, x1, y1, word] = m;
        const text = word.trim().replace(/&[a-z]+;/gi, '');
        if (text.length < 2) continue; // skip single-char noise
        const left = parseInt(x0, 10);
        const top = parseInt(y0, 10);
        const right = parseInt(x1, 10);
        const bottom = parseInt(y1, 10);
        const cx = Math.round((left + right) / 2);
        const cy = Math.round((top + bottom) / 2);
        results.push({
            label: text,
            x: cx,
            y: cy,
            bbox: {
                x: left,
                y: top,
                width: Math.max(1, right - left),
                height: Math.max(1, bottom - top),
            },
        });
    }
    return results;
}

function dedupeHocrWords(
    words: Array<{ label: string; x: number; y: number; bbox: { x: number; y: number; width: number; height: number } }>,
): Array<{ label: string; x: number; y: number; bbox?: { x: number; y: number; width: number; height: number } }> {
    const seen = new Map<string, { label: string; x: number; y: number; bbox: { x: number; y: number; width: number; height: number } }>();
    for (const word of words) {
        const existing = seen.get(word.label);
        const wordArea = word.bbox.width * word.bbox.height;
        const existingArea = existing ? existing.bbox.width * existing.bbox.height : -1;
        if (!existing || wordArea > existingArea) {
            seen.set(word.label, word);
        }
    }
    return [...seen.values()].slice(0, 30);
}

// ─── Combined screenshot+OCR ──────────────────────────────────────────────────

export async function captureAndAnalyze(opts: {
    window?: string;
    region?: { x: number; y: number; w: number; h: number };
}): Promise<{ imagePath: string; ocr: OcrResult | null; summary: string }> {
    const capture = await captureScreen(opts);
    if (capture.error || !capture.path) {
        return { imagePath: '', ocr: null, summary: `[Error] ${capture.error}` };
    }

    if (opts.window) {
        await smartFocus(opts.window);
        await wait(200);
    }

    const ocr = await runOcr(capture.path, opts.window);
    const summary = [
        `[Screenshot: ${capture.path}]`,
        ocr ? ocr.summary : '[OCR unavailable — install tesseract-ocr]',
    ].join('\n\n');

    return { imagePath: capture.path, ocr, summary };
}

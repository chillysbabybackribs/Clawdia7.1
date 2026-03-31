/**
 * Browser File Open System
 *
 * Supports three distinct modes for opening local files in the embedded browser:
 *
 *   review  — raw file content in a read-only review surface (default for most files)
 *   preview — rendered/formatted presentation (markdown, html, csv)
 *   publish — navigate directly to a pre-built HTML artifact page
 *
 * Mode resolution order:
 *   1. Explicit mode argument
 *   2. Extension-based default
 *   3. Falls back to 'review'
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { BrowserService } from './BrowserService';
import { ElectronBrowserService } from './ElectronBrowserService';

export type BrowserOpenMode = 'review' | 'preview' | 'publish';

// Extensions the browser renders natively — no wrapper needed, navigate directly
const NATIVE_EXTENSIONS = new Set([
  '.html', '.htm', '.svg', '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav',
]);

// Extensions that default to preview mode when no explicit mode is given
const PREVIEW_EXTENSIONS = new Set(['.html', '.htm', '.svg', '.pdf']);

// Extensions that default to review (everything else also falls back to review)
const REVIEW_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.log', '.csv', '.yaml', '.yml',
  '.xml', '.js', '.ts', '.tsx', '.jsx', '.py', '.sh', '.bash', '.zsh',
  '.css', '.scss', '.sass', '.less', '.rs', '.go', '.java', '.c', '.cpp',
  '.h', '.hpp', '.rb', '.php', '.swift', '.kt', '.toml', '.ini', '.env',
  '.conf', '.config', '.lock', '.gitignore', '.dockerfile',
]);

/**
 * Resolve the open mode for a given file path when no explicit mode is provided.
 */
export function resolveOpenMode(filePath: string): BrowserOpenMode {
  const ext = path.extname(filePath).toLowerCase();
  if (PREVIEW_EXTENSIONS.has(ext)) return 'preview';
  return 'review';
}

/**
 * Returns true if the browser can render this file natively via file:// —
 * no wrapper HTML needed. Images, PDFs, HTML, SVG, media files.
 */
export function isNativelyRenderable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return NATIVE_EXTENSIONS.has(ext);
}

/**
 * Open a local file in the browser with the specified mode.
 *
 * Respects conversation-scoped tab ownership when conversationId is provided.
 * Falls back to the active tab when not scoped.
 */
export async function openFileInBrowser(
  filePath: string,
  opts: { mode?: BrowserOpenMode; conversationId?: string },
  browser: BrowserService,
): Promise<{ url: string; mode: BrowserOpenMode }> {
  const absPath = path.resolve(filePath);
  const mode = opts.mode ?? resolveOpenMode(absPath);

  let targetUrl: string;

  // For natively renderable files (images, PDF, HTML, SVG, media) — navigate
  // directly via file:// unless the user explicitly asked for a wrapper mode.
  if (!opts.mode && isNativelyRenderable(absPath)) {
    targetUrl = `file://${absPath}`;
  } else if (mode === 'publish') {
    targetUrl = `file://${absPath}`;
  } else if (mode === 'preview') {
    targetUrl = await buildPreviewUrl(absPath);
  } else {
    targetUrl = await buildReviewUrl(absPath);
  }

  if (opts.conversationId && browser instanceof ElectronBrowserService) {
    const tabId = await browser.getOrAssignTab(opts.conversationId);
    await browser.navigateTab(tabId, targetUrl);
  } else {
    await browser.navigate(targetUrl);
  }

  return { url: targetUrl, mode };
}

// ── Review mode ───────────────────────────────────────────────────────────────

async function buildReviewUrl(absPath: string): Promise<string> {
  let content: string;
  try {
    content = await fs.readFile(absPath, 'utf-8');
  } catch {
    content = `[Could not read file: ${absPath}]`;
  }

  const fileName = path.basename(absPath);
  const ext = path.extname(absPath).slice(1).toLowerCase() || 'txt';
  const escaped = escapeHtml(content);
  const lines = content.split('\n');
  const lineCount = lines.length;

  const lineNums = lines
    .map((_, i) => `<span class="ln">${i + 1}</span>`)
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(fileName)} — Review</title>
<style>
  :root {
    --bg: #0f1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --muted: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --ln: #484f58;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .header {
    position: sticky; top: 0; z-index: 10;
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 10px 18px; display: flex; align-items: center;
    gap: 12px; flex-wrap: wrap;
  }
  .filename { font-size: 14px; font-weight: 600; color: var(--text); }
  .filepath { font-size: 11px; color: var(--muted); font-family: monospace; flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge {
    padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;
    letter-spacing: .04em; text-transform: uppercase; white-space: nowrap;
  }
  .badge-review { background: rgba(88,166,255,.15); color: var(--accent);
    border: 1px solid rgba(88,166,255,.25); }
  .badge-ext { background: var(--bg); color: var(--muted);
    border: 1px solid var(--border); }
  .meta { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .actions { display: flex; gap: 8px; margin-left: auto; }
  button {
    background: var(--surface); border: 1px solid var(--border); color: var(--text);
    padding: 4px 12px; border-radius: 6px; font-size: 12px; cursor: pointer;
    transition: background .15s, border-color .15s;
  }
  button:hover { background: #21262d; border-color: var(--accent); color: var(--accent); }
  button.copied { border-color: var(--green); color: var(--green); }
  .content-wrap {
    display: flex; overflow: auto; height: calc(100vh - 47px);
  }
  .line-numbers {
    padding: 16px 0; background: var(--surface);
    border-right: 1px solid var(--border); user-select: none;
    flex-shrink: 0; min-width: 44px; text-align: right;
  }
  .ln {
    display: block; padding: 0 10px; font-family: "SF Mono","Fira Mono","Consolas",monospace;
    font-size: 13px; line-height: 1.65; color: var(--ln);
  }
  pre {
    flex: 1; padding: 16px 20px; margin: 0;
    font-family: "SF Mono","Fira Mono","Consolas",monospace;
    font-size: 13px; line-height: 1.65; color: var(--text);
    white-space: pre; overflow-x: auto; tab-size: 2;
  }
</style>
</head>
<body>
<div class="header">
  <span class="badge badge-review">Review</span>
  <span class="filename">${escapeHtml(fileName)}</span>
  <span class="badge badge-ext">.${escapeHtml(ext)}</span>
  <span class="filepath" title="${escapeHtml(absPath)}">${escapeHtml(absPath)}</span>
  <span class="meta">${lineCount.toLocaleString()} line${lineCount !== 1 ? 's' : ''}</span>
  <div class="actions">
    <button id="copyBtn" onclick="copyContent()">Copy</button>
  </div>
</div>
<div class="content-wrap">
  <div class="line-numbers">${lineNums}</div>
  <pre id="content">${escaped}</pre>
</div>
<script>
  function copyContent() {
    const text = document.getElementById('content').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('copyBtn');
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
    });
  }
</script>
</body>
</html>`;

  return writeTempHtml(html, `review-${path.basename(absPath)}`);
}

// ── Preview mode ──────────────────────────────────────────────────────────────

async function buildPreviewUrl(absPath: string): Promise<string> {
  const ext = path.extname(absPath).toLowerCase();

  // For HTML/SVG: navigate directly — the browser renders it natively
  if (ext === '.html' || ext === '.htm' || ext === '.svg' || ext === '.pdf') {
    return `file://${absPath}`;
  }

  // Markdown: render to HTML
  if (ext === '.md' || ext === '.markdown') {
    return buildMarkdownPreviewUrl(absPath);
  }

  // CSV: render as a table
  if (ext === '.csv') {
    return buildCsvPreviewUrl(absPath);
  }

  // JSON: pretty-printed tree view
  if (ext === '.json') {
    return buildJsonPreviewUrl(absPath);
  }

  // Fallback: review mode
  return buildReviewUrl(absPath);
}

async function buildMarkdownPreviewUrl(absPath: string): Promise<string> {
  let source: string;
  try {
    source = await fs.readFile(absPath, 'utf-8');
  } catch {
    source = `Could not read: ${absPath}`;
  }

  const fileName = path.basename(absPath);
  // Minimal safe markdown renderer (no external deps)
  const rendered = renderMarkdown(source);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(fileName)} — Preview</title>
<style>
  :root {
    --bg: #0f1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --muted: #8b949e; --accent: #58a6ff; --code-bg: #161b22;
  }
  * { box-sizing: border-box; }
  html, body { background: var(--bg); color: var(--text); margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .header {
    position: sticky; top: 0; z-index: 10; background: var(--surface);
    border-bottom: 1px solid var(--border); padding: 10px 18px;
    display: flex; align-items: center; gap: 10px;
  }
  .badge { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;
    letter-spacing:.04em; text-transform: uppercase; }
  .badge-preview { background: rgba(63,185,80,.15); color: #3fb950;
    border: 1px solid rgba(63,185,80,.25); }
  .filename { font-size: 14px; font-weight: 600; }
  .filepath { font-size: 11px; color: var(--muted); font-family: monospace; flex:1;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .body { max-width: 780px; margin: 0 auto; padding: 32px 24px; line-height: 1.75; }
  h1,h2,h3,h4,h5,h6 { color: var(--text); margin: 1.4em 0 .5em; font-weight:700; }
  h1 { font-size: 1.8em; padding-bottom:.3em; border-bottom:1px solid var(--border); }
  h2 { font-size: 1.4em; padding-bottom:.2em; border-bottom:1px solid var(--border); }
  h3 { font-size: 1.15em; }
  p { margin: .75em 0; color: var(--text); }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { background: var(--code-bg); border: 1px solid var(--border); border-radius:4px;
    padding:1px 5px; font-family:"SF Mono","Fira Mono","Consolas",monospace; font-size:.88em; }
  pre { background: var(--code-bg); border: 1px solid var(--border); border-radius:8px;
    padding:16px; overflow-x:auto; margin:1em 0; }
  pre code { background:none; border:none; padding:0; font-size:.87em; }
  blockquote { border-left:3px solid var(--border); margin:1em 0; padding:.5em 1em;
    color:var(--muted); }
  table { border-collapse:collapse; width:100%; margin:1em 0; }
  th,td { border:1px solid var(--border); padding:8px 12px; text-align:left; }
  th { background:var(--surface); font-weight:600; }
  tr:nth-child(even) td { background: rgba(255,255,255,.02); }
  ul,ol { padding-left:1.5em; margin:.75em 0; }
  li { margin:.25em 0; }
  hr { border:none; border-top:1px solid var(--border); margin:1.5em 0; }
  img { max-width:100%; border-radius:6px; }
</style>
</head>
<body>
<div class="header">
  <span class="badge badge-preview">Preview</span>
  <span class="filename">${escapeHtml(fileName)}</span>
  <span class="filepath" title="${escapeHtml(absPath)}">${escapeHtml(absPath)}</span>
</div>
<div class="body">${rendered}</div>
</body>
</html>`;

  return writeTempHtml(html, `preview-${path.basename(absPath)}`);
}

async function buildCsvPreviewUrl(absPath: string): Promise<string> {
  let source: string;
  try {
    source = await fs.readFile(absPath, 'utf-8');
  } catch {
    source = '';
  }

  const fileName = path.basename(absPath);
  const rows = parseCsv(source);
  const header = rows[0] ?? [];
  const body = rows.slice(1);

  const theadHtml = header.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const tbodyHtml = body
    .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(fileName)} — Preview</title>
<style>
  :root { --bg:#0f1117; --surface:#161b22; --border:#30363d; --text:#e6edf3; --muted:#8b949e; }
  * { box-sizing:border-box; margin:0; padding:0; }
  html,body { background:var(--bg); color:var(--text); height:100%;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  .header { position:sticky; top:0; background:var(--surface); border-bottom:1px solid var(--border);
    padding:10px 18px; display:flex; align-items:center; gap:10px; }
  .badge { padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;
    letter-spacing:.04em; text-transform:uppercase;
    background:rgba(63,185,80,.15); color:#3fb950; border:1px solid rgba(63,185,80,.25); }
  .filename { font-size:14px; font-weight:600; }
  .meta { font-size:11px; color:var(--muted); }
  .wrap { overflow:auto; height:calc(100vh - 47px); padding:16px 18px; }
  table { border-collapse:collapse; font-size:13px; }
  th { background:var(--surface); border:1px solid var(--border); padding:7px 12px;
    font-weight:600; position:sticky; top:0; }
  td { border:1px solid var(--border); padding:6px 12px; white-space:nowrap; }
  tr:nth-child(even) td { background:rgba(255,255,255,.02); }
</style>
</head>
<body>
<div class="header">
  <span class="badge">Preview</span>
  <span class="filename">${escapeHtml(fileName)}</span>
  <span class="meta">${body.length.toLocaleString()} rows · ${header.length} columns</span>
</div>
<div class="wrap">
  <table>
    <thead><tr>${theadHtml}</tr></thead>
    <tbody>${tbodyHtml}</tbody>
  </table>
</div>
</body>
</html>`;

  return writeTempHtml(html, `preview-${path.basename(absPath)}`);
}

async function buildJsonPreviewUrl(absPath: string): Promise<string> {
  let source: string;
  let pretty: string;
  try {
    source = await fs.readFile(absPath, 'utf-8');
    pretty = JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    pretty = source! ?? `Could not read: ${absPath}`;
  }

  const fileName = path.basename(absPath);
  const escaped = escapeHtml(pretty);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(fileName)} — Preview</title>
<style>
  :root { --bg:#0f1117; --surface:#161b22; --border:#30363d; --text:#e6edf3; --muted:#8b949e; --accent:#58a6ff; }
  * { box-sizing:border-box; margin:0; padding:0; }
  html,body { background:var(--bg); color:var(--text); height:100%;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  .header { position:sticky; top:0; background:var(--surface); border-bottom:1px solid var(--border);
    padding:10px 18px; display:flex; align-items:center; gap:10px; }
  .badge { padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;
    letter-spacing:.04em; text-transform:uppercase;
    background:rgba(63,185,80,.15); color:#3fb950; border:1px solid rgba(63,185,80,.25); }
  .filename { font-size:14px; font-weight:600; }
  .actions { margin-left:auto; }
  button { background:var(--surface); border:1px solid var(--border); color:var(--text);
    padding:4px 12px; border-radius:6px; font-size:12px; cursor:pointer; }
  button:hover { border-color:var(--accent); color:var(--accent); }
  button.copied { border-color:#3fb950; color:#3fb950; }
  pre { padding:16px 20px; margin:0; height:calc(100vh - 47px); overflow:auto;
    font-family:"SF Mono","Fira Mono","Consolas",monospace; font-size:13px; line-height:1.65;
    white-space:pre; tab-size:2; }
</style>
</head>
<body>
<div class="header">
  <span class="badge">Preview</span>
  <span class="filename">${escapeHtml(fileName)}</span>
  <div class="actions">
    <button id="copyBtn" onclick="copyContent()">Copy</button>
  </div>
</div>
<pre id="content">${escaped}</pre>
<script>
  function copyContent() {
    navigator.clipboard.writeText(document.getElementById('content').textContent).then(() => {
      const btn = document.getElementById('copyBtn');
      btn.textContent = 'Copied!'; btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
    });
  }
</script>
</body>
</html>`;

  return writeTempHtml(html, `preview-${path.basename(absPath)}`);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

async function writeTempHtml(html: string, label: string): Promise<string> {
  const safe = label.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const tmpPath = path.join(os.tmpdir(), `clawdia-${safe}.html`);
  await fs.writeFile(tmpPath, html, 'utf-8');
  return `file://${tmpPath}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Minimal markdown-to-HTML renderer — no external deps, handles common syntax. */
function renderMarkdown(md: string): string {
  let html = escapeHtml(md);

  // Fenced code blocks
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, (_m, code) =>
    `<pre><code>${code}</code></pre>`);

  // Inline code
  html = html.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);

  // Headings
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr>');

  // Blockquote
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

  // Unordered lists (simple single-level)
  html = html.replace(/((?:^[*\-+] .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map((l) =>
      `<li>${l.replace(/^[*\-+] /, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered lists
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map((l) =>
      `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  // Tables
  html = html.replace(/((?:^\|.+\|\n?)+)/gm, (block) => {
    const rows = block.trim().split('\n').filter((r) => !/^\|[-| :]+\|$/.test(r));
    if (rows.length === 0) return block;
    const [header, ...body] = rows;
    const th = header.split('|').filter(Boolean).map((c) => `<th>${c.trim()}</th>`).join('');
    const tb = body.map((row) =>
      `<tr>${row.split('|').filter(Boolean).map((c) => `<td>${c.trim()}</td>`).join('')}</tr>`
    ).join('');
    return `<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`;
  });

  // Paragraphs: wrap double-newline separated blocks not already in block tags
  html = html.replace(/\n{2,}/g, '\n\n');
  const lines = html.split('\n\n');
  html = lines.map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (/^<(h[1-6]|pre|ul|ol|blockquote|table|hr)/.test(trimmed)) return trimmed;
    return `<p>${trimmed.replace(/\n/g, ' ')}</p>`;
  }).join('\n');

  return html;
}

/** Minimal CSV parser — handles quoted fields. */
function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  for (const line of source.split('\n')) {
    if (!line.trim()) continue;
    const row: string[] = [];
    let field = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { field += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === ',' && !inQuote) {
        row.push(field); field = '';
      } else {
        field += ch;
      }
    }
    row.push(field);
    rows.push(row);
  }
  return rows;
}

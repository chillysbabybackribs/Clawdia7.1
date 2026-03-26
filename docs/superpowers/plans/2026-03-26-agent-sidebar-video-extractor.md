# Agent Sidebar + Video Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing rail+drawer sidebar with a single 300px AgentSidebar containing accordion agent cards, with the Video Extractor (yt-dlp) as the first agent.

**Architecture:** `AgentSidebar.tsx` is a 300px fixed panel that manages which accordion card is open (one at a time). `VideoExtractorAgent.tsx` is a self-contained card with its own UI state and IPC calls. The main process handler `videoExtractor.ts` owns all yt-dlp shell execution and streams progress back via IPC events.

**Tech Stack:** React + TypeScript, Tailwind CSS, Electron IPC, Node.js `child_process.spawn`, yt-dlp (system binary)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/components/AgentSidebar.tsx` | Create | 300px panel, renders accordion cards, one-open-at-a-time state |
| `src/renderer/components/agents/VideoExtractorAgent.tsx` | Create | Accordion card UI: input, folder picker, dropdowns, status area |
| `src/main/ipc/videoExtractor.ts` | Create | IPC handlers: check-ytdlp, install-ytdlp, open-folder-dialog, start-download |
| `src/renderer/App.tsx` | Modify | Swap `<Sidebar>` for `<AgentSidebar>`, remove sidebar props |
| `src/main/main.ts` | Modify | Import and call `registerVideoExtractorIpc(win)` |

---

## Task 1: Create the IPC handler file (main process)

**Files:**
- Create: `src/main/ipc/videoExtractor.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/main/ipc/videoExtractor.ts
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { spawn, exec } from 'child_process';
import * as os from 'os';

export function registerVideoExtractorIpc(win: BrowserWindow): void {

  // Check if yt-dlp is installed
  ipcMain.handle('check-ytdlp', async () => {
    return new Promise<{ installed: boolean }>((resolve) => {
      exec('which yt-dlp', (err) => {
        resolve({ installed: !err });
      });
    });
  });

  // Install yt-dlp via pip
  ipcMain.handle('install-ytdlp', async () => {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      const pip = spawn('pip3', ['install', 'yt-dlp'], { shell: true });
      pip.stdout.on('data', (data: Buffer) => {
        win.webContents.send('install-ytdlp-progress', { line: data.toString() });
      });
      pip.stderr.on('data', (data: Buffer) => {
        win.webContents.send('install-ytdlp-progress', { line: data.toString() });
      });
      pip.on('close', (code) => {
        if (code === 0) resolve({ success: true });
        else resolve({ success: false, error: `pip3 exited with code ${code}` });
      });
    });
  });

  // Open folder picker dialog
  ipcMain.handle('open-folder-dialog', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      defaultPath: os.homedir() + '/Downloads',
    });
    return { path: result.canceled ? null : result.filePaths[0] };
  });

  // Start a yt-dlp download
  ipcMain.handle('start-download', async (_event, {
    url,
    outputDir,
    quality,
    format,
    audio,
  }: {
    url: string;
    outputDir: string;
    quality: string;
    format: string;
    audio: string;
  }) => {
    const args = buildYtdlpArgs(url, outputDir, quality, format, audio);
    const proc = spawn('yt-dlp', args, { shell: false });

    proc.stdout.on('data', (data: Buffer) => {
      const line = data.toString();
      const percentMatch = line.match(/(\d+\.\d+)%/);
      const percent = percentMatch ? parseFloat(percentMatch[1]) : null;
      win.webContents.send('download-progress', { percent, line: line.trim() });
    });

    proc.stderr.on('data', (data: Buffer) => {
      win.webContents.send('download-progress', { percent: null, line: data.toString().trim() });
    });

    return new Promise<{ success: boolean; filePath?: string; error?: string }>((resolve) => {
      let lastFile = '';
      proc.stdout.on('data', (data: Buffer) => {
        const line = data.toString();
        const destMatch = line.match(/Destination:\s+(.+)/);
        if (destMatch) lastFile = destMatch[1].trim();
        const mergeMatch = line.match(/Merging formats into "(.+?)"/);
        if (mergeMatch) lastFile = mergeMatch[1].trim();
      });
      proc.on('close', (code) => {
        if (code === 0) {
          win.webContents.send('download-complete', { filePath: lastFile || outputDir });
          resolve({ success: true, filePath: lastFile || outputDir });
        } else {
          win.webContents.send('download-error', { message: `yt-dlp exited with code ${code}` });
          resolve({ success: false, error: `yt-dlp exited with code ${code}` });
        }
      });
    });
  });
}

function buildYtdlpArgs(
  url: string,
  outputDir: string,
  quality: string,
  format: string,
  audio: string,
): string[] {
  const output = `${outputDir}/%(title)s.%(ext)s`;
  const args: string[] = [url, '-o', output, '--newline'];

  const isAudioOnly = audio !== 'Video';

  if (isAudioOnly) {
    args.push('--extract-audio');
    const codecMap: Record<string, string> = {
      'Audio only': 'mp3',
      MP3: 'mp3',
      M4A: 'm4a',
      OPUS: 'opus',
    };
    args.push('--audio-format', codecMap[audio] ?? 'mp3');
  } else {
    // Quality selector
    const qualityMap: Record<string, string> = {
      Best: 'bestvideo+bestaudio/best',
      '1080p': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
      '720p': 'bestvideo[height<=720]+bestaudio/best[height<=720]',
      '480p': 'bestvideo[height<=480]+bestaudio/best[height<=480]',
      '360p': 'bestvideo[height<=360]+bestaudio/best[height<=360]',
    };
    args.push('-f', qualityMap[quality] ?? 'bestvideo+bestaudio/best');

    // Container format
    const formatMap: Record<string, string> = {
      MP4: 'mp4',
      WebM: 'webm',
      MKV: 'mkv',
    };
    args.push('--merge-output-format', formatMap[format] ?? 'mp4');
  }

  return args;
}
```

- [ ] **Step 2: Verify the file compiles (no test needed for IPC registration)**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors referencing `videoExtractor.ts`

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/videoExtractor.ts
git commit -m "feat: add videoExtractor IPC handler for yt-dlp"
```

---

## Task 2: Wire IPC into main.ts

**Files:**
- Modify: `src/main/main.ts`

- [ ] **Step 1: Add the import and registration call**

In `src/main/main.ts`, add after the existing imports:

```typescript
import { registerVideoExtractorIpc } from './ipc/videoExtractor';
```

Then inside `app.whenReady().then(() => { ... })`, after `registerTerminalIpc(terminalController, win);`, add:

```typescript
registerVideoExtractorIpc(win);
```

The `app.whenReady` block should look like:

```typescript
app.whenReady().then(() => {
  const win = createWindow();
  const browserService = new ElectronBrowserService(win, app.getPath('userData'));
  void browserService.init();
  const terminalController = new TerminalSessionController();
  registerIpc(browserService);
  registerTerminalIpc(terminalController, win);
  registerVideoExtractorIpc(win);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
```

- [ ] **Step 2: Verify compilation**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/main/main.ts
git commit -m "feat: register videoExtractor IPC in main process"
```

---

## Task 3: Create VideoExtractorAgent card component

**Files:**
- Create: `src/renderer/components/agents/VideoExtractorAgent.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/renderer/components/agents/VideoExtractorAgent.tsx
import React, { useState, useRef, useEffect } from 'react';

interface Props {
  isOpen: boolean;
  onToggle: () => void;
}

type DownloadStatus =
  | { type: 'idle' }
  | { type: 'checking' }
  | { type: 'needs-install' }
  | { type: 'installing'; line: string }
  | { type: 'running'; percent: number | null; line: string }
  | { type: 'done'; filePath: string }
  | { type: 'error'; message: string };

const QUALITY_OPTIONS = ['Best', '1080p', '720p', '480p', '360p'];
const FORMAT_OPTIONS = ['MP4', 'WebM', 'MKV'];
const AUDIO_OPTIONS = ['Video', 'Audio only', 'MP3', 'M4A', 'OPUS'];

const DEFAULT_FOLDER = (typeof window !== 'undefined' && (window as any).__dirname)
  ? ''
  : '~/Downloads';

export default function VideoExtractorAgent({ isOpen, onToggle }: Props) {
  const [input, setInput] = useState('');
  const [folder, setFolder] = useState(DEFAULT_FOLDER);
  const [quality, setQuality] = useState('Best');
  const [format, setFormat] = useState('MP4');
  const [audio, setAudio] = useState('Video');
  const [status, setStatus] = useState<DownloadStatus>({ type: 'idle' });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load default download folder on mount
  useEffect(() => {
    const home = (window as any).clawdia?.shell?.homedir?.() ?? '';
    if (home) setFolder(home + '/Downloads');
  }, []);

  // Listen for IPC events from main process
  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api?.videoExtractor) return;

    const unsubProgress = api.videoExtractor.onProgress((data: { percent: number | null; line: string }) => {
      setStatus({ type: 'running', percent: data.percent, line: data.line });
    });
    const unsubComplete = api.videoExtractor.onComplete((data: { filePath: string }) => {
      setStatus({ type: 'done', filePath: data.filePath });
    });
    const unsubError = api.videoExtractor.onError((data: { message: string }) => {
      setStatus({ type: 'error', message: data.message });
    });
    const unsubInstallProgress = api.videoExtractor.onInstallProgress?.((data: { line: string }) => {
      setStatus({ type: 'installing', line: data.line });
    });

    return () => {
      unsubProgress?.();
      unsubComplete?.();
      unsubError?.();
      unsubInstallProgress?.();
    };
  }, []);

  const handleBrowse = async () => {
    const api = (window as any).clawdia;
    if (!api?.videoExtractor) return;
    const result = await api.videoExtractor.openFolderDialog();
    if (result?.path) setFolder(result.path);
  };

  const handleRun = async () => {
    if (!input.trim()) return;
    const api = (window as any).clawdia;
    if (!api?.videoExtractor) return;

    setStatus({ type: 'checking' });

    // Check yt-dlp is installed
    const { installed } = await api.videoExtractor.checkYtdlp();
    if (!installed) {
      setStatus({ type: 'needs-install' });
      return;
    }

    setStatus({ type: 'running', percent: null, line: 'Starting...' });
    await api.videoExtractor.startDownload({
      url: input.trim(),
      outputDir: folder,
      quality,
      format,
      audio,
    });
  };

  const handleInstall = async () => {
    const api = (window as any).clawdia;
    if (!api?.videoExtractor) return;
    setStatus({ type: 'installing', line: 'Installing yt-dlp...' });
    const result = await api.videoExtractor.installYtdlp();
    if (result.success) {
      setStatus({ type: 'idle' });
    } else {
      setStatus({ type: 'error', message: result.error ?? 'Install failed' });
    }
  };

  const isRunning = status.type === 'running' || status.type === 'checking' || status.type === 'installing';

  return (
    <div className="border-b border-white/[0.06]">
      {/* Header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 hover:bg-white/[0.04] transition-colors text-left"
      >
        <span className="text-base">🎬</span>
        <span className="flex-1 text-[12px] font-semibold text-text-primary">Video Extractor</span>
        <span className="text-[10px] text-[#3b82f6]">{isOpen ? '▲' : '▼'}</span>
      </button>

      {/* Body */}
      {isOpen && (
        <div className="px-2.5 pb-3 flex flex-col gap-2 border-t border-white/[0.06]">

          {/* Chat-style input */}
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/[0.1] bg-surface-0 px-3 py-2 min-h-[52px]">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleRun();
                }
              }}
              placeholder="Paste a URL or describe the video..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-[11px] text-text-primary placeholder-text-tertiary outline-none leading-relaxed"
              style={{ minHeight: '20px', maxHeight: '80px' }}
              disabled={isRunning}
            />
            <button
              onClick={handleRun}
              disabled={isRunning || !input.trim()}
              className="flex-shrink-0 rounded-[5px] bg-[#3b82f6] px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-40 hover:bg-[#2563eb] transition-colors whitespace-nowrap"
            >
              {isRunning ? '...' : 'Run ▶'}
            </button>
          </div>

          {/* Folder picker */}
          <div className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-surface-0 px-2.5 py-1.5">
            <span className="text-[11px]">📁</span>
            <span className="flex-1 truncate text-[10px] text-text-tertiary">{folder || '~/Downloads'}</span>
            <button
              onClick={handleBrowse}
              className="rounded border border-white/[0.1] px-1.5 py-0.5 text-[9px] text-text-tertiary hover:text-text-primary transition-colors"
            >
              Browse
            </button>
          </div>

          {/* Dropdowns row */}
          <div className="flex gap-1.5">
            {/* Quality */}
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-[8px] uppercase tracking-wide text-text-tertiary">Quality</span>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                disabled={isRunning}
                className="rounded-[5px] border border-white/[0.08] bg-surface-0 px-2 py-1 text-[10px] text-text-secondary outline-none disabled:opacity-40"
              >
                {QUALITY_OPTIONS.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </div>

            {/* Format */}
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-[8px] uppercase tracking-wide text-text-tertiary">Format</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                disabled={isRunning || audio !== 'Video'}
                className="rounded-[5px] border border-white/[0.08] bg-surface-0 px-2 py-1 text-[10px] text-text-secondary outline-none disabled:opacity-40"
              >
                {FORMAT_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>

            {/* Audio */}
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-[8px] uppercase tracking-wide text-text-tertiary">Audio</span>
              <select
                value={audio}
                onChange={(e) => setAudio(e.target.value)}
                disabled={isRunning}
                className="rounded-[5px] border border-white/[0.08] bg-surface-0 px-2 py-1 text-[10px] text-text-secondary outline-none disabled:opacity-40"
              >
                {AUDIO_OPTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Status area */}
          {status.type !== 'idle' && (
            <div className="rounded-md border border-white/[0.06] bg-surface-0 px-2.5 py-2 text-[10px]">
              {status.type === 'checking' && (
                <span className="text-text-tertiary">Checking yt-dlp...</span>
              )}
              {status.type === 'needs-install' && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-tertiary">yt-dlp not found</span>
                  <button
                    onClick={handleInstall}
                    className="rounded border border-[#3b82f6]/50 px-2 py-0.5 text-[9px] text-[#3b82f6] hover:bg-[#3b82f6]/10 transition-colors"
                  >
                    Install
                  </button>
                </div>
              )}
              {status.type === 'installing' && (
                <span className="text-text-tertiary truncate block">{status.line}</span>
              )}
              {status.type === 'running' && (
                <div className="flex flex-col gap-1.5">
                  {status.percent !== null && (
                    <div className="h-1 w-full rounded-full bg-white/[0.08]">
                      <div
                        className="h-1 rounded-full bg-[#3b82f6] transition-all"
                        style={{ width: `${status.percent}%` }}
                      />
                    </div>
                  )}
                  <span className="truncate text-text-tertiary">{status.line}</span>
                </div>
              )}
              {status.type === 'done' && (
                <span className="text-[#4ade80]">Done — saved to {status.filePath}</span>
              )}
              {status.type === 'error' && (
                <span className="text-[#FF5061]">{status.message}</span>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors referencing `VideoExtractorAgent.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/agents/VideoExtractorAgent.tsx
git commit -m "feat: add VideoExtractorAgent accordion card component"
```

---

## Task 4: Create AgentSidebar

**Files:**
- Create: `src/renderer/components/AgentSidebar.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/renderer/components/AgentSidebar.tsx
import React, { useState } from 'react';
import VideoExtractorAgent from './agents/VideoExtractorAgent';

type AgentId = 'video-extractor';

export default function AgentSidebar() {
  const [openAgent, setOpenAgent] = useState<AgentId | null>('video-extractor');

  const toggle = (id: AgentId) => {
    setOpenAgent((current) => (current === id ? null : id));
  };

  return (
    <nav
      className="flex h-full flex-shrink-0 flex-col border-r border-white/[0.06] bg-surface-1 overflow-y-auto"
      style={{ width: '300px' }}
    >
      <VideoExtractorAgent
        isOpen={openAgent === 'video-extractor'}
        onToggle={() => toggle('video-extractor')}
      />
    </nav>
  );
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/AgentSidebar.tsx
git commit -m "feat: add AgentSidebar shell with accordion state"
```

---

## Task 5: Wire AgentSidebar into App.tsx

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Replace the Sidebar import**

In `src/renderer/App.tsx`, replace:

```typescript
import Sidebar from './components/Sidebar';
```

with:

```typescript
import AgentSidebar from './components/AgentSidebar';
```

- [ ] **Step 2: Remove now-unused sidebar state**

Remove the `taskSidebarState` state and its `useEffect` that tracked running/completed task counts (lines 48 and 227–256 in the original). Also remove the `handleOpenAgent`, `handleCreateAgent` callbacks — they are only used by `<Sidebar>`.

The state variable to remove:
```typescript
const [taskSidebarState, setTaskSidebarState] = useState<TaskSidebarState>({ runningCount: 0, completedCount: 0 });
```

The `TaskSidebarState` interface and `useEffect` block that called `api.tasks.summary()` and subscribed to `onRunStarted`/`onRunComplete`.

- [ ] **Step 3: Replace the Sidebar JSX**

Replace:

```tsx
<Sidebar
  onViewChange={setActiveView}
  onNewChat={handleNewChat}
  onLoadConversation={handleLoadConversation}
  onOpenProcess={handleOpenProcess}
  onOpenAgent={handleOpenAgent}
  onCreateAgent={handleCreateAgent}
  onOpenFile={handleOpenEditorFile}
  chatKey={chatKey}
  runningTaskCount={taskSidebarState.runningCount}
  completedTasksBadge={taskSidebarState.completedCount}
/>
```

with:

```tsx
<AgentSidebar />
```

- [ ] **Step 4: Verify compilation**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors. If there are unused import errors for `CreateAgentPanel`, `AgentDetailPanel`, `ConversationsView`, etc. — leave those as-is for now since those views are still referenced in the JSX below.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: swap Sidebar for AgentSidebar in App"
```

---

## Task 6: Expose videoExtractor API via preload

**Context:** Clawdia uses `contextIsolation: true`, so IPC calls must be bridged through `preload.js`. Check what the preload file currently exposes and add videoExtractor methods.

- [ ] **Step 1: Find and read the preload file**

```bash
find /home/dp/Desktop/clawdia7.0/src -name "preload*" | head -5
```

Then read it to understand the pattern used for existing API bridges (e.g., how `clawdia.chat`, `clawdia.tasks` etc. are exposed).

- [ ] **Step 2: Add videoExtractor bridge**

Following the exact same pattern as other existing API bridges in the preload file, add:

```typescript
videoExtractor: {
  checkYtdlp: () => ipcRenderer.invoke('check-ytdlp'),
  installYtdlp: () => ipcRenderer.invoke('install-ytdlp'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  startDownload: (opts: {
    url: string;
    outputDir: string;
    quality: string;
    format: string;
    audio: string;
  }) => ipcRenderer.invoke('start-download', opts),
  onProgress: (cb: (data: { percent: number | null; line: string }) => void) => {
    const handler = (_: any, data: any) => cb(data);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },
  onComplete: (cb: (data: { filePath: string }) => void) => {
    const handler = (_: any, data: any) => cb(data);
    ipcRenderer.on('download-complete', handler);
    return () => ipcRenderer.removeListener('download-complete', handler);
  },
  onError: (cb: (data: { message: string }) => void) => {
    const handler = (_: any, data: any) => cb(data);
    ipcRenderer.on('download-error', handler);
    return () => ipcRenderer.removeListener('download-error', handler);
  },
  onInstallProgress: (cb: (data: { line: string }) => void) => {
    const handler = (_: any, data: any) => cb(data);
    ipcRenderer.on('install-ytdlp-progress', handler);
    return () => ipcRenderer.removeListener('install-ytdlp-progress', handler);
  },
},
```

- [ ] **Step 3: Verify compilation**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/main/preload.ts   # (or whatever the preload file is)
git commit -m "feat: expose videoExtractor IPC bridge in preload"
```

---

## Task 7: Smoke test the full flow

- [ ] **Step 1: Start the dev server**

```bash
cd /home/dp/Desktop/clawdia7.0 && npm run dev
```

- [ ] **Step 2: Verify sidebar renders**

Open the app. Confirm:
- Left sidebar is now 300px wide (no icon rail visible)
- "🎬 Video Extractor" header row is visible
- Clicking the header toggles the card open/closed

- [ ] **Step 3: Verify dropdowns**

With the card open, confirm three dropdowns are visible (Quality, Format, Audio) each with their full option lists.

- [ ] **Step 4: Verify folder picker**

Click Browse — confirm the native OS folder dialog opens and the selected path appears.

- [ ] **Step 5: Verify yt-dlp check**

If yt-dlp is not installed: type any text in the input, click Run ▶, confirm "yt-dlp not found" + Install button appears in the status area.

If yt-dlp is installed: paste a real YouTube URL, click Run ▶, confirm progress bar and percentage appear, and file downloads to the selected folder.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete agent sidebar + video extractor — first agent live"
```

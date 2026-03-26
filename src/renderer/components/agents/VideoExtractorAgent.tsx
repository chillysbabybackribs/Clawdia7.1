// src/renderer/components/agents/VideoExtractorAgent.tsx
import React, { useState, useEffect } from 'react';

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

export default function VideoExtractorAgent({ isOpen, onToggle }: Props) {
  const [input, setInput] = useState('');
  const [folder, setFolder] = useState('');
  const [quality, setQuality] = useState('Best');
  const [format, setFormat] = useState('MP4');
  const [audio, setAudio] = useState('Video');
  const [status, setStatus] = useState<DownloadStatus>({ type: 'idle' });

  // Load default download folder on mount
  useEffect(() => {
    const api = (window as any).clawdia;
    api?.videoExtractor?.getHomeDir?.().then((home: string) => {
      if (home) setFolder(home + '/Downloads');
    });
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
      setInput('');
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

    try {
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
    } catch (err: any) {
      setStatus({ type: 'error', message: err?.message ?? 'Unexpected error' });
    }
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
                disabled={isRunning || audio !== 'Video'}
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

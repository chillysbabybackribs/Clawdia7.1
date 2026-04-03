import React, { useState, useRef, useCallback, useEffect } from 'react';
import { DEFAULT_PROVIDER, getModelsForProvider, PROVIDERS, MODEL_REGISTRY, type ProviderId } from '../../shared/model-registry';
import type { MessageAttachment } from '../../shared/types';

interface InputBarProps {
  onSend: (message: string, attachments?: MessageAttachment[], provider?: string, model?: string) => void;
  isStreaming: boolean;
  isPaused: boolean;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onAddContext: (text: string) => void;
  onModelContextChange?: (provider: ProviderId, model: string) => void;
  claudeMode?: boolean;
  claudeStatus?: 'idle' | 'starting' | 'ready' | 'working' | 'errored' | 'stopped';
  onToggleClaudeMode?: () => void;
  claudeModeDisabled?: boolean;
  codexMode?: boolean;
  codexStatus?: 'idle' | 'starting' | 'ready' | 'working' | 'errored' | 'stopped';
  onToggleCodexMode?: () => void;
  codexModeDisabled?: boolean;
  concurrentMode?: boolean;
  onToggleConcurrentMode?: () => void;
  concurrentModeDisabled?: boolean;
  concurrentPhase?: 'idle' | 'planning' | 'executing' | 'synthesizing' | 'done';
  disabled?: boolean;
  chatZoom?: number;
  onChatZoomIn?: () => void;
  onChatZoomOut?: () => void;
  onChatZoomReset?: () => void;
  historyOpen?: boolean;
  onToggleHistory?: () => void;
  terminalOpen?: boolean;
  onToggleTerminal?: () => void;
  docsOpen?: boolean;
  onToggleDocs?: () => void;
  filesOpen?: boolean;
  onToggleFiles?: () => void;
  onOpenSettings?: () => void;
  contextPressure?: { used: number; budget: number; pct: number } | null;
  canCompress?: boolean;
  onCompressHistory?: () => Promise<{ ok: boolean; compressed?: boolean; savedTokens?: number; error?: string }> | void;
}

const LARGE_PASTE_CHAR_THRESHOLD = 2000;
const LARGE_PASTE_LINE_THRESHOLD = 50;

function InputVpnButton() {
  const api = (window as any).clawdia;
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api?.vpn?.status().then((s: boolean) => setConnected(s)).catch(() => setConnected(false));
    const id = setInterval(() => {
      api?.vpn?.status().then((s: boolean) => setConnected(s)).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [api]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await api?.vpn?.toggle();
      setConnected(next);
    } catch {
      api?.vpn?.status().then((s: boolean) => setConnected(s)).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={connected ? 'VPN connected — click to disconnect' : 'VPN disconnected — click to connect'}
      className={`px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-[0.08em] transition-all cursor-pointer ${
        connected ? 'text-status-success bg-white/[0.04]' : 'text-text-muted hover:text-text-secondary hover:bg-white/[0.04]'
      }`}
    >
      VPN
    </button>
  );
}

export default function InputBar({
  onSend,
  isStreaming,
  isPaused,
  onStop,
  onPause,
  onResume,
  onAddContext,
  onModelContextChange,
  claudeMode = false,
  claudeStatus = 'idle',
  onToggleClaudeMode,
  claudeModeDisabled = false,
  codexMode = false,
  codexStatus = 'idle',
  onToggleCodexMode,
  codexModeDisabled = false,
  concurrentMode = false,
  onToggleConcurrentMode,
  concurrentModeDisabled = false,
  concurrentPhase = 'idle',
  disabled = false,
  chatZoom,
  onChatZoomIn,
  onChatZoomOut,
  onChatZoomReset,
  historyOpen = false,
  onToggleHistory,
  terminalOpen = false,
  onToggleTerminal,
  docsOpen = false,
  onToggleDocs,
  filesOpen = false,
  onToggleFiles,
  onOpenSettings,
  contextPressure,
  canCompress = false,
  onCompressHistory,
}: InputBarProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [provider, setProvider] = useState<ProviderId>(DEFAULT_PROVIDER);
  const [models, setModels] = useState(() => getModelsForProvider(DEFAULT_PROVIDER));
  const [modelIdx, setModelIdx] = useState(0);
  const [modelOpen, setModelOpen] = useState(false);
  const [activeProviderMenu, setActiveProviderMenu] = useState<ProviderId | null>(null);
  const [focused, setFocused] = useState(false);
  const [compressState, setCompressState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const compressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasHydratedSelectionRef = useRef(false);
  // When the user clicks a specific model in the dropdown we set this to the
  // chosen index so the provider-change effect doesn't overwrite it with the
  // previously-stored model from settings.
  const pendingModelIdxRef = useRef<number | null>(null);

  const formatBytes = useCallback((bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  const isTextLikeFile = useCallback((file: File) => {
    if (file.type.startsWith('text/')) return true;
    return /\.(txt|md|mdx|json|js|jsx|ts|tsx|css|html|xml|csv|yml|yaml|log)$/i.test(file.name);
  }, []);

  const readFileAsDataUrl = useCallback((file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  }), []);

  const readFileAsText = useCallback((file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  }), []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (disabled || isStreaming) return;
    textareaRef.current?.focus();
  }, [disabled, isStreaming]);

  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api) return;
    api.settings.getProvider().then((selectedProvider: ProviderId) => {
      const nextProvider = selectedProvider || DEFAULT_PROVIDER;
      return api.settings.getModel(nextProvider).then((model: string) => {
        const nextModels = getModelsForProvider(nextProvider);
        const persistedModel = model || nextModels[0]?.id || '';
        setProvider(nextProvider);
        setModels(nextModels);
        const idx = nextModels.findIndex((item) => item.id === persistedModel);
        setModelIdx(idx >= 0 ? idx : 0);
        hasHydratedSelectionRef.current = true;
        if (persistedModel) onModelContextChange?.(nextProvider, persistedModel);
      });
    });
  }, [onModelContextChange]);

  useEffect(() => {
    if (!hasHydratedSelectionRef.current) return;
    const api = (window as any).clawdia;
    const nextModels = getModelsForProvider(provider);
    setModels(nextModels);

    // If the user clicked a specific model, honour that choice directly
    // instead of fetching the previously-stored model (which would overwrite it).
    if (pendingModelIdxRef.current !== null) {
      setModelIdx(pendingModelIdxRef.current);
      pendingModelIdxRef.current = null;
      return;
    }

    if (!api) {
      setModelIdx(0);
      return;
    }

    api.settings.getModel(provider).then((storedModel: string) => {
      const nextModelId = storedModel || nextModels[0]?.id || '';
      const idx = nextModels.findIndex((item) => item.id === nextModelId);
      setModelIdx(idx >= 0 ? idx : 0);
    });
  }, [provider]);

  useEffect(() => {
    const api = (window as any).clawdia;
    const model = models[modelIdx];
    if (!hasHydratedSelectionRef.current || !api || !model) return;
    api.settings.setProvider(provider);
    api.settings.setModel(provider, model.id);
    onModelContextChange?.(provider, model.id);
  }, [provider, modelIdx, models, onModelContextChange]);

  useEffect(() => {
    const handler = (e: Event) => {
      const cmd = (e as CustomEvent<string>).detail;
      setText(cmd + ' ');
      textareaRef.current?.focus();
    };
    window.addEventListener('clawdia:prefill-input', handler);
    return () => window.removeEventListener('clawdia:prefill-input', handler);
  }, []);

  useEffect(() => {
    if (!modelOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && modelSelectorRef.current?.contains(target)) return;
      setModelOpen(false);
      setActiveProviderMenu(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [modelOpen]);

  const handleSend = useCallback(() => {
    if (disabled) return;
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (isStreaming) onAddContext(trimmed);
    else onSend(trimmed, attachments, provider, models[modelIdx]?.id);
    setText('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [text, attachments, isStreaming, onSend, onAddContext, disabled, provider, models, modelIdx]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape' && isStreaming) { onStop(); }
  }, [handleSend, isStreaming, onStop]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 280) + 'px';
  }, []);

  const handlePickFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));

    // Handle image pastes as before
    if (imageItems.length > 0) {
      e.preventDefault();
      const nextAttachments = await Promise.all(imageItems.map(async (item) => {
        const file = item.getAsFile();
        if (!file) return null;
        const dataUrl = await readFileAsDataUrl(file);
        const ext = item.type.replace('image/', '') || 'png';
        const attachment: MessageAttachment = {
          id: `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'image',
          name: `pasted-image.${ext}`,
          size: file.size,
          mimeType: item.type,
          dataUrl,
        };
        return attachment;
      }));
      const valid = nextAttachments.filter((a): a is MessageAttachment => a !== null);
      if (valid.length > 0) setAttachments(prev => [...prev, ...valid]);
      return;
    }

    // Check for large plain-text paste
    const pastedText = e.clipboardData.getData('text/plain');
    if (!pastedText) return;

    const lineCount = pastedText.split('\n').length;
    const isLarge = pastedText.length > LARGE_PASTE_CHAR_THRESHOLD || lineCount > LARGE_PASTE_LINE_THRESHOLD;

    if (isLarge) {
      e.preventDefault();
      const attachment: MessageAttachment = {
        id: `paste-txt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'file',
        name: 'Pasted text.txt',
        size: new Blob([pastedText]).size,
        mimeType: 'text/plain',
        textContent: pastedText,
      };
      setAttachments(prev => [...prev, attachment]);
    }
  }, [readFileAsDataUrl]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }, []);

  const handleFilesSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const nextAttachments = await Promise.all(files.map(async (file) => {
      const isImage = file.type.startsWith('image/');
      const attachment: MessageAttachment = {
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        kind: isImage ? 'image' : 'file',
        name: file.name,
        size: file.size,
        mimeType: file.type || (isImage ? 'image/png' : 'application/octet-stream'),
        path: (file as File & { path?: string }).path,
      };

      if (isImage) {
        attachment.dataUrl = await readFileAsDataUrl(file);
      } else if (file.size <= 512_000 && isTextLikeFile(file)) {
        const textContent = await readFileAsText(file);
        attachment.textContent = textContent.slice(0, 12_000);
      }

      return attachment;
    }));

    setAttachments((prev) => [...prev, ...nextAttachments]);
    e.target.value = '';
  }, [isTextLikeFile, readFileAsDataUrl, readFileAsText]);

  const [cwd, setCwd] = useState<string>('');

  useEffect(() => {
    try {
      setCwd((process as any).cwd());
    } catch {
      setCwd('');
    }
  }, []);

  const currentModel = models[modelIdx];
  const canSend = text.trim().length > 0 || attachments.length > 0;
  const currentSelectorLabel = claudeMode
    ? 'Claude Code'
    : codexMode
      ? 'Codex'
      : concurrentMode
        ? 'Concurrent'
        : (currentModel?.label || 'Select model');
  const reversedProviders = [...PROVIDERS].reverse();

  const ensureChatMode = useCallback(async () => {
    if (claudeMode) {
      await onToggleClaudeMode?.();
      return;
    }
    if (codexMode) {
      await onToggleCodexMode?.();
    }
  }, [claudeMode, codexMode, onToggleClaudeMode, onToggleCodexMode]);

  const handleModelSelect = useCallback(async (nextProvider: ProviderId, modelId: string) => {
    await ensureChatMode();
    const nextModels = getModelsForProvider(nextProvider);
    const idx = nextModels.findIndex((m) => m.id === modelId);
    const resolvedIdx = idx >= 0 ? idx : 0;
    pendingModelIdxRef.current = resolvedIdx;
    setProvider(nextProvider);
    setModelIdx(resolvedIdx);
    setActiveProviderMenu(null);
    setModelOpen(false);
  }, [ensureChatMode]);

  const handleClaudeCodeSelect = useCallback(async () => {
    if (codexMode) await onToggleCodexMode?.();
    if (concurrentMode) await onToggleConcurrentMode?.();
    if (!claudeMode) await onToggleClaudeMode?.();
    setActiveProviderMenu(null);
    setModelOpen(false);
  }, [claudeMode, codexMode, concurrentMode, onToggleClaudeMode, onToggleCodexMode, onToggleConcurrentMode]);

  const toggleProviderSection = useCallback((providerId: ProviderId) => {
    setActiveProviderMenu((current) => current === providerId ? null : providerId);
  }, []);

  const handleCodexSelect = useCallback(async () => {
    if (claudeMode) await onToggleClaudeMode?.();
    if (concurrentMode) await onToggleConcurrentMode?.();
    if (!codexMode) await onToggleCodexMode?.();
    setActiveProviderMenu(null);
    setModelOpen(false);
  }, [claudeMode, codexMode, concurrentMode, onToggleClaudeMode, onToggleCodexMode, onToggleConcurrentMode]);

  const handleConcurrentSelect = useCallback(async () => {
    if (claudeMode) await onToggleClaudeMode?.();
    if (codexMode) await onToggleCodexMode?.();
    if (!concurrentMode) await onToggleConcurrentMode?.();
    setActiveProviderMenu(null);
    setModelOpen(false);
  }, [claudeMode, codexMode, concurrentMode, onToggleClaudeMode, onToggleCodexMode, onToggleConcurrentMode]);

  return (
    <>
    <div
      className={`w-full px-0 pb-0 pt-0${disabled ? ' opacity-50 pointer-events-none' : ''}`}
      style={{
        background: '#131313',
        borderTop: 'none',
      }}
      onPaste={handlePaste}
    >
      <div
        className={`
          relative flex w-full flex-col transition-all duration-200
          bg-[#131313]
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.mdx,.json,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"
          className="hidden"
          onChange={handleFilesSelected}
        />
        {attachments.length > 0 && (
          <div className="px-3 pt-3 pb-1 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className={`group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] ${
                  attachment.kind === 'image' ? 'w-[132px]' : 'max-w-[220px] px-3 py-2.5'
                }`}
              >
                {attachment.kind === 'image' && attachment.dataUrl ? (
                  <>
                    <img src={attachment.dataUrl} alt={attachment.name} className="block w-full h-[92px] object-cover" />
                    <div className="px-2.5 py-2">
                      <div className="text-[11px] text-text-primary truncate">{attachment.name}</div>
                      <div className="mt-0.5 text-[10px] text-text-muted">{formatBytes(attachment.size)}</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="pr-5 text-[12px] text-text-primary truncate">{attachment.name}</div>
                    <div className="mt-1 text-[11px] text-text-muted">{formatBytes(attachment.size)}</div>
                  </>
                )}
                <button
                  onClick={() => handleRemoveAttachment(attachment.id)}
                  title="Remove attachment"
                  className="absolute top-1.5 right-1.5 flex items-center justify-center w-5 h-5 rounded-full bg-black/45 text-white/70 hover:text-white hover:bg-black/65 transition-all cursor-pointer"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6L6 18" />
                    <path d="M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        {/* ── Top half: textarea + controls ── */}
        <div className="flex items-center gap-2 px-4 py-5">
          {/* Attach */}
          <button
            onClick={handlePickFiles}
            disabled={isStreaming}
            title="Attach file"
            className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md transition-all text-[18px] font-light no-drag ${
              isStreaming ? 'text-text-tertiary/35 cursor-default' : 'text-[#aaaaaa] hover:text-white hover:bg-white/[0.08] cursor-pointer'
            }`}
          >
            +
          </button>

          {/* Textarea */}
          <div className="flex-1 min-w-0">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={isStreaming ? 'Queue another message...' : 'Ask me anything...'}
              rows={1}
              disabled={disabled || isStreaming}
              className="w-full bg-transparent text-text-primary text-[18px] placeholder:text-[#888888] resize-none outline-none max-h-[280px] leading-[1.6]"
            />
          </div>

          {/* Mode indicator + dropdown */}
          <div ref={modelSelectorRef} className="relative flex items-center gap-1.5 flex-shrink-0 no-drag">
            <button
              onClick={() => {
                setModelOpen((v) => {
                  const next = !v;
                  if (!next) setActiveProviderMenu(null);
                  return next;
                });
              }}
              className="flex items-center gap-1.5 px-0 py-0 transition-colors hover:text-text-secondary cursor-pointer"
            >
              {claudeMode ? (
                <span className="text-[12px] font-medium text-white">Claude Code</span>
              ) : codexMode ? (
                <span className="text-[12px] font-medium text-white">Codex</span>
              ) : concurrentMode ? (
                <span className="text-[12px] font-medium text-white">Concurrent</span>
              ) : (
                <span className="text-[12px] font-medium text-white">{currentModel?.label || 'Select model'}</span>
              )}
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="opacity-40 text-text-muted">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {modelOpen && (
              <div className="absolute right-0 bottom-full mb-2 min-w-[210px] overflow-visible animate-fade-in z-50">
                <div className="py-1.5 bg-surface-2 border border-white/[0.08] rounded-xl shadow-xl shadow-black/50 max-h-[320px] overflow-y-auto">
                  {reversedProviders.map((prov) => {
                    const isExpanded = activeProviderMenu === prov.id;
                    return (
                      <div key={prov.id} className="relative">
                        <button
                          onClick={() => toggleProviderSection(prov.id)}
                          className="w-full flex items-center gap-2 px-3.5 pt-2 pb-2 text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted hover:bg-white/[0.04] cursor-pointer"
                        >
                          <span className="flex-1">{prov.label}</span>
                          <span className="text-[10px] text-text-muted">
                            {isExpanded ? '▾' : '▸'}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                  <div className="mx-2 my-1 h-px bg-white/[0.06]" />
                  <div>
                    <div className="px-3.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      Modes
                    </div>
                    <button
                      onClick={() => { void handleClaudeCodeSelect(); }}
                      disabled={claudeModeDisabled}
                      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-all ${
                        claudeModeDisabled
                          ? 'text-text-muted/35 cursor-default'
                          : claudeMode
                            ? 'bg-white/[0.08] cursor-pointer'
                            : 'hover:bg-white/[0.05] cursor-pointer'
                      }`}
                    >
                      <svg className="flex-shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="#f08b73" stroke="none">
                        <circle cx="12" cy="12" r="10" />
                      </svg>
                      <span className="flex-1 text-[#f08b73]">Claude Code</span>
                      {claudeMode && (
                        <svg className="text-text-secondary flex-shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                      )}
                    </button>
                    <button
                      onClick={() => { void handleCodexSelect(); }}
                      disabled={codexModeDisabled}
                      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-all ${
                        codexModeDisabled
                          ? 'text-text-muted/35 cursor-default'
                          : codexMode
                            ? 'bg-white/[0.08] cursor-pointer'
                            : 'hover:bg-white/[0.05] cursor-pointer'
                      }`}
                    >
                      <span className="flex-1 font-semibold text-white">Codex</span>
                      {codexMode && (
                        <svg className="text-text-secondary flex-shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                      )}
                    </button>
                    {!concurrentModeDisabled && (
                      <button
                        onClick={() => { void handleConcurrentSelect(); }}
                        className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-all ${
                          concurrentMode
                            ? 'bg-white/[0.08] cursor-pointer'
                            : 'hover:bg-white/[0.05] cursor-pointer'
                        }`}
                      >
                        <span className="flex-1 font-medium" style={{ color: '#a78bfa' }}>Concurrent</span>
                        {concurrentMode && (
                          <svg className="text-text-secondary flex-shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                        )}
                      </button>
                    )}
                  </div>
                </div>
                {activeProviderMenu && (
                  <div className="absolute right-full bottom-0 mr-2 py-1.5 bg-surface-2 border border-white/[0.08] rounded-xl shadow-xl shadow-black/50 min-w-[240px] max-h-[320px] overflow-y-auto animate-fade-in z-[60]">
                    <div className="px-3.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      {reversedProviders.find((prov) => prov.id === activeProviderMenu)?.label}
                    </div>
                    {MODEL_REGISTRY.filter((model) => model.provider === activeProviderMenu).map((model) => {
                      const isSelected = model.provider === provider && model.id === models[modelIdx]?.id;
                      return (
                        <button
                          key={model.id}
                          onClick={() => { void handleModelSelect(model.provider, model.id); }}
                          className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-all cursor-pointer ${
                            isSelected ? 'text-text-primary bg-white/[0.08]' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.05]'
                          }`}
                        >
                          <span className="flex-1">{model.label}</span>
                          <span className="text-[10px] text-text-muted uppercase tracking-wide">{model.tier}</span>
                          {isSelected && (
                            <svg className="text-text-secondary flex-shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Streaming controls or send */}
          <div className="flex items-center gap-2 flex-shrink-0 no-drag">
            {isStreaming ? (
              <>
                {isPaused ? (
                  <>
                    {/* Paused state: show stop + resume */}
                    <button
                      onClick={onStop}
                      title="Stop (Esc)"
                      className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.08] text-white/60 hover:bg-white/[0.14] hover:text-white transition-all cursor-pointer"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
                    </button>
                    <button
                      onClick={onResume}
                      title="Resume"
                      className="flex items-center justify-center w-8 h-8 rounded-lg bg-white text-black hover:bg-white/90 transition-all cursor-pointer"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>
                    </button>
                  </>
                ) : (
                  /* Running state: show only pause */
                  <button
                    onClick={onPause}
                    title="Pause"
                    className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.08] text-white/70 hover:bg-white/[0.14] hover:text-white transition-all cursor-pointer"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16" rx="1" /><rect x="15" y="4" width="4" height="16" rx="1" /></svg>
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                title="Send (Enter)"
                className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all cursor-pointer ${
                  canSend ? 'bg-white text-black hover:bg-white/90 shadow-sm shadow-black/20' : 'bg-white/[0.15] text-white/50 cursor-default'
                }`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="19 12 12 5 5 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="mx-0 h-px bg-white/[0.07]" />

        {/* ── Bottom footer: Compress Chat (left) + panel toggles (center) + settings (right) ── */}
        <div className="flex items-center px-4 py-2" style={{ background: '#171717', borderTop: '1px solid rgba(255,255,255,0.08)' }}>

          {/* ── Compress Chat button — bottom left, fixed width to balance settings side ── */}
          <div className="w-[120px] flex items-center">
          {(() => {
            const pct = contextPressure?.pct ?? 0;
            const isWarn = pct >= 0.75 && pct < 0.9;
            const isCritical = pct >= 0.9;
            const isBusy = compressState === 'busy';
            const isDone = compressState === 'done';
            const isError = compressState === 'error';
            const available = canCompress && !isBusy;

            let label = 'Compress Chat';
            if (isBusy) label = 'Compressing…';
            else if (isDone) label = 'Compressed';
            else if (isError) label = 'Failed';
            else if (pct > 0) label = `Compress Chat ${Math.round(pct * 100)}%`;

            let tooltip = '';
            if (!canCompress) tooltip = 'Send a few messages first';
            else if (isBusy) tooltip = 'Compressing context…';
            else if (pct > 0) tooltip = `Context ${Math.round(pct * 100)}% full — click to compress history with AI`;
            else tooltip = 'Compress conversation history with AI';

            return (
              <div className="relative group flex-shrink-0">
                <button
                  onClick={async () => {
                    if (!available || !onCompressHistory) return;
                    if (compressTimerRef.current) clearTimeout(compressTimerRef.current);
                    setCompressState('busy');
                    try {
                      const result = await onCompressHistory();
                      if (!result || !result.ok) {
                        setCompressState('error');
                      } else if (!result.compressed) {
                        setCompressState('idle');
                        return;
                      } else {
                        setCompressState('done');
                      }
                    } catch (e) {
                      console.warn('[compress] error:', e);
                      setCompressState('error');
                    }
                    compressTimerRef.current = setTimeout(() => setCompressState('idle'), 2500);
                  }}
                  disabled={!available}
                  className={`px-2 py-1 rounded-md text-[12px] font-semibold tracking-wider transition-all select-none ${
                    !canCompress
                      ? 'text-white/20 cursor-not-allowed'
                      : isError
                        ? 'text-red-400 cursor-pointer'
                        : isDone
                          ? 'text-emerald-400 cursor-pointer'
                          : isBusy
                            ? 'text-white/40 cursor-default'
                            : isCritical
                              ? 'text-red-400 animate-pulse cursor-pointer hover:text-red-300'
                              : isWarn
                                ? 'text-yellow-400 cursor-pointer hover:text-yellow-300'
                                : 'text-white/[0.32] cursor-pointer hover:text-white/60'
                  }`}
                >
                  {label}
                </button>
                {/* Custom tooltip — only renders when hoverable */}
                {canCompress && (
                  <div className="pointer-events-none absolute bottom-full left-0 mb-2 hidden group-hover:flex">
                    <div className="whitespace-nowrap rounded-md bg-[#2a2a2a] border border-white/[0.08] px-3 py-1.5 text-[11px] text-text-secondary shadow-lg">
                      {tooltip}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          </div>

          {/* ── Center: panel toggles ── */}
          <div className="flex flex-1 items-center justify-center gap-1">
            <button
              onClick={onToggleHistory}
              className={`px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-[0.08em] transition-all cursor-pointer ${
                historyOpen ? 'text-text-secondary bg-white/[0.07]' : 'text-white/[0.32] hover:text-text-muted hover:bg-white/[0.04]'
              }`}
            >
              History
            </button>
            <button
              onClick={onToggleTerminal}
              className={`px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-[0.08em] transition-all cursor-pointer ${
                terminalOpen ? 'text-text-secondary bg-white/[0.07]' : 'text-white/[0.32] hover:text-text-muted hover:bg-white/[0.04]'
              }`}
            >
              Terminal
            </button>
            <button
              onClick={onToggleDocs}
              className={`px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-[0.08em] transition-all cursor-pointer ${
                docsOpen ? 'text-text-secondary bg-white/[0.07]' : 'text-white/[0.32] hover:text-text-muted hover:bg-white/[0.04]'
              }`}
            >
              Docs
            </button>
            <button
              onClick={onToggleFiles}
              className={`px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-[0.08em] transition-all cursor-pointer ${
                filesOpen ? 'text-text-secondary bg-white/[0.07]' : 'text-white/[0.32] hover:text-text-muted hover:bg-white/[0.04]'
              }`}
            >
              Files
            </button>
            <InputVpnButton />
          </div>

          {/* ── Right: settings gear — fixed width to match Compress Chat side ── */}
          <div className="w-[120px] flex items-center justify-end">
          <button
            onClick={onOpenSettings}
            title="Settings"
            className="flex items-center justify-center w-6 h-6 rounded-md text-text-muted hover:text-text-secondary hover:bg-white/[0.06] transition-all cursor-pointer"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

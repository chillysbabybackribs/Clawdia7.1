import React, { useState, useRef, useCallback, useEffect } from 'react';
import { DEFAULT_PROVIDER, getModelsForProvider, PROVIDERS, MODEL_REGISTRY, type ProviderId } from '../../shared/model-registry';
import type { MessageAttachment } from '../../shared/types';

interface InputBarProps {
  onSend: (message: string, attachments?: MessageAttachment[]) => void;
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
  disabled?: boolean;
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
  disabled = false,
}: InputBarProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [provider, setProvider] = useState<ProviderId>(DEFAULT_PROVIDER);
  const [models, setModels] = useState(() => getModelsForProvider(DEFAULT_PROVIDER));
  const [modelIdx, setModelIdx] = useState(0);
  const [modelOpen, setModelOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasHydratedSelectionRef = useRef(false);

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
    const api = (window as any).clawdia;
    if (!api) return;
    Promise.all([
      api.settings.getProvider(),
      api.settings.getModel(),
    ]).then(([selectedProvider, model]: [ProviderId, string]) => {
      const nextProvider = selectedProvider || DEFAULT_PROVIDER;
      const nextModels = getModelsForProvider(nextProvider);
      const persistedModel = model || nextModels[0]?.id || '';
      setProvider(nextProvider);
      setModels(nextModels);
      const idx = nextModels.findIndex((item) => item.id === persistedModel);
      setModelIdx(idx >= 0 ? idx : 0);
      hasHydratedSelectionRef.current = true;
      if (persistedModel) onModelContextChange?.(nextProvider, persistedModel);
    });
  }, [onModelContextChange]);

  useEffect(() => {
    if (!hasHydratedSelectionRef.current) return;
    const api = (window as any).clawdia;
    const nextModels = getModelsForProvider(provider);
    setModels(nextModels);

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

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (isStreaming) onAddContext(trimmed);
    else onSend(trimmed, attachments);
    setText('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [text, attachments, isStreaming, onSend, onAddContext]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape' && isStreaming) { onStop(); }
  }, [handleSend, isStreaming, onStop]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  const handlePickFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

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

  const currentModel = models[modelIdx];
  const canSend = text.trim().length > 0 || attachments.length > 0;

  return (
    <div
      className={`px-5 pb-5 pt-4${disabled ? ' opacity-50 pointer-events-none' : ''}`}
      style={{
        background: '#0d0d12',
        borderTop: '2px solid rgba(255,255,255,0.07)',
        boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.3)',
      }}
    >
      {!isStreaming && (
        <div className="no-drag flex items-center gap-2 pb-2 px-1 relative">
          <button
            onClick={() => setModelOpen((v) => !v)}
            className="flex items-center gap-1 text-[14px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
          >
            {currentModel?.label || 'Select model'}
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="opacity-40">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {modelOpen && (
            <div className="absolute bottom-full left-0 mb-2 py-1.5 bg-[#2a2a33]/95 backdrop-blur-md border border-white/[0.10] rounded-xl shadow-xl shadow-black/50 min-w-[210px] animate-fade-in z-50">
              {PROVIDERS.map((prov) => {
                const provModels = MODEL_REGISTRY.filter((m) => m.provider === prov.id);
                return (
                  <div key={prov.id}>
                    <div className="px-3.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                      {prov.label}
                    </div>
                    {provModels.map((model) => {
                      const isSelected = model.provider === provider && model.id === models[modelIdx]?.id;
                      return (
                        <button
                          key={model.id}
                          onClick={() => {
                            setProvider(model.provider);
                            const nextModels = getModelsForProvider(model.provider);
                            const idx = nextModels.findIndex((m) => m.id === model.id);
                            setModelIdx(idx >= 0 ? idx : 0);
                            setModelOpen(false);
                          }}
                          className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[15px] transition-all cursor-pointer ${
                            isSelected ? 'text-white bg-white/[0.08]' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.05]'
                          }`}
                        >
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${model.tier === 'deep' ? 'bg-amber-400' : model.tier === 'balanced' ? 'bg-[#8ab4f8]' : 'bg-emerald-400'}`} />
                          <span>{model.label}</span>
                          {isSelected && (
                            <svg className="ml-auto text-[#8ab4f8] flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ width: '1px', height: '10px', background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

          <button
            onClick={onToggleClaudeMode}
            disabled={claudeModeDisabled}
            className={`flex items-center gap-1 text-[14px] transition-colors ${
              claudeMode
                ? 'text-amber-300 cursor-pointer'
                : claudeModeDisabled
                  ? 'text-text-tertiary/35 cursor-default'
                  : 'text-text-tertiary hover:text-text-secondary cursor-pointer'
            }`}
            title={claudeModeDisabled ? 'Create or open a conversation first' : 'Toggle Claude terminal mode for this conversation'}
          >
            <span>Claude Code</span>
            {claudeMode && (
              <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                {claudeStatus}
              </span>
            )}
          </button>

          <div style={{ width: '1px', height: '10px', background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

          <button
            onClick={onToggleCodexMode}
            disabled={codexModeDisabled}
            className={`flex items-center gap-1 text-[14px] transition-colors ${
              codexMode
                ? 'text-emerald-300 cursor-pointer'
                : codexModeDisabled
                  ? 'text-text-tertiary/35 cursor-default'
                  : 'text-text-tertiary hover:text-text-secondary cursor-pointer'
            }`}
            title={codexModeDisabled ? 'Create or open a conversation first' : 'Toggle Codex mode for this conversation'}
          >
            <span>Codex</span>
            {codexMode && (
              <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                {codexStatus}
              </span>
            )}
          </button>
        </div>
      )}

      <div
        className={`
          relative flex flex-col rounded-xl transition-all duration-200
          bg-[#18181c] border
          border-[1.5px] transition-colors duration-200
          ${focused
            ? 'border-[#a0a0ad] shadow-[inset_0_1px_4px_rgba(0,0,0,0.2),0_-2px_8px_rgba(0,0,0,0.25),0_0_0_1px_rgba(160,160,173,0.15)]'
            : 'border-[#7a7a85] shadow-[inset_0_1px_4px_rgba(0,0,0,0.2),0_-2px_8px_rgba(0,0,0,0.25)]'
          }
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
        <div className="flex items-center px-4 py-3 gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={isStreaming ? 'Add a follow-up...' : 'Ask me anything...'}
            rows={1}
            disabled={disabled || isStreaming}
            className="flex-1 bg-transparent text-text-primary text-[21px] placeholder:text-text-tertiary px-3 py-3 resize-none outline-none max-h-[200px] leading-[1.6]"
          />

          <div className="flex items-center gap-1.5 no-drag relative flex-shrink-0">
            <button
              onClick={handlePickFiles}
              disabled={isStreaming}
              title="Attach file"
              className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all no-drag ${
                isStreaming
                  ? 'text-text-tertiary/35 cursor-default'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-white/[0.05] cursor-pointer'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            {isStreaming ? (
              <>
                <button
                  onClick={isPaused ? onResume : onPause}
                  title={isPaused ? 'Resume' : 'Pause'}
                  className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all cursor-pointer ${
                    isPaused ? 'bg-[#8ab4f8]/15 text-[#8ab4f8] hover:bg-[#8ab4f8]/25' : 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                  }`}
                >
                  {isPaused ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16" rx="1" /><rect x="15" y="4" width="4" height="16" rx="1" /></svg>
                  )}
                </button>

                {canSend && (
                  <button onClick={handleSend} title="Add context" className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#8ab4f8]/15 text-[#8ab4f8] hover:bg-[#8ab4f8]/25 transition-all cursor-pointer">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                )}

                <button onClick={onStop} title="Stop (Esc)" className="flex items-center justify-center w-9 h-9 rounded-lg bg-red-500/12 text-red-400 hover:bg-red-500/20 transition-all cursor-pointer">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                </button>
              </>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                title="Send (Enter)"
                className={`
                  flex items-center justify-center w-10 h-10 rounded-full transition-all cursor-pointer
                  ${canSend
                    ? 'bg-white text-[#18181c] hover:bg-white/90 shadow-sm shadow-black/20'
                    : 'bg-white/[0.10] text-white/30 cursor-default'
                  }
                `}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import type { PolicyProfile, PerformanceStance } from '../../shared/types';
import { DEFAULT_MODEL_BY_PROVIDER, DEFAULT_PROVIDER, getModelsForProvider, PROVIDERS, type ProviderId } from '../../shared/model-registry';
import IdentitySection from './IdentitySection';

interface SettingsViewProps {
  onBack: () => void;
}

export default function SettingsView({ onBack: _onBack }: SettingsViewProps) {
  const [providerKeys, setProviderKeys] = useState<Record<ProviderId, string>>({ anthropic: '', openai: '', gemini: '' });
  const [keyVisible, setKeyVisible] = useState<Record<ProviderId, boolean>>({ anthropic: false, openai: false, gemini: false });
  const [saved, setSaved] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(DEFAULT_PROVIDER);
  const [modelsByProvider, setModelsByProvider] = useState<Record<ProviderId, string>>({ ...DEFAULT_MODEL_BY_PROVIDER });
  const [unrestrictedMode, setUnrestrictedMode] = useState(false);
  const [policyProfiles, setPolicyProfiles] = useState<PolicyProfile[]>([]);
  const [selectedPolicyProfile, setSelectedPolicyProfile] = useState('standard');
  const [performanceStance, setPerformanceStance] = useState<PerformanceStance>('standard');

  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api) return;
    Promise.all([
      api.settings.getProviderKeys(),
      api.settings.getProvider(),
      Promise.all(PROVIDERS.map((provider) => api.settings.getModel(provider.id))),
      api.settings.getUnrestrictedMode(),
      api.settings.getPolicyProfile(),
      api.settings.getPerformanceStance(),
      api.policy.list(),
    ]).then(([keys, provider, models, unrestricted, policyProfile, stance, profiles]: [
      Record<ProviderId, string>,
      ProviderId,
      string[],
      boolean,
      string,
      PerformanceStance,
      PolicyProfile[],
    ]) => {
      setProviderKeys(keys || { anthropic: '', openai: '', gemini: '' });
      setSelectedProvider(provider || DEFAULT_PROVIDER);
      setModelsByProvider({
        anthropic: models[0] || DEFAULT_MODEL_BY_PROVIDER.anthropic,
        openai: models[1] || DEFAULT_MODEL_BY_PROVIDER.openai,
        gemini: models[2] || DEFAULT_MODEL_BY_PROVIDER.gemini,
      });
      setUnrestrictedMode(!!unrestricted);
      setSelectedPolicyProfile(policyProfile || 'standard');
      setPerformanceStance(stance || 'standard');
      setPolicyProfiles(profiles || []);
    });
  }, []);

  const handleSave = async () => {
    const api = (window as any).clawdia;
    if (!api) return;

    for (const provider of PROVIDERS) {
      await api.settings.setApiKey(provider.id, providerKeys[provider.id] || '');
      await api.settings.setModel(provider.id, modelsByProvider[provider.id] || DEFAULT_MODEL_BY_PROVIDER[provider.id]);
    }

    await api.settings.setProvider(selectedProvider);
    await api.settings.setUnrestrictedMode(unrestrictedMode);
    await api.settings.setPolicyProfile(selectedPolicyProfile);
    await api.settings.setPerformanceStance(performanceStance);

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const hasKey = Object.values(providerKeys).some(Boolean);
  const currentModels = getModelsForProvider(selectedProvider);
  const activeKey = providerKeys[selectedProvider] || '';
  const sectionCardClass = 'flex flex-col gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4';

  return (
    <div className="flex flex-col h-full bg-surface-0">
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto grid w-full max-w-[980px] grid-cols-1 gap-6 xl:grid-cols-2">
          {hasKey && (
            <div className="xl:col-span-2 flex items-center gap-1.5 text-2xs text-status-success">
              <div className="w-1.5 h-1.5 rounded-full bg-status-success" />
              API connected
            </div>
          )}
          <section className={sectionCardClass}>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">Provider</label>
            <div className="grid grid-cols-3 gap-2">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => setSelectedProvider(provider.id)}
                  className={`h-[38px] rounded-xl border text-xs transition-colors cursor-pointer ${
                    selectedProvider === provider.id
                      ? 'border-accent/40 bg-accent/10 text-text-primary'
                      : 'border-border bg-surface-2 text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {provider.label}
                </button>
              ))}
            </div>
          </section>

          <section className={sectionCardClass}>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">API Key</label>
            <div className="relative">
              <input
                type={keyVisible[selectedProvider] ? 'text' : 'password'}
                value={activeKey}
                onChange={(e) => setProviderKeys((prev) => ({ ...prev, [selectedProvider]: e.target.value }))}
                placeholder={selectedProvider === 'anthropic' ? 'sk-ant-...' : selectedProvider === 'openai' ? 'sk-...' : 'AIza...'}
                className="w-full h-[38px] bg-surface-2 text-text-primary text-sm font-mono pl-3 pr-10 rounded-lg border border-border placeholder:text-text-muted outline-none focus:border-accent/40 transition-colors"
              />
              <button onClick={() => setKeyVisible((prev) => ({ ...prev, [selectedProvider]: !prev[selectedProvider] }))} className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded text-text-muted hover:text-text-secondary transition-colors cursor-pointer">
                {keyVisible[selectedProvider] ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                )}
              </button>
            </div>
            <p className="text-2xs text-text-muted">Stored locally with encryption. Each provider keeps its own key. The selected provider is used for new runs.</p>
          </section>

          <section className={`${sectionCardClass} h-[320px]`}>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">Default Model</label>
            <p className="text-2xs text-text-muted -mt-1">Choose the default model for the currently selected provider.</p>
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
              {currentModels.map((model) => (
                <label
                  key={model.id}
                  className={`flex items-start px-3 py-2.5 rounded-xl border transition-colors cursor-pointer ${
                    modelsByProvider[selectedProvider] === model.id
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-transparent hover:border-white/[0.08] hover:bg-white/[0.02]'
                  }`}
                >
                  <input
                    type="radio"
                    name="model"
                    value={model.id}
                    checked={modelsByProvider[selectedProvider] === model.id}
                    onChange={() => setModelsByProvider((prev) => ({ ...prev, [selectedProvider]: model.id }))}
                    className="sr-only"
                  />
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-primary">{model.label}</span>
                    </div>
                    <span className="text-2xs text-text-muted">{model.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </section>

          <section className={sectionCardClass}>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">Execution Guardrails</label>
            <label
              className={`flex items-start px-3 py-3 rounded-xl border transition-colors cursor-pointer ${
                unrestrictedMode
                  ? 'border-accent/40 bg-accent/10'
                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.08] hover:bg-white/[0.03]'
              }`}
            >
              <input
                type="checkbox"
                checked={unrestrictedMode}
                onChange={(e) => setUnrestrictedMode(e.target.checked)}
                className="sr-only"
              />
              <div className="flex flex-col gap-1">
                <span className="text-sm text-text-primary">Unrestricted mode</span>
                <span className="text-2xs text-text-muted">
                  Bypass approval checkpoints entirely. Clawdia will execute sensitive actions without pausing.
                </span>
              </div>
            </label>
          </section>

          <section className={sectionCardClass}>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">Policy Profile</label>
            <p className="text-2xs text-text-muted -mt-1">Controls when Clawdia allows, blocks, or pauses for approval before execution.</p>
            <div className="flex flex-col gap-1">
              {policyProfiles.map(profile => (
                <label
                  key={profile.id}
                  className={`flex items-start px-3 py-2.5 rounded-xl border transition-colors cursor-pointer ${
                    selectedPolicyProfile === profile.id
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-transparent hover:border-white/[0.08] hover:bg-white/[0.02]'
                  }`}
                >
                  <input
                    type="radio"
                    name="policy-profile"
                    value={profile.id}
                    checked={selectedPolicyProfile === profile.id}
                    onChange={() => setSelectedPolicyProfile(profile.id)}
                    className="sr-only"
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-text-primary">{profile.name}</span>
                    <span className="text-2xs text-text-muted">{profile.rules.length} rules</span>
                  </div>
                </label>
              ))}
            </div>
          </section>

          <section className={sectionCardClass}>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">Performance Stance</label>
            <p className="text-2xs text-text-muted -mt-1">Controls how aggressively Clawdia searches, batches, and pushes work forward by default.</p>
            <div className="flex flex-col gap-1">
              {[
                { id: 'conservative', label: 'Conservative', desc: 'Smaller changes, tighter review, earlier pause points' },
                { id: 'standard', label: 'Standard', desc: 'Balanced behavior for normal day-to-day work' },
                { id: 'aggressive', label: 'Aggressive', desc: 'Broader search, bigger swings, less hand-holding' },
              ].map(option => (
                <label
                  key={option.id}
                  className={`flex items-start px-3 py-2.5 rounded-xl border transition-colors cursor-pointer ${
                    performanceStance === option.id
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-transparent hover:border-white/[0.08] hover:bg-white/[0.02]'
                  }`}
                >
                  <input
                    type="radio"
                    name="performance-stance"
                    value={option.id}
                    checked={performanceStance === option.id}
                    onChange={() => setPerformanceStance(option.id as PerformanceStance)}
                    className="sr-only"
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-text-primary">{option.label}</span>
                    <span className="text-2xs text-text-muted">{option.desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </section>

          <div className="xl:col-span-2">
            <div className="h-px bg-border-subtle mb-6" />
            <IdentitySection />
          </div>
        </div>
      </div>
      <div className="sticky bottom-0 flex-shrink-0 border-t border-border-subtle bg-surface-0/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto w-full max-w-[980px]">
          <button
            onClick={handleSave}
            className={`h-[38px] w-full rounded-xl text-sm font-medium transition-all cursor-pointer ${saved ? 'bg-status-success/20 text-status-success' : 'bg-accent/90 hover:bg-accent text-white'}`}
          >
            {saved ? 'Saved ✓' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

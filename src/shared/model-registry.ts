export type ProviderId = 'anthropic' | 'openai' | 'gemini';

export interface ModelOption {
  id: string;
  provider: ProviderId;
  label: string;
  family: string;
  tier: 'fast' | 'balanced' | 'deep';
  description: string;
}

export const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'gemini', label: 'Google Gemini' },
];

export const MODEL_REGISTRY: ModelOption[] = [
  {
    id: 'claude-opus-4-6',
    provider: 'anthropic',
    label: 'Claude Opus 4.6',
    family: 'Claude',
    tier: 'deep',
    description: 'Most capable for architecture, review, and deep reasoning.',
  },
  {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    label: 'Claude Sonnet 4.6',
    family: 'Claude',
    tier: 'balanced',
    description: 'Balanced default for day-to-day coding and execution.',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    label: 'Claude Haiku 4.5',
    family: 'Claude',
    tier: 'fast',
    description: 'Fastest Claude option for lightweight work.',
  },
  {
    id: 'gpt-5.4',
    provider: 'openai',
    label: 'GPT-5.4',
    family: 'GPT',
    tier: 'deep',
    description: 'Current OpenAI flagship for agentic, coding, and professional workflows.',
  },
  {
    id: 'gpt-5.4-mini',
    provider: 'openai',
    label: 'GPT-5.4 Mini',
    family: 'GPT',
    tier: 'balanced',
    description: 'Balanced GPT-5.4 class model for coding and subagents.',
  },
  {
    id: 'gpt-5.4-nano',
    provider: 'openai',
    label: 'GPT-5.4 Nano',
    family: 'GPT',
    tier: 'fast',
    description: 'Fastest, cheapest GPT-5.4 model for simple high-volume tasks.',
  },
  {
    id: 'gpt-5',
    provider: 'openai',
    label: 'GPT-5',
    family: 'GPT',
    tier: 'deep',
    description: 'OpenAI GPT-5 flagship (Aug 2025).',
  },
  {
    id: 'gpt-5-mini',
    provider: 'openai',
    label: 'GPT-5 Mini',
    family: 'GPT',
    tier: 'balanced',
    description: 'GPT-5 balanced model.',
  },
  {
    id: 'gpt-5-nano',
    provider: 'openai',
    label: 'GPT-5 Nano',
    family: 'GPT',
    tier: 'fast',
    description: 'GPT-5 fast/lightweight model.',
  },
  {
    id: 'gpt-4.1',
    provider: 'openai',
    label: 'GPT-4.1',
    family: 'GPT',
    tier: 'deep',
    description: 'Strong coding and instruction-following model (Apr 2025).',
  },
  {
    id: 'gpt-4.1-mini',
    provider: 'openai',
    label: 'GPT-4.1 Mini',
    family: 'GPT',
    tier: 'balanced',
    description: 'Fast and cost-efficient GPT-4.1 variant.',
  },
  {
    id: 'gpt-4.1-nano',
    provider: 'openai',
    label: 'GPT-4.1 Nano',
    family: 'GPT',
    tier: 'fast',
    description: 'Smallest, fastest GPT-4.1 variant.',
  },
  {
    id: 'o3',
    provider: 'openai',
    label: 'o3',
    family: 'Reasoning',
    tier: 'deep',
    description: 'OpenAI o3 reasoning model for complex multi-step problems.',
  },
  {
    id: 'o4-mini',
    provider: 'openai',
    label: 'o4-mini',
    family: 'Reasoning',
    tier: 'balanced',
    description: 'Fast reasoning model, strong at coding and math.',
  },
  {
    id: 'o3-mini',
    provider: 'openai',
    label: 'o3-mini',
    family: 'Reasoning',
    tier: 'fast',
    description: 'Compact reasoning model for cost-efficient inference.',
  },
  {
    id: 'gemini-2.5-pro',
    provider: 'gemini',
    label: 'Gemini 2.5 Pro',
    family: 'Gemini',
    tier: 'deep',
    description: 'Top Gemini model for complex reasoning and coding.',
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash',
    family: 'Gemini',
    tier: 'balanced',
    description: 'Balanced Gemini default with strong tool use support.',
  },
  {
    id: 'gemini-2.5-flash-lite',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash-Lite',
    family: 'Gemini',
    tier: 'fast',
    description: 'Most cost-efficient Gemini option for lightweight tasks.',
  },
  {
    id: 'gemini-3-pro-preview',
    provider: 'gemini',
    label: 'Gemini 3 Pro (Preview)',
    family: 'Gemini',
    tier: 'deep',
    description: 'Next-gen Gemini flagship, preview access only.',
  },
  {
    id: 'gemini-3-flash-preview',
    provider: 'gemini',
    label: 'Gemini 3 Flash (Preview)',
    family: 'Gemini',
    tier: 'balanced',
    description: 'Next-gen Gemini fast model, preview access only.',
  },
];

export const DEFAULT_PROVIDER: ProviderId = 'anthropic';

export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5.4',
  gemini: 'gemini-2.5-flash',
};

export function getModelsForProvider(provider: ProviderId): ModelOption[] {
  return MODEL_REGISTRY.filter((model) => model.provider === provider);
}

export function getModelById(modelId: string): ModelOption | undefined {
  return MODEL_REGISTRY.find((model) => model.id === modelId);
}

/**
 * Resolve the best model ID for a given task tier and provider.
 *
 * - 'fast'     → provider's cheapest/fastest model (Haiku, nano, Flash-Lite)
 * - 'standard' → provider's balanced model (Sonnet, mini, Flash)
 * - 'powerful' → the user's explicitly configured model (respect their choice)
 *
 * Falls back to the user's configured model if no match is found for the tier.
 */
export function resolveModelForTier(
  tier: 'fast' | 'standard' | 'powerful',
  provider: ProviderId,
  configuredModel: string,
): string {
  if (tier === 'powerful') return configuredModel;

  const providerModels = getModelsForProvider(provider);

  const apiTier = tier === 'fast' ? 'fast' : 'balanced';
  const match = providerModels.find((m) => m.tier === apiTier);

  // If the user's configured model is already at or below the desired tier,
  // use it directly — no point downgrading unnecessarily.
  const configured = getModelById(configuredModel);
  if (configured) {
    const tierRank: Record<ModelOption['tier'], number> = { fast: 0, balanced: 1, deep: 2 };
    if (tierRank[configured.tier] <= tierRank[apiTier]) return configuredModel;
  }

  return match?.id ?? configuredModel;
}

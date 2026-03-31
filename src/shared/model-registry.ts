export type ProviderId = 'anthropic' | 'openai' | 'gemini';

export interface ModelOption {
  id: string;
  provider: ProviderId;
  label: string;
  family: string;
  tier: 'fast' | 'balanced' | 'deep';
  description: string;
  /**
   * Whether the model supports extended thinking (budget_tokens / thinking blocks).
   * Anthropic: Opus 4+, Sonnet 4+, claude-3-7. OpenAI/Gemini: false.
   */
  supportsExtendedThinking: boolean;
  /**
   * Whether server-side tool callers (web_search, web_fetch) must be restricted
   * to allowed_callers: ['direct'] due to the model not supporting programmatic
   * tool calling for those tools.
   * Anthropic: Haiku 4.5. All others: false.
   */
  restrictServerToolCallers: boolean;
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
    supportsExtendedThinking: true,
    restrictServerToolCallers: false,
  },
  {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    label: 'Claude Sonnet 4.6',
    family: 'Claude',
    tier: 'balanced',
    description: 'Balanced default for day-to-day coding and execution.',
    supportsExtendedThinking: true,
    restrictServerToolCallers: false,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    label: 'Claude Haiku 4.5',
    family: 'Claude',
    tier: 'fast',
    description: 'Fastest Claude option for lightweight work.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: true,
  },
  {
    id: 'gpt-5.4',
    provider: 'openai',
    label: 'GPT-5.4',
    family: 'GPT',
    tier: 'deep',
    description: 'Current OpenAI flagship for agentic, coding, and professional workflows.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'gpt-5.4-mini',
    provider: 'openai',
    label: 'GPT-5.4 Mini',
    family: 'GPT',
    tier: 'balanced',
    description: 'Balanced GPT-5.4 class model for coding and subagents.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'gpt-5.4-nano',
    provider: 'openai',
    label: 'GPT-5.4 Nano',
    family: 'GPT',
    tier: 'fast',
    description: 'Fastest, cheapest GPT-5.4 model for simple high-volume tasks.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'gpt-5',
    provider: 'openai',
    label: 'GPT-5',
    family: 'GPT',
    tier: 'deep',
    description: 'OpenAI GPT-5 flagship (Aug 2025).',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'gpt-5-mini',
    provider: 'openai',
    label: 'GPT-5 Mini',
    family: 'GPT',
    tier: 'balanced',
    description: 'GPT-5 balanced model.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'gpt-5-nano',
    provider: 'openai',
    label: 'GPT-5 Nano',
    family: 'GPT',
    tier: 'fast',
    description: 'GPT-5 fast/lightweight model.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'gpt-4.1',
    provider: 'openai',
    label: 'GPT-4.1',
    family: 'GPT',
    tier: 'deep',
    description: 'Strong coding and instruction-following model (Apr 2025).',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'gpt-4.1-mini',
    provider: 'openai',
    label: 'GPT-4.1 Mini',
    family: 'GPT',
    tier: 'balanced',
    description: 'Fast and cost-efficient GPT-4.1 variant.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'gpt-4.1-nano',
    provider: 'openai',
    label: 'GPT-4.1 Nano',
    family: 'GPT',
    tier: 'fast',
    description: 'Smallest, fastest GPT-4.1 variant.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'o3',
    provider: 'openai',
    label: 'o3',
    family: 'Reasoning',
    tier: 'deep',
    description: 'OpenAI o3 reasoning model for complex multi-step problems.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'o4-mini',
    provider: 'openai',
    label: 'o4-mini',
    family: 'Reasoning',
    tier: 'balanced',
    description: 'Fast reasoning model, strong at coding and math.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'o3-mini',
    provider: 'openai',
    label: 'o3-mini',
    family: 'Reasoning',
    tier: 'fast',
    description: 'Compact reasoning model for cost-efficient inference.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'gemini-2.5-pro',
    provider: 'gemini',
    label: 'Gemini 2.5 Pro',
    family: 'Gemini',
    tier: 'deep',
    description: 'Top Gemini model for complex reasoning and coding.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash',
    family: 'Gemini',
    tier: 'balanced',
    description: 'Balanced Gemini default with strong tool use support.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'gemini-2.5-flash-lite',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash-Lite',
    family: 'Gemini',
    tier: 'fast',
    description: 'Most cost-efficient Gemini option for lightweight tasks.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'gemini-3-pro-preview',
    provider: 'gemini',
    label: 'Gemini 3 Pro (Preview)',
    family: 'Gemini',
    tier: 'deep',
    description: 'Next-gen Gemini flagship, preview access only.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
  },
  {
    id: 'gemini-3-flash-preview',
    provider: 'gemini',
    label: 'Gemini 3 Flash (Preview)',
    family: 'Gemini',
    tier: 'balanced',
    description: 'Next-gen Gemini fast model, preview access only.',
    supportsExtendedThinking: false,
    restrictServerToolCallers: false,
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
 * Check a capability flag for a model ID.
 * Falls back to `false` for unrecognised model IDs (safe default).
 */
export function modelHasCapability(
  modelId: string,
  capability: 'supportsExtendedThinking' | 'restrictServerToolCallers',
): boolean {
  return getModelById(modelId)?.[capability] ?? false;
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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI, Type } from '@google/genai';
import type { ProviderId } from '../../../shared/model-registry';
import { DEFAULT_MODEL_BY_PROVIDER, DEFAULT_PROVIDER } from '../../../shared/model-registry';

export interface HybridAssistantConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
}

export interface HybridProposalResult {
  label: string;
  role: string;
  x: number;
  y: number;
  confidence: number;
  reason: string;
}

export interface HybridValidationResult {
  status: 'exact' | 'adjust' | 'wrong_target';
  dx: number;
  dy: number;
  confidence: number;
  reason: string;
  role?: string;
}

const SETTINGS_FILE_CANDIDATES = ['clawdia7', 'Clawdia', 'clawdia'].map((name) =>
  path.join(os.homedir(), '.config', name, 'clawdia-settings.json'),
);

const OPENAI_COORDINATE_SCHEMA = {
  name: 'coordinate_result',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      label: { type: 'string' },
      role: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
      confidence: { type: 'number' },
      reason: { type: 'string' },
      status: { type: 'string' },
      dx: { type: 'number' },
      dy: { type: 'number' },
    },
    additionalProperties: false,
  },
} as const;

const GEMINI_PROPOSAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    label: { type: Type.STRING },
    role: { type: Type.STRING },
    x: { type: Type.NUMBER },
    y: { type: Type.NUMBER },
    confidence: { type: Type.NUMBER },
    reason: { type: Type.STRING },
  },
  required: ['label', 'role', 'x', 'y', 'confidence', 'reason'],
};

const GEMINI_VALIDATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    status: { type: Type.STRING, enum: ['exact', 'adjust', 'wrong_target'] },
    dx: { type: Type.NUMBER },
    dy: { type: Type.NUMBER },
    confidence: { type: Type.NUMBER },
    reason: { type: Type.STRING },
    role: { type: Type.STRING },
  },
  required: ['status', 'dx', 'dy', 'confidence', 'reason'],
};

function normalizeProvider(raw?: string): ProviderId {
  if (raw === 'anthropic' || raw === 'openai' || raw === 'gemini') return raw;
  return DEFAULT_PROVIDER;
}

function tryReadSettingsFile(): { provider?: ProviderId; models?: Record<string, string>; providerKeys?: Record<string, string> } {
  const settingsPath = SETTINGS_FILE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!settingsPath) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      provider?: ProviderId;
      models?: Record<string, string>;
      providerKeys?: Record<string, string>;
    };
  } catch {
    return {};
  }
}

export function resolveHybridAssistantConfig(
  providerArg?: string,
  modelArg?: string,
): HybridAssistantConfig {
  const settings = tryReadSettingsFile();
  const provider = normalizeProvider(providerArg ?? process.env.HYBRID_MAPPER_PROVIDER ?? settings.provider);
  const model = modelArg
    ?? process.env.HYBRID_MAPPER_MODEL
    ?? settings.models?.[provider]
    ?? DEFAULT_MODEL_BY_PROVIDER[provider];

  const envKeyByProvider: Record<ProviderId, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  };
  const apiKey = envKeyByProvider[provider] ?? settings.providerKeys?.[provider] ?? '';
  if (!apiKey) {
    throw new Error(`No API key configured for ${provider}. Set the environment variable or configure it in Clawdia settings.`);
  }

  return { provider, model, apiKey };
}

function encodeScreenshot(screenshotPath: string): { mimeType: string; base64: string } {
  const base64 = fs.readFileSync(screenshotPath).toString('base64');
  const ext = path.extname(screenshotPath).toLowerCase();
  const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return { mimeType, base64 };
}

function parseJsonObject<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;
  return JSON.parse(candidate) as T;
}

async function callOpenAI<T>(config: HybridAssistantConfig, prompt: string, screenshotPath: string): Promise<T> {
  const client = new OpenAI({ apiKey: config.apiKey });
  const { mimeType, base64 } = encodeScreenshot(screenshotPath);
  const response = await client.responses.create({
    model: config.model,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: `data:${mimeType};base64,${base64}`, detail: 'high' },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        ...OPENAI_COORDINATE_SCHEMA,
      },
    },
  });
  const text = response.output_text?.trim();
  if (!text) throw new Error('OpenAI returned no text output');
  return parseJsonObject<T>(text);
}

async function callAnthropic<T>(config: HybridAssistantConfig, prompt: string, screenshotPath: string): Promise<T> {
  const client = new Anthropic({ apiKey: config.apiKey });
  const { mimeType, base64 } = encodeScreenshot(screenshotPath);
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 800,
    temperature: 0,
    system: 'You are a desktop GUI coordinate mapper. Return JSON only with no markdown fences.',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
              data: base64,
            },
          },
        ],
      },
    ],
  });
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Anthropic returned no text output');
  return parseJsonObject<T>(text);
}

async function callGemini<T>(
  config: HybridAssistantConfig,
  prompt: string,
  screenshotPath: string,
  schema: {
    type: Type;
    properties: Record<string, unknown>;
    required: string[];
  },
): Promise<T> {
  const client = new GoogleGenAI({ apiKey: config.apiKey });
  const { mimeType, base64 } = encodeScreenshot(screenshotPath);
  const response = await client.models.generateContent({
    model: config.model,
    config: {
      systemInstruction: 'You are a desktop GUI coordinate mapper. Return JSON only.',
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
  });
  const text = response.text?.trim();
  if (!text) throw new Error('Gemini returned no text output');
  return parseJsonObject<T>(text);
}

function coerceProposal(input: HybridProposalResult): HybridProposalResult {
  return {
    label: String(input.label ?? ''),
    role: String(input.role ?? 'unknown'),
    x: Math.round(Number(input.x ?? 0)),
    y: Math.round(Number(input.y ?? 0)),
    confidence: Number(input.confidence ?? 0),
    reason: String(input.reason ?? ''),
  };
}

function coerceValidation(input: HybridValidationResult): HybridValidationResult {
  const status = input.status === 'exact' || input.status === 'adjust' || input.status === 'wrong_target'
    ? input.status
    : 'wrong_target';
  return {
    status,
    dx: Math.round(Number(input.dx ?? 0)),
    dy: Math.round(Number(input.dy ?? 0)),
    confidence: Number(input.confidence ?? 0),
    reason: String(input.reason ?? ''),
    role: input.role ? String(input.role) : undefined,
  };
}

export async function requestCoordinateProposal(
  config: HybridAssistantConfig,
  prompt: string,
  screenshotPath: string,
): Promise<HybridProposalResult> {
  if (config.provider === 'openai') return coerceProposal(await callOpenAI<HybridProposalResult>(config, prompt, screenshotPath));
  if (config.provider === 'anthropic') return coerceProposal(await callAnthropic<HybridProposalResult>(config, prompt, screenshotPath));
  return coerceProposal(await callGemini<HybridProposalResult>(config, prompt, screenshotPath, GEMINI_PROPOSAL_SCHEMA));
}

export async function requestCoordinateValidation(
  config: HybridAssistantConfig,
  prompt: string,
  screenshotPath: string,
): Promise<HybridValidationResult> {
  if (config.provider === 'openai') return coerceValidation(await callOpenAI<HybridValidationResult>(config, prompt, screenshotPath));
  if (config.provider === 'anthropic') return coerceValidation(await callAnthropic<HybridValidationResult>(config, prompt, screenshotPath));
  return coerceValidation(await callGemini<HybridValidationResult>(config, prompt, screenshotPath, GEMINI_VALIDATION_SCHEMA));
}

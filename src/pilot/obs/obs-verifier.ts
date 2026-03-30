// src/pilot/obs/obs-verifier.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import { OBS_PILOT_CONFIG } from './obs-config';
import type { VerifyResult } from './obs-types';

const SYSTEM_PROMPT =
  'You are verifying OBS Studio UI state from screenshots. ' +
  'Answer only with valid JSON matching the schema. Be precise and concise.';

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verdict:    { type: Type.STRING, enum: ['ok', 'ambiguous', 'failed'] },
    confidence: { type: Type.NUMBER },
    reason:     { type: Type.STRING },
  },
  required: ['verdict', 'confidence', 'reason'],
};

/** Pure helpers — exported for unit tests. */
export function shouldEscalate(result: VerifyResult, threshold: number): boolean {
  return result.confidence < threshold;
}

export function pickVerdict(result: VerifyResult): boolean {
  return result.verdict === 'ok';
}

function loadGeminiKey(): string {
  // 1. Environment variable (for harness / Node context)
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  // 2. Clawdia settings file (works both in Electron and Node if path is known)
  // Try known Electron userData paths (app name varies by version)
  const candidates = ['clawdia7', 'Clawdia', 'clawdia'].map(
    (name) => path.join(os.homedir(), '.config', name, 'clawdia-settings.json'),
  );
  const settingsPath = candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw) as { providerKeys?: { gemini?: string } };
    if (parsed.providerKeys?.gemini) return parsed.providerKeys.gemini;
  } catch {
    // fall through
  }
  return '';
}

async function callGemini(
  modelId: string,
  postcondition: string,
  screenshotB64: string,
  priorReason?: string,
): Promise<VerifyResult> {
  const apiKey = loadGeminiKey();
  if (!apiKey) throw new Error('Gemini API key not found — set GEMINI_API_KEY env var or configure it in Clawdia settings');

  const ai = new GoogleGenAI({ apiKey });

  const promptText = priorReason
    ? `Postcondition to verify: "${postcondition}"\n\nPrevious analysis (low confidence): "${priorReason}"\n\nGive your authoritative verdict.`
    : `Postcondition to verify: "${postcondition}"\n\nDoes the screenshot satisfy this postcondition?`;

  const result = await ai.models.generateContent({
    model: modelId,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
    contents: [{
      role: 'user',
      parts: [
        { text: promptText },
        { inlineData: { mimeType: 'image/png', data: screenshotB64 } },
      ],
    }],
  });

  const parsed = JSON.parse(result.text ?? '{}') as {
    verdict?: string; confidence?: number; reason?: string;
  };

  return {
    verdict:    (parsed.verdict ?? 'failed') as 'ok' | 'ambiguous' | 'failed',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    reason:     parsed.reason ?? '',
    tokens:     result.usageMetadata?.totalTokenCount ?? 0,
  };
}

/**
 * Verify a postcondition against a screenshot.
 * Uses Flash; escalates to Pro if confidence < threshold.
 */
export async function verify(
  postcondition: string,
  screenshotB64: string,
  step: string,
): Promise<{
  ok: boolean;
  confidence: number;
  escalated: boolean;
  workerTokens: number;
  verifierTokens: number;
  reason: string;
}> {
  const threshold = OBS_PILOT_CONFIG.confidenceThreshold;

  let flash: VerifyResult;
  try {
    flash = await callGemini(OBS_PILOT_CONFIG.workerModel, postcondition, screenshotB64);
  } catch (err: any) {
    console.error(`[Verifier] Flash failed for "${step}": ${err.message}`);
    return { ok: false, confidence: 0, escalated: false, workerTokens: 0, verifierTokens: 0, reason: err.message };
  }

  if (!shouldEscalate(flash, threshold)) {
    return {
      ok: pickVerdict(flash), confidence: flash.confidence,
      escalated: false, workerTokens: flash.tokens, verifierTokens: 0, reason: flash.reason,
    };
  }

  console.log(`[Verifier] Escalating "${step}" to Pro (Flash conf=${flash.confidence.toFixed(2)})`);
  let pro: VerifyResult;
  try {
    pro = await callGemini(OBS_PILOT_CONFIG.verifierModel, postcondition, screenshotB64, flash.reason);
  } catch (err: any) {
    console.error(`[Verifier] Pro failed for "${step}": ${err.message}`);
    return {
      ok: pickVerdict(flash), confidence: flash.confidence,
      escalated: true, workerTokens: flash.tokens, verifierTokens: 0,
      reason: `Pro failed: ${err.message}. Flash: ${flash.reason}`,
    };
  }

  return {
    ok: pickVerdict(pro), confidence: pro.confidence,
    escalated: true, workerTokens: flash.tokens, verifierTokens: pro.tokens, reason: pro.reason,
  };
}

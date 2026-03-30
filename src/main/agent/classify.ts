// src/main/agent/classify.ts
import type { AgentProfile, ToolGroup, ModelTier } from './types';

export function classify(
  message: string,
  forced?: Partial<AgentProfile>,
): AgentProfile {
  const lower = message.toLowerCase();
  const mappingRequest = forced?.specialMode === 'app_mapping' || isAppMappingRequest(message);
  const mappingTarget = forced?.mappingTarget ?? extractAppMappingTarget(message);
  const mappingPhase = forced?.mappingPhase ?? detectMappingPhase(message);
  const specialMode = forced?.specialMode ?? (mappingRequest ? 'app_mapping' : undefined);
  const toolGroup = forced?.toolGroup ?? detectToolGroup(lower);
  const modelTier = forced?.modelTier ?? detectModelTier(lower, toolGroup);
  const isGreeting = forced?.isGreeting ?? detectGreeting(message.trim());
  const isContinuation = forced?.isContinuation ?? isContinuationRequest(message);
  return { toolGroup, modelTier, isGreeting, isContinuation, specialMode, mappingTarget, mappingPhase };
}

function detectToolGroup(msg: string): ToolGroup {
  if (isAppMappingRequest(msg)) return 'desktop';
  if (/click|screenshot|desktop|gui|window\s+app/.test(msg)) return 'desktop';
  if (/browser|search the web|navigate|url|website|http/.test(msg)) return 'browser';
  if (/\b(?:research|look up|find info(?:rmation)?|search for|search about|learn about|tell me about|what is|what are)\b/.test(msg)) {
    return 'browser';
  }
  if (/code|debug|refactor|typescript|javascript|python|function|class|method|test|lint/.test(msg)) return 'coding';
  if (/\bfile\b|\bfolder\b|\bread\b|\bwrite\b|\bmove\b|\bcopy\b|\bdelete\b|\bdirectory\b/.test(msg)) return 'core';
  return 'full';
}

function detectModelTier(msg: string, group: ToolGroup): ModelTier {
  if (/\bquick\b|\bsimple\b|\bbrief\b|\bjust\b|\bshort\b/.test(msg)) return 'fast';
  // Browser and desktop tasks always need the most capable model — they involve
  // multi-step reasoning, dynamic page state, and recovery from failures.
  if (group === 'browser' || group === 'desktop') return 'powerful';
  if (/\bthorough\b|\bdeep\b|\bcomplex\b|\bresearch\b|\banalyze\b|\banalysis\b/.test(msg)) return 'powerful';
  return 'standard';
}

function detectGreeting(msg: string): boolean {
  return /^(hi|hello|hey|thanks|thank you|bye|goodbye)(\s+there)?[\s!?.]*$/i.test(msg);
}

export function isAppMappingRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return /\bmap\b/.test(lower) && /\b(ui|app|application|screen|interface)\b/.test(lower)
    || /^map\s+[a-z0-9][a-z0-9 ._-]*$/i.test(message.trim())
    || /\bmap out\b.+\b(ui|app|application)\b/.test(lower)
    || /\b(continue mapping|deep map|phase 2)\b/.test(lower);
}

export function isContinuationRequest(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return /^(continue|keep going|go on|resume|carry on|proceed|continue please)[.!?]*$/.test(trimmed);
}

function detectMappingPhase(message: string): 'phase1' | 'phase2' {
  const lower = message.toLowerCase();
  if (/\b(continue mapping|deep map|phase 2)\b/.test(lower)) return 'phase2';
  return 'phase1';
}

export function extractAppMappingTarget(message: string): string | undefined {
  const trimmed = message.trim();
  const continueMap = trimmed.match(/\b(?:continue mapping|deep map|run phase 2 on)\s+(.+)$/i)?.[1]?.trim();
  if (continueMap) {
    return continueMap.replace(/\b(ui|interface|app|application)\b/gi, '').replace(/\s+/g, ' ').trim() || continueMap;
  }

  const direct = trimmed.match(/^map\s+(.+)$/i)?.[1]?.trim();
  if (direct && direct.length > 0 && direct.length < 80) {
    return direct.replace(/\b(ui|interface|app|application)\b/gi, '').replace(/\s+/g, ' ').trim() || direct;
  }

  const possessiveUi = trimmed.match(/\bmap\s+(.+?)'s\s+ui\b/i)?.[1]?.trim();
  if (possessiveUi) return possessiveUi;

  const mapOut = trimmed.match(/\bmap out\s+(.+?)(?:'s|\bui\b|\binterface\b|$)/i)?.[1]?.trim();
  if (mapOut) return mapOut;

  return undefined;
}

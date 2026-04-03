// src/main/agent/classify.ts
import type { AgentProfile, ToolGroup, ModelTier } from './types';
import { hasQuietExecuteSignal } from './promptBuilder';
import { detectServiceHints } from './serviceResolver';

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
  const linearExecution = forced?.linearExecution ?? hasQuietExecuteSignal(message);
  const serviceHints = forced?.serviceHints ?? detectServiceHints(message);
  return { toolGroup, modelTier, isGreeting, isContinuation, specialMode, mappingTarget, mappingPhase, linearExecution, serviceHints };
}

/**
 * Detect tool group from message.
 *
 * Priority: app_mapping > desktop > browser > coding > core > full
 *
 * Rules tightened to reduce false positives:
 * - Desktop requires clear GUI/automation intent, not just "window" or "click" in
 *   casual usage (e.g. "click the link" is browser, not desktop).
 * - Browser requires URL patterns or explicit web-research phrasing, not just
 *   "search" (which could mean code search).
 * - Coding uses word boundaries and requires code-specific terms.
 * - Core (filesystem) requires explicit file-operation verbs, not just "file" or
 *   "read" in casual context.
 * - Full is the safe fallback — it has search_tools for self-discovery.
 */
function detectToolGroup(msg: string): ToolGroup {
  if (isAppMappingRequest(msg)) return 'desktop';

  // Desktop: explicit GUI automation requests (not just words like "window")
  if (/\b(?:screenshot|gui\s+interact|xdotool|a11y|at-spi)\b/.test(msg)) return 'desktop';
  if (/\bclick\b/.test(msg) && /\b(?:button|menu|dialog|toolbar|icon|desktop|app(?:lication)?)\b/.test(msg)) return 'desktop';

  // Browser: URLs, explicit web navigation, or clear web-research phrasing
  if (/https?:\/\/|\.com\b|\.org\b|\.io\b|\.dev\b/.test(msg)) return 'browser';
  if (/\b(?:open|go to|navigate to|browse to|visit)\b.*\b(?:page|site|website|url)\b/.test(msg)) return 'browser';
  if (/\b(?:search the web|web search|google|look up online|search online|find online)\b/.test(msg)) return 'browser';
  if (/\b(?:research)\b/.test(msg) && /\b(?:online|web|internet|topic|article)\b/.test(msg)) return 'browser';

  // Coding: code-specific actions with word boundaries
  if (/\b(?:debug|refactor|implement|compile|transpile|lint|typecheck)\b/.test(msg)) return 'coding';
  if (/\b(?:function|class|method|variable|module|import|export)\b/.test(msg)
      && /\b(?:add|create|fix|change|rename|update|remove|write)\b/.test(msg)) return 'coding';
  if (/\b(?:typescript|javascript|python|rust|golang|react|vue|angular)\b/.test(msg)
      && /\b(?:code|project|app|error|bug|issue)\b/.test(msg)) return 'coding';

  // Core (filesystem): explicit file operations, not casual mention of "file"
  if (/\b(?:create|make|touch)\b.*\b(?:file|folder|directory)\b/.test(msg)) return 'core';
  if (/\b(?:move|copy|rename|delete|remove)\b.*\b(?:file|folder|directory)\b/.test(msg)) return 'core';
  if (/\b(?:read|write|edit|modify)\b.*\b(?:file|folder|directory|config|\.(?:json|yaml|toml|ini|conf|env|txt|csv))\b/.test(msg)) return 'core';
  if (/\bls\b|\bcat\b|\bmkdir\b|\brm\b|\bcp\b|\bmv\b/.test(msg)) return 'core';

  // Full: safe default — LLM gets search_tools to discover what it needs
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

// src/main/agent/serviceResolver.ts
//
// Detects when a user message references a known external service and returns
// lightweight injection hints so the agent prefers native API tools over
// browser automation. The registry lives in system/registry/service_registry.json
// and can be extended without any code changes.

import { readFileSync } from 'fs';
import { join } from 'path';

interface ServiceEntry {
  keywords: string[];
  domains: string[];
  description: string;
  tools: string[];
  auth: string;
  authNote: string;
  apiNote: string;
}

interface ServiceRegistry {
  services: Record<string, ServiceEntry>;
}

export interface ServiceHint {
  service: string;
  description: string;
  tools: string[];
  authNote: string;
  apiNote: string;
}

let _registry: ServiceRegistry | null = null;

function loadRegistry(): ServiceRegistry {
  if (_registry) return _registry;
  try {
    const registryPath = join(__dirname, '../../../system/registry/service_registry.json');
    const raw = readFileSync(registryPath, 'utf8');
    _registry = JSON.parse(raw) as ServiceRegistry;
  } catch {
    _registry = { services: {} };
  }
  return _registry;
}

/**
 * Scans the user message for known service keywords/domains and returns
 * matched ServiceHints. Returns an empty array if nothing matches.
 * Zero-cost when no services match — no prompt injection happens.
 */
export function detectServiceHints(message: string): ServiceHint[] {
  const registry = loadRegistry();
  const lower = message.toLowerCase();
  const hints: ServiceHint[] = [];

  for (const [name, entry] of Object.entries(registry.services)) {
    const keywordMatch = entry.keywords.some(kw => lower.includes(kw.toLowerCase()));
    const domainMatch = entry.domains.some(d => lower.includes(d.toLowerCase()));
    if (keywordMatch || domainMatch) {
      hints.push({
        service: name,
        description: entry.description,
        tools: entry.tools,
        authNote: entry.authNote,
        apiNote: entry.apiNote,
      });
    }
  }

  return hints;
}

/**
 * Builds the prompt injection string from matched service hints.
 * Only called when hints.length > 0 — keeps the prompt clean otherwise.
 */
export function buildServiceHintBlock(hints: ServiceHint[]): string {
  if (hints.length === 0) return '';

  const lines: string[] = [
    'API-FIRST GUIDANCE: Native tools exist for the following service(s) detected in this task. Prefer these over browser automation — they are faster, more reliable, and do not depend on UI state.',
    '',
  ];

  for (const hint of hints) {
    lines.push(`SERVICE: ${hint.service} — ${hint.description}`);
    lines.push(`  Tools: ${hint.tools.join(', ')}`);
    lines.push(`  Auth: ${hint.authNote}`);
    lines.push(`  API: ${hint.apiNote}`);
    lines.push('');
  }

  lines.push('Only fall back to browser automation if the native tool is unavailable or the task explicitly requires visual/UI interaction.');

  return lines.join('\n');
}

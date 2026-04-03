// src/main/agent/appMapping/index.ts
// Minimal stub — the full app mapping system was removed.

/**
 * Build app mapping system prompt. Returns the base prompt unchanged
 * since the app mapping subsystem has been removed.
 */
export async function buildAppMappingSystemPrompt(
  basePrompt: string,
  _opts: { appName: string; phase?: string },
): Promise<string> {
  return basePrompt;
}

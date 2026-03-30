/**
 * CapabilityBroker — routes tool calls to the appropriate capability handler.
 *
 * Each tool call has a domain (e.g. 'fs', 'shell', 'browser') and an action.
 * The broker resolves the handler, runs it, and returns a structured result.
 */

export interface CapabilityResult {
  ok: boolean;
  domain: string;
  action: string;
  environment: {
    environmentId: string;
    executorMode: string;
    stateScope: string;
    persistenceScope: string;
  };
  data: unknown;
  metadata: {
    surface: string;
    verification: string;
    cacheHit: boolean;
  };
  error?: string;
}

export interface CapabilityBroker {
  /**
   * Execute a named tool with the given input.
   * Returns a structured result describing what happened.
   */
  execute(toolName: string, input: Record<string, unknown>): Promise<CapabilityResult>;
}

export const SHELL_MAX = 4000;
export const FILE_MAX = 8000;
export const BROWSER_MAX = 2000;

/**
 * Truncate a tool result string to maxChars, appending a marker with the
 * original length so the model knows content was dropped.
 */
export function truncateToolResult(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = `\n[truncated — original length: ${text.length} chars]`;
  return text.slice(0, maxChars - marker.length) + marker;
}

/** Truncate a JSON-stringified browser tool result at BROWSER_MAX. */
export function truncateBrowserResult(resultStr: string): string {
  return truncateToolResult(resultStr, BROWSER_MAX);
}

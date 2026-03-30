import { describe, it, expect } from 'vitest';
import { truncateToolResult, truncateBrowserResult, SHELL_MAX, FILE_MAX, BROWSER_MAX } from '../../../../src/main/core/cli/truncate';
import { executeShellTool } from '../../../../src/main/core/cli/shellTools';

describe('truncateToolResult', () => {
  it('returns short strings unchanged', () => {
    expect(truncateToolResult('hello', SHELL_MAX)).toBe('hello');
  });

  it('truncates long strings and appends marker', () => {
    const long = 'x'.repeat(SHELL_MAX + 100);
    const result = truncateToolResult(long, SHELL_MAX);
    expect(result.length).toBeLessThanOrEqual(SHELL_MAX);
    expect(result).toContain('[truncated');
  });

  it('SHELL_MAX is 4000', () => {
    expect(SHELL_MAX).toBe(4000);
  });

  it('FILE_MAX is 8000', () => {
    expect(FILE_MAX).toBe(8000);
  });

  it('BROWSER_MAX is 2000', () => {
    expect(BROWSER_MAX).toBe(2000);
  });

  it('truncation marker shows original length', () => {
    const long = 'a'.repeat(5000);
    const result = truncateToolResult(long, SHELL_MAX);
    expect(result).toContain('5000');
  });
});

describe('truncateBrowserResult', () => {
  it('returns short strings unchanged', () => {
    expect(truncateBrowserResult('{"ok":true}')).toBe('{"ok":true}');
  });

  it('truncates long browser results at BROWSER_MAX', () => {
    const long = 'b'.repeat(BROWSER_MAX + 500);
    const result = truncateBrowserResult(long);
    expect(result.length).toBeLessThanOrEqual(BROWSER_MAX);
    expect(result).toContain('[truncated');
  });
});

describe('executeShellTool truncation', () => {
  it('truncates stdout over SHELL_MAX', async () => {
    const result = await executeShellTool('shell_exec', { command: `node -e "process.stdout.write('x'.repeat(5000))"` });
    expect(result.length).toBeLessThanOrEqual(SHELL_MAX);
    expect(result).toContain('[truncated');
  });

  it('does not truncate short output', async () => {
    const result = await executeShellTool('shell_exec', { command: 'echo hello' });
    expect(JSON.parse(result).stdout).toBe('hello');
  });

  it('truncates file view over FILE_MAX', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmp = path.join(os.tmpdir(), 'clawdia-test-big.txt');
    fs.writeFileSync(tmp, 'y'.repeat(FILE_MAX + 500));
    const result = await executeShellTool('file_edit', { command: 'view', path: tmp });
    expect(result.length).toBeLessThanOrEqual(FILE_MAX);
    expect(result).toContain('[truncated');
    fs.unlinkSync(tmp);
  });
});

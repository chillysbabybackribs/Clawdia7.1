// tests/renderer/agent/recovery.test.ts
import { verifyOutcomes } from '../../../src/main/agent/recovery';
import type { ToolCallRecord } from '../../../src/main/agent/types';

function record(name: string, input: Record<string, unknown>, result: string): ToolCallRecord {
  return { id: 'x', name, input, result };
}

describe('verifyOutcomes', () => {
  it('returns null when no claimed writes', () => {
    expect(verifyOutcomes('Here is a summary.', [])).toBeNull();
  });

  it('returns null when claimed write matches tool call', () => {
    const calls = [record('file_edit', { command: 'create', path: 'src/foo.ts', file_text: 'x' }, 'File created at src/foo.ts')];
    expect(verifyOutcomes("I've written the file to src/foo.ts.", calls)).toBeNull();
  });

  it('returns issue when claimed write has no matching tool call', () => {
    const result = verifyOutcomes("I've saved the output to results.json.", []);
    expect(result).not.toBeNull();
    expect(result!.issue).toMatch(/results\.json/);
  });

  it('returns null when loop produced no claims', () => {
    const calls = [record('shell_exec', { command: 'ls' }, 'foo.ts')];
    expect(verifyOutcomes('The directory contains foo.ts.', calls)).toBeNull();
  });
});

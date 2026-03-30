import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const originalHome = process.env.HOME;
const originalOpenAIKey = process.env.OPENAI_API_KEY;

let tempHome = '';

afterEach(() => {
  if (tempHome) {
    fs.rmSync(tempHome, { recursive: true, force: true });
    tempHome = '';
  }
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;

  if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAIKey;
});

describe('hybridCoordinateAssistant config', () => {
  it('reads provider, model, and key from Clawdia settings', async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-assistant-home-'));
    process.env.HOME = tempHome;
    const configDir = path.join(tempHome, '.config', 'clawdia7');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'clawdia-settings.json'), JSON.stringify({
      provider: 'gemini',
      models: { anthropic: 'claude-sonnet-4-6', openai: 'gpt-5.4', gemini: 'gemini-2.5-pro' },
      providerKeys: { anthropic: '', openai: '', gemini: 'settings-gemini-key' },
    }), 'utf8');

    const mod = await import('../../../src/main/agent/appMapping/hybridCoordinateAssistant');
    const result = mod.resolveHybridAssistantConfig();

    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-2.5-pro');
    expect(result.apiKey).toBe('settings-gemini-key');
  });

  it('prefers explicit provider args and environment keys', async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-assistant-home-'));
    process.env.HOME = tempHome;
    process.env.OPENAI_API_KEY = 'env-openai-key';

    const mod = await import('../../../src/main/agent/appMapping/hybridCoordinateAssistant');
    const result = mod.resolveHybridAssistantConfig('openai', 'gpt-5.4-mini');

    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-5.4-mini');
    expect(result.apiKey).toBe('env-openai-key');
  });
});

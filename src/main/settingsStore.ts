import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ProviderId } from '../shared/model-registry';
import { DEFAULT_MODEL_BY_PROVIDER, DEFAULT_PROVIDER } from '../shared/model-registry';
import type { PerformanceStance } from '../shared/types';

export interface AppSettings {
  providerKeys: Record<ProviderId, string>;
  provider: ProviderId;
  models: Record<ProviderId, string>;
  uiSession: unknown;
  unrestrictedMode: boolean;
  policyProfile: string;
  performanceStance: PerformanceStance;
}

const emptyKeys = (): Record<ProviderId, string> => ({
  anthropic: '',
  openai: '',
  gemini: '',
});

function defaultSettings(): AppSettings {
  return {
    providerKeys: emptyKeys(),
    provider: DEFAULT_PROVIDER,
    models: { ...DEFAULT_MODEL_BY_PROVIDER },
    uiSession: null,
    unrestrictedMode: false,
    policyProfile: 'standard',
    performanceStance: 'standard',
  };
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'clawdia-settings.json');
}

function parseSettingsFile(filePath: string): AppSettings | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...defaultSettings(),
      ...parsed,
      providerKeys: { ...emptyKeys(), ...parsed.providerKeys },
      models: { ...DEFAULT_MODEL_BY_PROVIDER, ...parsed.models },
    };
  } catch (err) {
    console.warn('[settings] Failed to parse settings file:', filePath, (err as Error).message);
    return null;
  }
}

function hasAnyProviderKey(settings: AppSettings | null | undefined): settings is AppSettings {
  return !!settings && Object.values(settings.providerKeys || {}).some((key) => Boolean(key));
}

function legacySettingsPaths(): string[] {
  const appDataDir = app.getPath('appData');
  const currentPath = settingsPath();
  return [
    path.join(appDataDir, 'clawdia7', 'clawdia-settings.json'),
    path.join(appDataDir, 'Clawdia 7.0', 'clawdia-settings.json'),
    path.join(appDataDir, 'clawdia', 'clawdia-settings.json'),
    path.join(appDataDir, 'Electron', 'clawdia-settings.json'),
  ].filter((candidate, index, all) => candidate !== currentPath && all.indexOf(candidate) === index);
}

function loadMigratedSettings(): AppSettings | null {
  for (const candidate of legacySettingsPaths()) {
    const parsed = parseSettingsFile(candidate);
    if (!hasAnyProviderKey(parsed)) continue;
    try {
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      fs.copyFileSync(candidate, settingsPath());
    } catch {
      // Ignore migration write failures and still use the parsed content in memory.
    }
    return parsed;
  }
  return null;
}

let cache: AppSettings | null = null;

export function loadSettings(): AppSettings {
  if (cache) return cache;
  const p = settingsPath();
  const parsedCurrent = parseSettingsFile(p);
  if (parsedCurrent) {
    cache = parsedCurrent;
    return cache;
  }

  const migrated = loadMigratedSettings();
  if (migrated) {
    cache = migrated;
    return cache;
  }

  cache = defaultSettings();
  return cache;
}

export function saveSettings(next: AppSettings): void {
  cache = next;
  const p = settingsPath();
  try {
    const dir = path.dirname(p);
    fs.mkdirSync(dir, { recursive: true });
    // Atomic write: write to temp file, then rename to prevent corruption on crash
    const tmpPath = `${p}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmpPath, p);
  } catch (err) {
    console.error('[settings] Failed to save settings:', (err as Error).message);
  }
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return loadSettings()[key];
}

export function patchSettings(patch: Partial<AppSettings>): AppSettings {
  const cur = loadSettings();
  const next: AppSettings = {
    ...cur,
    ...patch,
    providerKeys: patch.providerKeys ? { ...cur.providerKeys, ...patch.providerKeys } : cur.providerKeys,
    models: patch.models ? { ...cur.models, ...patch.models } : cur.models,
  };
  saveSettings(next);
  return next;
}

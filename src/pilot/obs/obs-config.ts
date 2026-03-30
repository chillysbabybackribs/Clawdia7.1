// src/pilot/obs/obs-config.ts
import * as path from 'path';

export const OBS_PILOT_CONFIG = {
  workerModel:         'gemini-2.5-flash',
  verifierModel:       'gemini-2.5-pro',
  confidenceThreshold: 0.7,
  maxRetries:          2,
  defaultRunCount:     3,
  actionDelayMs:       300,
  launchTimeoutMs:     20000,
  modalTimeoutMs:      3000,
  ocrCacheTtlMs:       5000,
  ocrRegionPaddingPx:  180,
  logPath:             path.join(process.cwd(), 'logs', 'obs-pilot-results.jsonl'),
  obsExecutable:       '/usr/bin/obs',
  windowTitlePattern:  'OBS.*',
  appName:             'obs',
  contentYOffset:      69,
} as const;

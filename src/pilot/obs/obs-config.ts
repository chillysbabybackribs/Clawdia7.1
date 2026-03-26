// src/pilot/obs/obs-config.ts
import * as path from 'path';

export const OBS_PILOT_CONFIG = {
  workerModel:         'gemini-2.0-flash',
  verifierModel:       'gemini-2.5-pro',
  confidenceThreshold: 0.7,
  maxRetries:          2,
  defaultRunCount:     3,
  actionDelayMs:       300,
  launchTimeoutMs:     8000,
  modalTimeoutMs:      3000,
  logPath:             path.join(process.cwd(), 'logs', 'obs-pilot-results.jsonl'),
  obsExecutable:       '/usr/bin/obs',
  windowTitlePattern:  'OBS.*',
  appName:             'obs',
} as const;

// src/pilot/obs/obs-types.ts

export type FailType =
  | 'element_not_found'
  | 'timeout'
  | 'modal_unexpected'
  | 'verify_failed'
  | 'precondition_failed'
  | 'unknown';

export type LocatorUsed = 'a11y' | 'ocr' | 'relative' | 'coord' | 'none';

export interface StepResult {
  step: string;
  ok: boolean;
  confidence: number;
  retries: number;
  escalated: boolean;
  failType: FailType | null;
  locatorUsed: LocatorUsed;
  durationMs: number;
  workerTokens: number;
  verifierTokens: number;
}

export interface VerifyResult {
  verdict: 'ok' | 'ambiguous' | 'failed';
  confidence: number;
  reason: string;
  tokens: number;
}

export interface ControlDef {
  a11yRole: string;
  a11yName: string | null;
  region: string;
  ocrFallback: string;
  coord?: [number, number];
  relative?: [number, number];
  knownValues?: string[];
  toggleState?: boolean;
}

export interface RegionDef {
  label: string;
  a11yRole: string;
  a11yName: string | null;
  position: string;
  controls: string[];
}

export interface ScreenDef {
  windowTitle: string;
  windowTitlePattern: string;
  precondition: string;
  regions: string[];
}

export interface OBSMap {
  app: string;
  version: string;
  updated: string;
  screens: Record<string, ScreenDef>;
  regions: Record<string, RegionDef>;
  controls: Record<string, ControlDef>;
  locatorStrategy: string[];
  confidence: { initial: number; successIncrement: number; failureDecrement: number };
}

export interface StateDef {
  windowTitlePattern: string;
  cues: string[];
}

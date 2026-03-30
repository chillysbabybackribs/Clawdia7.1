#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  beginGuiTrustSession,
  captureGuiStateFingerprint,
  createDefaultGuiAppProfile,
  executeGuiInteract,
  upsertTrustedAnchor,
} from '../main/core/desktop';
import {
  buildCoordinateProposalPrompt,
  buildCoordinateValidationPrompt,
} from '../main/agent/appMapping/hybridCoordinateMapping';
import type {
  HybridAssistantConfig,
  HybridProposalResult,
  HybridValidationResult,
} from '../main/agent/appMapping/hybridCoordinateAssistant';
import {
  requestCoordinateProposal,
  requestCoordinateValidation,
  resolveHybridAssistantConfig,
} from '../main/agent/appMapping/hybridCoordinateAssistant';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function appendSectionMapRecord(args: {
  appId: string;
  target: string;
  anchorLabel: string;
  sectionLabel?: string;
  sectionBounds?: { x: number; y: number; width: number; height: number };
  proposal: HybridProposalResult;
  validation: HybridValidationResult;
  finalState: Awaited<ReturnType<typeof captureGuiStateFingerprint>>;
  x: number;
  y: number;
}): string {
  const filePath = path.join(process.cwd(), 'artifacts', 'hybrid-mapping', args.appId, 'section-maps.json');
  const existing = fs.existsSync(filePath)
    ? (JSON.parse(fs.readFileSync(filePath, 'utf8')) as Array<Record<string, unknown>>)
    : [];
  const nextRecord = {
    label: args.anchorLabel,
    targetDescription: args.target,
    sectionLabel: args.sectionLabel ?? null,
    sectionBounds: args.sectionBounds ?? null,
    role: args.validation.role ?? args.proposal.role,
    x: args.x,
    y: args.y,
    confidence: args.validation.confidence,
    proposalConfidence: args.proposal.confidence,
    validationReason: args.validation.reason,
    windowTitle: args.finalState.windowTitle,
    windowBounds: args.finalState.windowBounds,
    screenshotPath: args.finalState.screenshotPath,
    validatedAt: new Date().toISOString(),
    phase: 'phase1-hover-only',
  };
  const withoutDuplicate = existing.filter((entry) =>
    !(entry.label === args.anchorLabel && entry.sectionLabel === (args.sectionLabel ?? null)),
  );
  withoutDuplicate.push(nextRecord);
  ensureDir(path.dirname(filePath));
  writeJsonFile(filePath, withoutDuplicate);
  return filePath;
}

function parseOptionalInt(name: string): number | undefined {
  const value = arg(name);
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function moveMouse(x: number, y: number): void {
  execFileSync('xdotool', ['mousemove', String(x), String(y)]);
}

async function maybeLaunch(app: string, window: string): Promise<void> {
  const windows = await executeGuiInteract({ action: 'list_windows' });
  if (new RegExp(window, 'i').test(windows)) return;
  const result = await executeGuiInteract({ action: 'app_launch', app, window });
  if (result.startsWith('[Error]')) throw new Error(result);
}

async function stabilize(window: string, layout: 'fullscreen' | 'maximized'): Promise<void> {
  const focusResult = await executeGuiInteract({ action: 'focus', window });
  if (focusResult.startsWith('[Error]')) throw new Error(focusResult);

  const primaryAction = layout === 'fullscreen' ? 'fullscreen_window' : 'maximize_window';
  const primaryResult = await executeGuiInteract({ action: primaryAction, window });
  if (!primaryResult.startsWith('[Error]')) return;

  const fallbackAction = layout === 'fullscreen' ? 'maximize_window' : 'fullscreen_window';
  const fallbackResult = await executeGuiInteract({ action: fallbackAction, window });
  if (fallbackResult.startsWith('[Error]')) throw new Error(fallbackResult);
}

async function runAssistLoop(args: {
  assistant: HybridAssistantConfig;
  session: Awaited<ReturnType<typeof beginGuiTrustSession>>;
  appId: string;
  target: string;
  anchorLabel?: string;
  sectionLabel?: string;
  sectionBounds?: { x: number; y: number; width: number; height: number };
  maxRounds: number;
  initialState: Awaited<ReturnType<typeof captureGuiStateFingerprint>>;
}): Promise<{
  proposal: HybridProposalResult;
  validation?: HybridValidationResult;
  finalState: Awaited<ReturnType<typeof captureGuiStateFingerprint>>;
  trace: Array<Record<string, unknown>>;
  nextStep?: Record<string, unknown>;
  trustedAnchorPath?: string;
  sectionMapPath?: string;
}> {
  const proposalPrompt = buildCoordinateProposalPrompt({
    appName: args.appId,
    windowTitle: args.initialState.windowTitle,
    targetDescription: args.target,
    screenshotPath: args.initialState.screenshotPath,
    windowBounds: args.initialState.windowBounds,
    sectionLabel: args.sectionLabel,
    sectionBounds: args.sectionBounds,
    notes: ['Answer strictly in JSON.', 'Propose one best coordinate only.'],
  });
  const proposal = await requestCoordinateProposal(args.assistant, proposalPrompt, args.initialState.screenshotPath);
  const trace: Array<Record<string, unknown>> = [{
    step: 'propose',
    label: proposal.label,
    role: proposal.role,
    x: proposal.x,
    y: proposal.y,
    confidence: proposal.confidence,
    reason: proposal.reason,
    screenshotPath: args.initialState.screenshotPath,
  }];

  let currentX = proposal.x;
  let currentY = proposal.y;
  let finalState = args.initialState;
  let validation: HybridValidationResult | undefined;
  let nextStep: Record<string, unknown> | undefined;
  let trustedAnchorPath: string | undefined;
  let sectionMapPath: string | undefined;

  for (let round = 1; round <= args.maxRounds; round++) {
    moveMouse(currentX, currentY);
    finalState = await captureGuiStateFingerprint(args.session);
    const validationPrompt = buildCoordinateValidationPrompt({
      appName: args.appId,
      windowTitle: finalState.windowTitle,
      targetDescription: args.target,
      screenshotPath: finalState.screenshotPath,
      windowBounds: finalState.windowBounds,
      sectionLabel: args.sectionLabel,
      sectionBounds: args.sectionBounds,
      cursor: { x: currentX, y: currentY },
      notes: ['Answer strictly in JSON.', 'This is a coordinate calibration task.'],
    });
    validation = await requestCoordinateValidation(args.assistant, validationPrompt, finalState.screenshotPath);
    trace.push({
      step: `validate-${round}`,
      x: currentX,
      y: currentY,
      status: validation.status,
      dx: validation.dx,
      dy: validation.dy,
      confidence: validation.confidence,
      reason: validation.reason,
      screenshotPath: finalState.screenshotPath,
    });

    if (validation.status === 'exact') {
      trustedAnchorPath = persistTrustedAnchor(
        args.appId,
        args.target,
        args.anchorLabel ?? proposal.label,
        validation,
        finalState,
        currentX,
        currentY,
        proposal.role,
        args.sectionLabel,
        args.sectionBounds,
      );
      sectionMapPath = appendSectionMapRecord({
        appId: args.appId,
        target: args.target,
        anchorLabel: args.anchorLabel ?? proposal.label,
        sectionLabel: args.sectionLabel,
        sectionBounds: args.sectionBounds,
        proposal,
        validation,
        finalState,
        x: currentX,
        y: currentY,
      });
      nextStep = {
        action: 'map_section',
        label: args.anchorLabel ?? proposal.label,
        sectionLabel: args.sectionLabel ?? null,
        trustedAnchorPath,
        sectionMapPath,
        rounds: round,
      };
      break;
    }

    if (validation.status === 'wrong_target') {
      nextStep = {
        action: 're-propose',
        reason: validation.reason,
        rounds: round,
      };
      break;
    }

    currentX += validation.dx;
    currentY += validation.dy;
    nextStep = {
      action: 'revalidate',
      nextX: currentX,
      nextY: currentY,
      rounds: round,
    };
  }

  return {
    proposal,
    validation,
    finalState,
    trace,
    nextStep,
    trustedAnchorPath,
    sectionMapPath,
  };
}

function persistTrustedAnchor(
  appId: string,
  target: string,
  anchorLabel: string | undefined,
  validation: HybridValidationResult,
  state: Awaited<ReturnType<typeof captureGuiStateFingerprint>>,
  x: number,
  y: number,
  fallbackRole?: string,
  sectionLabel?: string,
  sectionBounds?: { x: number; y: number; width: number; height: number },
): string {
  const trusted = upsertTrustedAnchor({
    id: `${appId}-${Date.now()}`,
    appId,
    label: anchorLabel ?? target,
    role: validation.role ?? fallbackRole ?? 'unknown',
    targetDescription: target,
    sectionLabel,
    sectionBounds,
    x,
    y,
    confidence: validation.confidence ?? 1,
    windowTitle: state.windowTitle,
    windowBounds: state.windowBounds,
    screenshotPath: state.screenshotPath,
    trustedAt: new Date().toISOString(),
    source: 'hybrid-mapper',
    notes: validation.reason,
  });
  return trusted.filePath;
}

async function main(): Promise<void> {
  const appId = arg('--app') ?? 'gimp';
  const windowTitle = arg('--window') ?? 'GNU Image Manipulation Program';
  const target = arg('--target');
  const mode = arg('--mode') ?? 'propose';
  const launch = flag('--launch');
  const layout = arg('--layout') === 'maximized' ? 'maximized' : 'fullscreen';
  const providerArg = arg('--provider');
  const modelArg = arg('--model');
  const maxRounds = parseInt(arg('--max-rounds') ?? '3', 10);
  const sectionLabel = arg('--section-label');
  const sectionX = parseOptionalInt('--section-x');
  const sectionY = parseOptionalInt('--section-y');
  const sectionWidth = parseOptionalInt('--section-width');
  const sectionHeight = parseOptionalInt('--section-height');

  if (!target) {
    throw new Error('--target is required');
  }
  if (!['propose', 'validate', 'assist'].includes(mode)) {
    throw new Error('--mode must be propose, validate, or assist');
  }

  const xRaw = arg('--x');
  const yRaw = arg('--y');
  const responseFile = arg('--response-file');
  const anchorLabel = arg('--anchor-label');
  const x = xRaw ? parseInt(xRaw, 10) : undefined;
  const y = yRaw ? parseInt(yRaw, 10) : undefined;
  const sectionBounds = [sectionX, sectionY, sectionWidth, sectionHeight].every((value) => value != null)
    ? { x: sectionX!, y: sectionY!, width: sectionWidth!, height: sectionHeight! }
    : undefined;

  if (mode === 'validate' && (x == null || y == null || Number.isNaN(x) || Number.isNaN(y))) {
    throw new Error('--x and --y are required in validate mode');
  }

  if (launch) {
    await maybeLaunch(appId, windowTitle);
  }
  await stabilize(windowTitle, layout);

  if (mode === 'validate' && x != null && y != null) {
    moveMouse(x, y);
  }

  const profile = createDefaultGuiAppProfile(appId, windowTitle);
  profile.windowMatchers = [windowTitle, appId];
  const session = await beginGuiTrustSession(profile, {
    artifactRoot: path.join(process.cwd(), 'artifacts', 'hybrid-mapping', appId),
  });
  const state = await captureGuiStateFingerprint(session);

  const runDir = path.join(
    process.cwd(),
    'artifacts',
    'hybrid-mapping',
    appId,
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  ensureDir(runDir);

  const prompt = mode === 'validate' && x != null && y != null
    ? buildCoordinateValidationPrompt({
        appName: appId,
        windowTitle: state.windowTitle,
        targetDescription: target,
        screenshotPath: state.screenshotPath,
        windowBounds: state.windowBounds,
        sectionLabel,
        sectionBounds,
        cursor: { x, y },
        notes: ['Answer strictly in JSON.', 'This is a coordinate calibration task.'],
      })
    : buildCoordinateProposalPrompt({
        appName: appId,
        windowTitle: state.windowTitle,
        targetDescription: target,
        screenshotPath: state.screenshotPath,
        windowBounds: state.windowBounds,
        sectionLabel,
        sectionBounds,
        notes: ['Answer strictly in JSON.', 'Propose one best coordinate only.'],
      });

  const promptPath = path.join(runDir, `${mode}-prompt.md`);
  const contextPath = path.join(runDir, `${mode}-context.json`);
  fs.writeFileSync(promptPath, `${prompt}\n`, 'utf8');
  writeJsonFile(contextPath, {
    mode,
    appId,
    windowTitle: state.windowTitle,
    target,
    sectionLabel,
    sectionBounds,
    screenshotPath: state.screenshotPath,
    windowBounds: state.windowBounds,
    cursor: mode === 'validate' ? { x, y } : null,
  });

  let nextStep: Record<string, unknown> | undefined;
  let trustedAnchorPath: string | undefined;
  let sectionMapPath: string | undefined;
  let llmResponsePath: string | undefined;
  let proposal: HybridProposalResult | undefined;
  let validation: HybridValidationResult | undefined;

  if (mode === 'validate' && responseFile) {
    const response = readJsonFile<HybridValidationResult>(responseFile);
    if (response.status === 'adjust' && x != null && y != null) {
      const nextX = x + (response.dx ?? 0);
      const nextY = y + (response.dy ?? 0);
      nextStep = {
        action: 'revalidate',
        nextX,
        nextY,
        reason: response.reason ?? 'LLM requested calibration',
      };
    } else if (response.status === 'exact' && x != null && y != null) {
      trustedAnchorPath = persistTrustedAnchor(appId, target, anchorLabel, response, state, x, y, undefined, sectionLabel, sectionBounds);
      sectionMapPath = appendSectionMapRecord({
        appId,
        target,
        anchorLabel: anchorLabel ?? target,
        sectionLabel,
        sectionBounds,
        proposal: {
          label: anchorLabel ?? target,
          role: response.role ?? 'unknown',
          x,
          y,
          confidence: response.confidence,
          reason: response.reason,
        },
        validation: response,
        finalState: state,
        x,
        y,
      });
      nextStep = {
        action: 'map_section',
        label: anchorLabel ?? target,
        sectionLabel: sectionLabel ?? null,
        trustedAnchorPath,
        sectionMapPath,
      };
    } else if (response.status === 'wrong_target') {
      nextStep = {
        action: 're-propose',
        reason: response.reason ?? 'LLM judged the coordinate to be on the wrong target',
      };
    }
  }

  if (mode === 'assist') {
    const assistant = resolveHybridAssistantConfig(providerArg, modelArg);
    const assist = await runAssistLoop({
      assistant,
      session,
      appId,
      target,
      anchorLabel,
      sectionLabel,
      sectionBounds,
      maxRounds,
      initialState: state,
    });
    proposal = assist.proposal;
    validation = assist.validation;
    nextStep = assist.nextStep;
    trustedAnchorPath = assist.trustedAnchorPath;
    sectionMapPath = assist.sectionMapPath;

    llmResponsePath = path.join(runDir, 'assist-trace.json');
    writeJsonFile(llmResponsePath, {
      provider: assistant.provider,
      model: assistant.model,
      proposal,
      validation,
      trace: assist.trace,
      nextStep,
      trustedAnchorPath,
      sectionMapPath,
    });
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode,
    appId,
    target,
    runDir,
    promptPath,
    contextPath,
    screenshotPath: state.screenshotPath,
    cursor: mode === 'validate' ? { x, y } : null,
    proposal,
    validation,
    llmResponsePath,
    nextStep,
    trustedAnchorPath,
    sectionMapPath,
  }, null, 2)}\n`);
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});

#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import {
  beginGuiTrustSession,
  captureGuiStateFingerprint,
  crawlTrustedSurfaces,
  createDefaultGuiAppProfile,
  importGuiTrustSeedFromAppArtifacts,
  writeGuiTrustSessionArtifacts,
  executeGuiInteract,
} from '../main/core/desktop';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function printHelp(): void {
  process.stdout.write([
    'Usage: node dist/pilot/run-gui-trust.js [options]',
    '',
    'Options:',
    '  --app <id>             Target app id. Default: gimp',
    '  --window <title>       Window title matcher. Default: GNU Image Manipulation Program',
    '  --launch               Launch the app before capture',
    '  --layout <mode>        fullscreen | maximized. Default: fullscreen',
    '  --max-depth <n>        Probe crawl depth when probes are enabled. Default: 1',
    '  --max-elements <n>     Max elements per state when probes are enabled. Default: 8',
    '  --max-states <n>       Max states when probes are enabled. Default: 8',
    '  --allow-probes         Explicitly enable probe/click crawl behavior',
    '  --help                 Print help and exit without touching the app',
  ].join('\n') + '\n');
}

async function maybeLaunchApp(app: string, window: string): Promise<void> {
  const windows = await executeGuiInteract({ action: 'list_windows' });
  if (new RegExp(window, 'i').test(windows)) return;
  const result = await executeGuiInteract({ action: 'app_launch', app, window });
  if (result.startsWith('[Error]')) {
    throw new Error(`Unable to launch ${app}: ${result}`);
  }
}

async function stabilizeWindow(window: string, layout: 'fullscreen' | 'maximized'): Promise<void> {
  const focusResult = await executeGuiInteract({ action: 'focus', window });
  if (focusResult.startsWith('[Error]')) {
    throw new Error(`Unable to focus ${window}: ${focusResult}`);
  }

  const primaryAction = layout === 'fullscreen' ? 'fullscreen_window' : 'maximize_window';
  const primaryResult = await executeGuiInteract({ action: primaryAction, window });
  if (!primaryResult.startsWith('[Error]')) return;

  const fallbackAction = layout === 'fullscreen' ? 'maximize_window' : 'fullscreen_window';
  const fallbackResult = await executeGuiInteract({ action: fallbackAction, window });
  if (fallbackResult.startsWith('[Error]')) {
    throw new Error(`Unable to stabilize ${window}: ${primaryResult} | ${fallbackResult}`);
  }
}

async function main(): Promise<void> {
  if (flag('--help')) {
    printHelp();
    return;
  }

  const appId = arg('--app') ?? 'gimp';
  const windowTitle = arg('--window') ?? 'GNU Image Manipulation Program';
  const maxDepthRaw = arg('--max-depth');
  const maxElementsRaw = arg('--max-elements');
  const maxStatesRaw = arg('--max-states');
  const layoutRaw = arg('--layout');
  const maxDepth = maxDepthRaw ? parseInt(maxDepthRaw, 10) : 1;
  const maxElementsPerState = maxElementsRaw ? parseInt(maxElementsRaw, 10) : 8;
  const maxStates = maxStatesRaw ? parseInt(maxStatesRaw, 10) : 8;
  const layout = layoutRaw === 'maximized' ? 'maximized' : 'fullscreen';
  const launch = flag('--launch');
  const allowProbes = flag('--allow-probes');

  if (Number.isNaN(maxDepth) || maxDepth < 0) {
    throw new Error('--max-depth must be 0 or greater');
  }
  if (Number.isNaN(maxElementsPerState) || maxElementsPerState < 1) {
    throw new Error('--max-elements must be 1 or greater');
  }
  if (Number.isNaN(maxStates) || maxStates < 1) {
    throw new Error('--max-states must be 1 or greater');
  }

  if (launch) {
    await maybeLaunchApp(appId, windowTitle);
  }
  await stabilizeWindow(windowTitle, layout);

  const profile = createDefaultGuiAppProfile(appId, windowTitle);
  profile.windowMatchers = [windowTitle, appId];
  const session = await beginGuiTrustSession(profile);
  const startState = await captureGuiStateFingerprint(session);
  const imported = importGuiTrustSeedFromAppArtifacts(appId);
  const graph = imported.graph;
  let report;
  if (allowProbes) {
    report = await crawlTrustedSurfaces(session, graph, {
      startState,
      maxDepth,
      maxElementsPerState,
      maxStates,
    });
  } else {
    report = {
      ok: true,
      visitedStateIds: [startState.stateId],
      probedElementIds: [],
      discoveredElementIds: [],
      edgeIds: [],
      skipped: ['probe crawl disabled: pass --allow-probes to enable probing'],
      errors: [],
    };
  }

  const written = writeGuiTrustSessionArtifacts(session, graph, {
    notes: [
      `App: ${appId}`,
      `Window: ${windowTitle}`,
      `Visited states: ${report.visitedStateIds.length}`,
      `Probed elements: ${report.probedElementIds.length}`,
      `Discovered elements: ${report.discoveredElementIds.length}`,
      `Edges: ${report.edgeIds.length}`,
      `Probe mode: ${allowProbes ? 'enabled' : 'disabled'}`,
      `Errors: ${report.errors.length}`,
    ],
  });
  const crawlReportPath = path.join(written.runDir, 'crawl-report.json');
  fs.writeFileSync(crawlReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    appId,
    runDir: written.runDir,
    graphPath: written.graphPath,
    crawlReportPath,
    visitedStates: report.visitedStateIds.length,
    probedElements: report.probedElementIds.length,
    discoveredElements: report.discoveredElementIds.length,
    edgeCount: report.edgeIds.length,
    probeMode: allowProbes ? 'enabled' : 'disabled',
    errors: report.errors,
    importedSourceFiles: imported.sourceFiles,
  }, null, 2)}\n`);
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});

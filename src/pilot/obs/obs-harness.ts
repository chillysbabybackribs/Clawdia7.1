// src/pilot/obs/obs-harness.ts
import * as fs from 'fs';
import * as path from 'path';
import { runOBSWorkflow } from './obs-workflow';
import { OBS_PILOT_CONFIG } from './obs-config';
import type { StepResult } from './obs-types';

export interface StepSummary {
  passed: number;
  total: number;
  avgDurationMs: number;
  escalations: number;
  commonFailType: string | null;
  totalWorkerTokens: number;
  totalVerifierTokens: number;
}

export function computeSummary(runs: StepResult[][]): Record<string, StepSummary> {
  const acc: Record<string, {
    passed: number; total: number; durations: number[];
    escalations: number; failTypes: string[];
    workerTokens: number; verifierTokens: number;
  }> = {};

  for (const run of runs) {
    for (const r of run) {
      if (!acc[r.step]) {
        acc[r.step] = { passed: 0, total: 0, durations: [], escalations: 0, failTypes: [], workerTokens: 0, verifierTokens: 0 };
      }
      const s = acc[r.step];
      s.total++;
      if (r.ok) s.passed++;
      s.durations.push(r.durationMs);
      if (r.escalated) s.escalations++;
      if (r.failType) s.failTypes.push(r.failType);
      s.workerTokens += r.workerTokens;
      s.verifierTokens += r.verifierTokens;
    }
  }

  const out: Record<string, StepSummary> = {};
  for (const [step, s] of Object.entries(acc)) {
    const avgDurationMs = Math.round(s.durations.reduce((a, b) => a + b, 0) / s.durations.length);
    const freq: Record<string, number> = {};
    for (const ft of s.failTypes) freq[ft] = (freq[ft] ?? 0) + 1;
    const commonFailType = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    out[step] = {
      passed: s.passed, total: s.total, avgDurationMs,
      escalations: s.escalations, commonFailType,
      totalWorkerTokens: s.workerTokens, totalVerifierTokens: s.verifierTokens,
    };
  }
  return out;
}

function appendJsonl(logPath: string, runIdx: number, runId: string, results: StepResult[]): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const lines = results.map((r) => JSON.stringify({ runId, run: runIdx, ...r })).join('\n') + '\n';
  fs.appendFileSync(logPath, lines, 'utf-8');
}

function printSummary(summary: Record<string, StepSummary>, runCount: number, wallMs: number): void {
  const FLASH_COST = 0.10 / 1_000_000;
  const PRO_COST   = 1.25 / 1_000_000;
  let totalWorker = 0, totalVerifier = 0;

  console.log('\n' + '═'.repeat(88));
  console.log('OBS PILOT RESULTS');
  console.log('═'.repeat(88));
  console.log(`${'step'.padEnd(22)} ${'pass'.padEnd(7)} ${'rate'.padEnd(7)} ${'avg_ms'.padEnd(9)} ${'esc'.padEnd(5)} fail_type`);
  console.log('─'.repeat(88));

  for (const [step, s] of Object.entries(summary)) {
    const rate = `${Math.round((s.passed / s.total) * 100)}%`;
    console.log(
      `${s.passed === s.total ? '✓' : '✗'} ` +
      `${step.padEnd(22)} ${`${s.passed}/${s.total}`.padEnd(7)} ${rate.padEnd(7)} ` +
      `${`${s.avgDurationMs}ms`.padEnd(9)} ${String(s.escalations).padEnd(5)} ${s.commonFailType ?? '—'}`,
    );
    totalWorker += s.totalWorkerTokens;
    totalVerifier += s.totalVerifierTokens;
  }

  console.log('─'.repeat(88));
  console.log(`Flash tokens: ${totalWorker.toLocaleString()}  (~$${(totalWorker * FLASH_COST).toFixed(4)})`);
  console.log(`Pro tokens:   ${totalVerifier.toLocaleString()}  (~$${(totalVerifier * PRO_COST).toFixed(4)})`);
  console.log(`Wall time:    ${runCount} run(s), ${Math.round(wallMs / 1000)}s total`);
  console.log('═'.repeat(88) + '\n');
}

export async function runHarness(opts: { runCount?: number; logPath?: string } = {}): Promise<boolean> {
  const runCount = opts.runCount ?? OBS_PILOT_CONFIG.defaultRunCount;
  const logPath  = opts.logPath  ?? OBS_PILOT_CONFIG.logPath;
  const runId    = `pilot-${Date.now()}`;
  const wallStart = Date.now();

  console.log(`\n[Harness] OBS pilot — ${runCount} run(s), id=${runId}`);
  console.log(`[Harness] Log: ${logPath}\n`);

  const allRuns: StepResult[][] = [];
  for (let i = 1; i <= runCount; i++) {
    console.log(`\n[Harness] ── Run ${i}/${runCount} ──`);
    const results = await runOBSWorkflow();
    allRuns.push(results);
    appendJsonl(logPath, i, runId, results);
  }

  const summary = computeSummary(allRuns);
  printSummary(summary, runCount, Date.now() - wallStart);

  // Pass if core steps succeed in majority of runs
  const core = ['launchOBS', 'detectMainWindow', 'createScene', 'selectScene', 'openSettings', 'closeSettings'];
  const allCorePassed = core.every((s) => {
    const st = summary[s];
    return st && st.passed >= Math.ceil(st.total / 2);
  });

  console.log(allCorePassed
    ? '[Harness] PASS — core steps reliable\n'
    : '[Harness] FAIL — core steps below threshold\n');
  return allCorePassed;
}

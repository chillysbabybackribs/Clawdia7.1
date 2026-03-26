// src/pilot/run-obs-pilot.ts
import { runHarness } from './obs/obs-harness';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runsIdx = args.indexOf('--runs');
  const runCount = runsIdx !== -1 ? parseInt(args[runsIdx + 1], 10) : undefined;

  if (runCount !== undefined && (isNaN(runCount) || runCount < 1)) {
    console.error('Error: --runs must be a positive integer');
    process.exit(1);
  }

  const passed = await runHarness({ runCount });
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});

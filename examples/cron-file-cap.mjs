// One cap shared across separate script runs (cron jobs, CLIs) via fileStore.
//
//   npm i budget-guard
//   node examples/cron-file-cap.mjs && node examples/cron-file-cap.mjs && node examples/cron-file-cap.mjs
//
// Each invocation is a fresh process. With the default MemoryStore the spend
// would reset every run and the cap would never trigger. fileStore persists it.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetExceededError, guard } from 'budget-guard';
import { fileStore } from 'budget-guard/file';

// In a real cron job use a fixed path, e.g. '/var/tmp/my-job-spend.json'.
// This demo simulates "3 separate runs" in one process by re-creating the store.
const path = join(mkdtempSync(join(tmpdir(), 'bg-demo-')), 'spend.json');
const fakeClient = { create: async () => ({ usage: { input: 1000, output: 1000 } }) }; // ~$0.0125

for (let run = 1; run <= 3; run++) {
  const ai = guard(fakeClient, {
    project: 'nightly-job',
    dailyCapUSD: 0.02, // two calls fit, the third doesn't
    store: fileStore(path), // fresh instance = fresh process, same file
  });
  try {
    await ai.create({ model: 'gpt-4o' });
    console.log(`run ${run}: spent (total persisted in ${path})`);
  } catch (e) {
    if (!(e instanceof BudgetExceededError)) throw e;
    console.log(`run ${run}: BLOCKED — cap reached across previous runs`);
  }
}
// → run 1: spent / run 2: spent / run 3: BLOCKED

// Basic hard cap + per-feature attribution.
//
//   npm i budget-guard
//   node examples/basic-cap.mjs
//
// Uses a fake client so it runs with no API key. In real code you'd pass
// `openai.chat.completions` (or `anthropic.messages`) instead of fakeClient.

import { BudgetExceededError, guard, spendReport } from 'budget-guard';

// Stand-in for a provider client. gpt-5.6 at 1000 in / 1000 out ≈ $0.035/call.
const fakeClient = { create: async () => ({ usage: { input: 1000, output: 1000 } }) };

const ai = guard(fakeClient, {
  project: 'demo-app',
  dailyCapUSD: 0.08, // tiny cap so the demo trips it
});

// Two features share one project-wide daily cap.
await ai.create({ model: 'gpt-5.6' }, { feature: 'summarize' }); // $0.035
await ai.create({ model: 'gpt-5.6' }, { feature: 'summarize' }); // $0.070
await ai.create({ model: 'gpt-5.6' }, { feature: 'embed' }); //     $0.105 — over $0.08

// The next call is blocked because the project crossed its cap.
try {
  await ai.create({ model: 'gpt-5.6' }, { feature: 'embed' });
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.log(`🛡 blocked: spent $${err.spentUsd.toFixed(4)} / cap $${err.capUsd}`);
  } else {
    throw err;
  }
}

// See exactly what cost what, per feature.
console.log('spend by feature:', await spendReport('demo-app'));

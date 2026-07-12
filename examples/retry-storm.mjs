// Detecting a retry storm: a retry loop quietly re-burning money.
//
//   npm i budget-guard
//   node examples/retry-storm.mjs
//
// The provider fails 4 times, an app-level retry loop keeps re-calling, and
// budget-guard flags the streak. The final success carries retryCount so your
// logs show "this call took 5 attempts". No API key needed.

import { guard, MemoryStore } from 'budget-guard';

let attempts = 0;
const flakyClient = {
  async create() {
    if (attempts++ < 4) throw new Error('503 upstream');
    return { usage: { input: 1000, output: 1000 } };
  },
};

const ai = guard(flakyClient, {
  project: 'storm-demo',
  dailyCapUSD: 5,
  store: new MemoryStore(),
  retryStormThreshold: 3,
  onRetryStorm: ({ feature, model, consecutiveFailures }) =>
    console.log(`⚠ retry storm: ${feature}/${model} failed ${consecutiveFailures}x in a row`),
  onSpend: (e) => console.log(`spent $${e.usd.toFixed(4)} (retries before success: ${e.retryCount ?? 0})`),
});

// Typical app-level retry loop.
for (let i = 0; i < 10; i++) {
  try {
    await ai.create({ model: 'gpt-4o' }, { feature: 'enrich' });
    break;
  } catch {
    // backoff would go here
  }
}

console.log('stats:', ai.retryStats());
// → ⚠ retry storm at 3 consecutive failures, then one settle with retryCount: 4,
//   stats: { totalRetries: 4, retryStorms: 1 }

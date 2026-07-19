// Pre-call blocking with the built-in estimator + atomic reservation.
//
//   npm i budget-guard
//   node examples/precall-block.mjs
//
// The estimated cost is atomically reserved BEFORE each call, so even 20
// concurrent workers can't race past the cap together. No API key needed.

import { BudgetExceededError, estimator, guard, MemoryStore } from 'budget-guard';

// Fake provider: each call actually costs ~$0.10 (gpt-4o, 10k output tokens).
const fakeClient = {
  calls: 0,
  async create() {
    this.calls++;
    await new Promise((r) => setTimeout(r, 5)); // network-ish delay
    return { usage: { input: 0, output: 10_000 } };
  },
};

const ai = guard(fakeClient, {
  project: 'concurrent-demo',
  dailyCapUSD: 0.5, // fits 4 estimated calls (each estimate is a hair over $0.10 — prompt tokens count too)
  store: new MemoryStore(),
  estimateUsage: estimator(), // chars/4 heuristic + declared max_tokens
});

// 20 concurrent calls, each estimating ~$0.10 via max_tokens.
const results = await Promise.allSettled(
  Array.from({ length: 20 }, () =>
    ai.create({ model: 'gpt-4o', prompt: 'hi', max_tokens: 10_000 }),
  ),
);

const ok = results.filter((r) => r.status === 'fulfilled').length;
const blocked = results.filter(
  (r) => r.status === 'rejected' && r.reason instanceof BudgetExceededError,
).length;

console.log(
  `succeeded: ${ok}, blocked: ${blocked}, provider actually called: ${fakeClient.calls}x`,
);
// → succeeded: 4, blocked: 16, provider actually called: 4x
// Without atomic reservation, all 20 would have read "spent: $0" and raced through.

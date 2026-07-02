// One shared cap across a fleet of workers (Redis-backed store).
//
//   npm i budget-guard
//   node examples/redis-fleet.mjs
//
// The default in-memory store caps spend per *process*. A worker fleet needs a
// *shared* cap so 10 machines can't each spend the full budget. `redisStore`
// gives you that: every guard instance points at the same Redis, so the cap is
// enforced fleet-wide.
//
// In production you pass a real node-redis client:
//
//   import { createClient } from 'redis';
//   const client = createClient({ url: process.env.REDIS_URL });
//   await client.connect();
//   const store = redisStore(client);           // shared across every worker
//
// To keep this example runnable with zero infra, we back redisStore() with a
// tiny in-memory RedisLike shim below. Swap it for the real client and the
// same code caps a real fleet.

import { BudgetExceededError, guard, redisStore, spendReport } from 'budget-guard';

// --- minimal in-memory stand-in for a node-redis v4 client (RedisLike) ---
function fakeRedis() {
  const m = new Map();
  const toRegExp = (pat) =>
    new RegExp(`^${pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return {
    async incrByFloat(key, amount) {
      const n = (m.get(key) ?? 0) + amount;
      m.set(key, n);
      return n;
    },
    async get(key) {
      return m.has(key) ? String(m.get(key)) : null;
    },
    async expire() {
      /* TTL is a no-op in the shim; real Redis expires keys for daily reset. */
    },
    async scan(_cursor, { MATCH }) {
      const re = toRegExp(MATCH);
      return { cursor: 0, keys: [...m.keys()].filter((k) => re.test(k)) };
    },
  };
}

// One shared store = one shared cap.
const store = redisStore(fakeRedis());

// Spin up three "workers" — separate guard instances, same project, same store.
const workers = [1, 2, 3].map((id) => {
  const ai = guard(
    { create: async () => ({ usage: { input: 1000, output: 1000 } }) },
    { project: 'fleet', dailyCapUSD: 0.05, store },
  );
  return { id, call: () => ai.create({ model: 'gpt-4o' }, { feature: `worker-${id}` }) };
});

// Round-robin calls across the fleet until the *shared* cap ($0.05) trips.
let ok = 0;
let blocked = 0;
for (let i = 0; i < 12; i++) {
  const w = workers[i % workers.length];
  try {
    await w.call();
    ok++;
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      blocked++;
      console.log(`🛡 worker-${w.id} blocked by fleet-wide cap ($${err.spentUsd.toFixed(4)} spent)`);
    } else {
      throw err;
    }
  }
}

console.log(`\n${ok} calls allowed, ${blocked} blocked — all workers shared one $0.05 cap.`);
console.log('spend by worker:', await spendReport('fleet', undefined, store));

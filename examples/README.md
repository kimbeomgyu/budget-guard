# Examples

Runnable, no API key required — each uses a fake client so you can run it as-is:

```bash
npm i budget-guard
node examples/basic-cap.mjs
```

| File | Shows |
| --- | --- |
| [`basic-cap.mjs`](./basic-cap.mjs) | Hard daily cap + per-feature `spendReport()`. The 30-second version. |
| [`cost-observability.mjs`](./cost-observability.mjs) | `onSpend` / `onExceeded` hooks — stream per-call cost into logs, traces, or metrics. |
| [`redis-fleet.mjs`](./redis-fleet.mjs) | One shared cap across a worker fleet via `redisStore` (backed by an in-memory shim so it runs offline). |

In real code, swap the fake client for your provider client
(`openai.chat.completions`, `anthropic.messages`, …) and, for the fleet
example, swap the in-memory shim for a real `node-redis` client.

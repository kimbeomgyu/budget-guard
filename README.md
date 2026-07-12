# budget-guard

[![CI](https://github.com/kimbeomgyu/budget-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/kimbeomgyu/budget-guard/actions/workflows/ci.yml)
[![CodeQL](https://github.com/kimbeomgyu/budget-guard/actions/workflows/codeql.yml/badge.svg)](https://github.com/kimbeomgyu/budget-guard/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/kimbeomgyu/budget-guard/badge)](https://scorecard.dev/viewer/?uri=github.com/kimbeomgyu/budget-guard)
[![Security Policy](https://img.shields.io/badge/security-policy-blue.svg)](./SECURITY.md)
[![npm version](https://img.shields.io/npm/v/budget-guard.svg)](https://www.npmjs.com/package/budget-guard)
[![npm downloads](https://img.shields.io/npm/dm/budget-guard.svg)](https://www.npmjs.com/package/budget-guard)
[![license](https://img.shields.io/npm/l/budget-guard.svg)](./LICENSE)

**A circuit breaker for your LLM API bill.** One wrap, set a hard daily cap — runaway retry loops get blocked *before* they bill you. Plus per-feature cost attribution so you know what actually costs what.

> Built for indie devs who've seen "a $40 bill from a $5 task." Works with the OpenAI / Anthropic / Gemini SDKs directly, or through the Vercel AI SDK (v5 + v7), LangChain.js, LlamaIndex.TS and Mastra adapters. Drop-in: your calls still go straight to the provider — `budget-guard` just counts and caps.

Free & open source (MIT). A hosted dashboard with cross-project spend + alerts is planned — but the SDK is, and stays, free.

## Install

```bash
npm i budget-guard
```

## Use it (OpenAI)

```ts
import OpenAI from 'openai';
import { guard } from 'budget-guard';

const openai = new OpenAI();
const ai = guard(openai.chat.completions, { project: 'my-app', dailyCapUSD: 50 });

// use it exactly like before — just add an optional feature tag
const res = await ai.create(
  { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
  { feature: 'chat' },
);
```

If today's spend for `my-app` is already past `$50`, the **next call throws `BudgetExceededError` before it bills**. No more 3am surprise invoices.

## Use it (Anthropic)

```ts
import Anthropic from '@anthropic-ai/sdk';
import { guard } from 'budget-guard';

const anthropic = new Anthropic();
const ai = guard(anthropic.messages, { project: 'my-app', dailyCapUSD: 50 });

await ai.create(
  { model: 'claude-opus-4', max_tokens: 1024, messages: [{ role: 'user', content: 'hi' }] },
  { feature: 'summarize' },
);
```

`budget-guard` auto-detects the usage shapes of OpenAI (incl. Azure, Mistral, DeepSeek, xAI), Anthropic, Google Gemini (`usageMetadata`), AWS Bedrock Converse and Cohere (`billed_units`). Cached and reasoning tokens are billed at their real per-class rates — including the provider quirks (xAI and Gemini report reasoning *outside* the output count; budget-guard adds it back so you're not silently under-counting). For anything else, pass your own extractor:

```ts
guard(client, opts, { usageOf: (res) => ({ input: res.in, output: res.out }) });
```

## Know what costs what

```ts
import { spendReport } from 'budget-guard';

await spendReport('my-app'); // async
// → { chat: 2.41, summarize: 0.88 }   (today, in USD)
```

## Shared caps across instances (Redis)

By default the ledger lives in memory (per process) — great for a single script, worker, or agent. Running multiple instances? Pass a shared store so they enforce **one cap together** and survive restarts:

```ts
import { createClient } from 'redis';
import { guard, redisStore } from 'budget-guard';

const redis = createClient();
await redis.connect();

const ai = guard(openai.chat.completions, {
  project: 'my-app',
  dailyCapUSD: 50,
  store: redisStore(redis), // node-redis v4; keys auto-expire (~2 days)
});
```

`store` accepts anything implementing the tiny `SpendStore` interface (`add` / `get` / `entries`, plus optional `addIfUnder` for atomic reservations — `redisStore` implements that as a server-side Lua script), so you can back it with whatever you already run.

## Persist across script runs (file)

Cron jobs and short-lived scripts are where in-memory caps quietly fail — every run starts from $0. `fileStore` keeps the ledger in a single JSON file, so 100 runs a day share one cap:

```ts
import { guard } from 'budget-guard';
import { fileStore } from 'budget-guard/file';

const ai = guard(openai.chat.completions, {
  project: 'nightly-job',
  dailyCapUSD: 5,
  store: fileStore('/var/tmp/my-app-spend.json'),
});
```

Writes are atomic (temp file + rename), parent directories are created, and a corrupted file throws instead of silently resetting your budget. Storage tiers: **memory** = one process, **file** = one machine, **redis** = a fleet. (Concurrent processes should use `redisStore` — the file store targets sequential runs.)

## Block *before* the call (no overshoot)

By default the cap is enforced on the **next** call after you cross it, so one call can overshoot. Give it an estimator and it blocks the offending call itself — the built-in one is a one-liner:

```ts
import { guard, estimator } from 'budget-guard';

const ai = guard(openai.chat.completions, {
  project: 'my-app',
  dailyCapUSD: 50,
  estimateUsage: estimator(), // chars/4 heuristic — fine for a circuit breaker
});
```

`estimator()` reads `prompt` / `system` / `messages` for the input estimate and the declared `max_tokens` (or `maxOutputTokens`) for the output. It knows the new Claude tokenizer generation counts ~30% more tokens (Opus 4.7+, Sonnet 5+, Fable, Mythos — corrected automatically), and it adds tool-schema overhead when you pass `tools`. Want exact counts? Inject any tokenizer:

```ts
import { countTokens } from 'gpt-tokenizer';
estimateUsage: estimator({ countTokens });
```

**Concurrency-safe:** when the store supports it (built-in memory, file and redis stores all do), the estimated cost is **reserved atomically before the call** and settled to the actual cost after — so 100 parallel workers can't race past the cap together. Failed calls roll their reservation back.

## LlamaIndex.TS

Wrap any LlamaIndex LLM — the cap applies before each call and non-streaming
`chat()` is metered from the response:

```ts
import { guardLlamaIndex } from 'budget-guard';

const llm = guardLlamaIndex(openai({ model: 'gpt-4o' }), { project: 'my-app', dailyCapUSD: 50 });
Settings.llm = llm; // or call llm.chat(...) directly
```

Usage is read from `response.raw` (works across providers). Streaming `chat()` is
metered too — each chunk's `raw` is watched for OpenAI / Anthropic / Gemini usage
shapes and the spend is settled when the stream ends. If the provider doesn't put
usage in the stream, you get a warning instead of a silent zero. Zero new
dependencies.

## LangChain.js

Attach the callback handler to any LangChain model or chain — the cap is enforced
before each call, and cost is metered from the response:

```ts
import { BudgetGuardHandler } from 'budget-guard/langchain';

const handler = new BudgetGuardHandler({ project: 'my-app', dailyCapUSD: 50, model: 'gpt-4o' });
await model.invoke(input, { callbacks: [handler] }); // over cap → throws before the call
```

Reads usage from `usage_metadata` (falling back to `llmOutput.tokenUsage`). Pass
`model` for reliable pricing (it's also auto-detected from the response when
present). Needs `@langchain/core` (an optional peer dependency).

## Typed per-provider helpers

`guardOpenAI` / `guardAnthropic` / `guardGemini` are thin wrappers that set
`provider` for you — so streaming is metered correctly without remembering the
option:

```ts
import { guardAnthropic } from 'budget-guard';

const ai = guardAnthropic(anthropic.messages, { project: 'my-app', dailyCapUSD: 50 });
// streaming already knows it's Anthropic — no `provider` to forget
```

## Streaming

Streaming calls are metered too — just pass `stream: true` as usual. budget-guard
passes every chunk straight through to you and reads the usage from the final
chunk, so the cost lands once, after the stream finishes:

```ts
const ai = guard(openai.chat.completions, { project: 'my-app', dailyCapUSD: 50 });

const stream = await ai.create({ model: 'gpt-4o', stream: true }, { feature: 'chat' });
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
// cost is recorded once the loop finishes
```

For OpenAI it injects `stream_options: { include_usage: true }` for you (OpenAI
only sends usage on the final chunk when that flag is set). The cap is still
enforced _before_ the call.

For **Anthropic** streaming, set `provider: 'anthropic'` — it reads usage from the
`message_start` / `message_delta` events and skips the OpenAI-only injection:

```ts
const ai = guard(anthropic.messages, {
  project: 'my-app',
  dailyCapUSD: 50,
  provider: 'anthropic',
});
const stream = await ai.create({ model: 'claude-sonnet-4-6', stream: true, max_tokens: 1024 });
for await (const event of stream) { /* ... */ }
```

For **Gemini** streaming, set `provider: 'gemini'` — usage comes from each chunk's
`usageMetadata` (the last one carries the totals).

## Vercel AI SDK

Using the [AI SDK](https://sdk.vercel.dev)? Wrap any model with the middleware —
no client to guard, the cap and per-feature metering apply automatically. Works
with **both AI SDK v5 and v7** (the usage shape is auto-detected per call — one
entry point, nothing to configure):

```ts
import { wrapLanguageModel, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { budgetGuardMiddleware } from 'budget-guard';

const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: budgetGuardMiddleware({ project: 'my-app', dailyCapUSD: 50, feature: 'chat' }),
});

await generateText({ model, prompt: 'hi' }); // over cap → throws before the model call
```

Meters both `generateText` and `streamText` (usage read from the stream's `finish`
part). Over-cap `streamText` blocks before the model call; the error arrives on the
SDK's standard error channel (`onError`, or `await result.text`) — `textStream`
swallows stream errors by default.

## Mastra

Mastra agents run on Vercel AI SDK models, so the middleware above already covers
them — wrap the model before handing it to your agent, no Mastra-specific code:

```ts
import { wrapLanguageModel } from 'ai';
import { Agent } from '@mastra/core/agent';
import { budgetGuardMiddleware } from 'budget-guard';

const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: budgetGuardMiddleware({ project: 'my-app', dailyCapUSD: 50 }),
});

const agent = new Agent({ id: 'support', model, instructions: '…' });
// (or withMastra(model, { … }) if you use @mastra/ai-sdk directly)
```

The cap and metering apply to every model call the agent makes.

## See every call's cost (observability)

A hard cap stops the bleeding; `onSpend` lets you *watch* it. It fires on every
successful call with a `SpendEvent`, so you can pipe per-call cost straight into
your logs, traces, or a dashboard:

```ts
const ai = guard(openai.chat.completions, {
  project: 'my-app',
  dailyCapUSD: 50,
  onSpend: (e) => {
    // { project, feature, model, usd, dayTotalUsd }
    console.log(JSON.stringify({ evt: 'llm_spend', ...e }));
  },
  onExceeded: ({ project, spentUsd, capUsd }) => {
    metrics.increment('llm.cap_hit', { project }); // fires before block/warn
  },
});
```

Keep the callback light — it runs synchronously just before the response is
returned. Push heavy work (network, disk) onto a queue.

## Catch retry storms

The most expensive LLM bug class isn't a big prompt — it's a retry loop quietly re-burning money all night. budget-guard tracks consecutive provider failures per (feature, model) and tells you when it looks like a storm:

```ts
const ai = guard(openai.chat.completions, {
  project: 'my-app',
  dailyCapUSD: 50,
  retryStormThreshold: 5,
  onRetryStorm: ({ feature, model, consecutiveFailures }) =>
    alert(`retry storm: ${feature}/${model} failed ${consecutiveFailures}x in a row`),
});

ai.retryStats(); // → { totalRetries, retryStorms }
```

A success resets the streak and stamps `retryCount` on that call's `SpendEvent`, so your logs show "this $0.40 call took 7 attempts". Cap-blocked calls don't count — only calls that actually reached the provider.

## Monthly caps & time zones

Cap per month instead of per day, and reset on your billing time zone's calendar
(not UTC):

```ts
const ai = guard(openai.chat.completions, {
  project: 'my-app',
  dailyCapUSD: 500,          // the cap for the period
  period: 'monthly',         // 'daily' (default) | 'monthly'
  timezone: 'America/New_York', // optional IANA zone; default UTC
});
```

An invalid `timezone` throws at construction. With a `redisStore`, set
`ttlSeconds` to cover a month (e.g. `60 * 60 * 24 * 40`) so monthly counters don't
expire early. To read the current period's total, use `periodKey`:

```ts
import { spentTotal, periodKey } from 'budget-guard';
await spentTotal('my-app', store, periodKey(new Date(), 'monthly', 'America/New_York'));
```

## Test your budget logic

`budget-guard/testing` ships the pieces you need to test caps deterministically — usage factories, a fixed clock for day/month boundaries, an operation-recording store:

```ts
import { buildOpenAIUsage, createFixedClock, FakeSpendStore } from 'budget-guard/testing';

const store = new FakeSpendStore();
const ai = guard(fakeClient, { project: 't', dailyCapUSD: 1, store },
  { now: createFixedClock('2026-01-31T23:59:00Z') });
// ...assert on store.ops: every add/get/addIfUnder, in order, with amounts
```

## Options

```ts
guard(client, {
  project: 'my-app',     // groups spend & shares one cap
  dailyCapUSD: 50,       // hard cap per period
  period: 'daily',       // 'daily' (default) | 'monthly'
  timezone: 'UTC',       // optional IANA zone for cap reset (default UTC)
  onCap: 'block',        // 'block' (throw) | 'warn' (log only). default 'block'
  store: myStore,        // optional SpendStore (default: in-memory, per-process)
  estimateUsage: fn,     // optional: block before a call would exceed the cap (see estimator())
  onSpend: fn,           // optional: SpendEvent per successful call (logs/traces)
  onExceeded: fn,        // optional: fires when the cap is hit (before block/warn)
  retryStormThreshold: 5,// optional: consecutive-failure streak that fires onRetryStorm
  onRetryStorm: fn,      // optional: called once when the streak hits the threshold
  provider: 'anthropic', // optional: 'openai' (default) | 'anthropic' | 'gemini' — for streaming
  onMissingUsage: 'zero',// optional: 'throw' (default) | 'zero' — when a response has no usage
});
```

## Warn instead of block

```ts
const ai = guard(openai.chat.completions, { project: 'my-app', dailyCapUSD: 50, onCap: 'warn' });
// over cap → logs a warning, still calls. Good for easing in.
```

## Examples

Runnable, no API key needed — see [`examples/`](./examples):

- [`basic-cap.mjs`](./examples/basic-cap.mjs) — hard cap + per-feature `spendReport()`
- [`cost-observability.mjs`](./examples/cost-observability.mjs) — stream per-call cost via `onSpend`
- [`redis-fleet.mjs`](./examples/redis-fleet.mjs) — one shared cap across a worker fleet
- [`precall-block.mjs`](./examples/precall-block.mjs) — `estimator()` + atomic reservation under 20 concurrent calls
- [`cron-file-cap.mjs`](./examples/cron-file-cap.mjs) — one cap across separate script runs via `fileStore`
- [`retry-storm.mjs`](./examples/retry-storm.mjs) — catching a retry loop that re-burns money

## Notes

- **Zero runtime dependencies.** Adapters use structural typing or optional peer deps; the tokenizer for `estimator()` is bring-your-own.
- **Never silently zero.** Unknown usage shapes and corrupted spend files throw by default (`onMissingUsage: 'zero'` opts out per guard) — a budget tool shouldn't quietly stop counting.
- The Redis Lua reservation path is integration-tested against a real Redis in CI (atomicity, TTL, `NOSCRIPT` fallback).
- Prices live in `PRICES` (USD per 1K tokens, incl. per-class cache rates and the per-provider reasoning-token convention) — PRs to keep them current are welcome.
- See [ROADMAP.md](./ROADMAP.md) for what's next (hosted dashboard is the only major thing left).

## Migrating from 0.1

`spendReport()` is now `async` — add `await`. Everything else is backward compatible (no `store` = same in-process behavior).

## License

MIT

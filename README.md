# budget-guard

[![CI](https://github.com/kimbeomgyu/budget-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/kimbeomgyu/budget-guard/actions/workflows/ci.yml)
[![CodeQL](https://github.com/kimbeomgyu/budget-guard/actions/workflows/codeql.yml/badge.svg)](https://github.com/kimbeomgyu/budget-guard/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/kimbeomgyu/budget-guard/badge)](https://scorecard.dev/viewer/?uri=github.com/kimbeomgyu/budget-guard)
[![Security Policy](https://img.shields.io/badge/security-policy-blue.svg)](./SECURITY.md)
[![npm version](https://img.shields.io/npm/v/budget-guard.svg)](https://www.npmjs.com/package/budget-guard)
[![npm downloads](https://img.shields.io/npm/dm/budget-guard.svg)](https://www.npmjs.com/package/budget-guard)
[![license](https://img.shields.io/npm/l/budget-guard.svg)](./LICENSE)

**A circuit breaker for your LLM API bill.** One wrap, set a hard daily cap — runaway retry loops get blocked *before* they bill you. Plus per-feature cost attribution so you know what actually costs what.

> Built for indie devs shipping on the OpenAI / Anthropic APIs who've seen "a $40 bill from a $5 task." Drop-in: your calls still go straight to the provider — `budget-guard` just counts and caps.

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

`budget-guard` auto-detects OpenAI (`prompt_tokens`/`completion_tokens`) and Anthropic (`input_tokens`/`output_tokens`) usage shapes. For anything else, pass your own extractor:

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

`store` accepts anything implementing the tiny `SpendStore` interface (`add` / `get` / `entries`), so you can back it with whatever you already run.

## Block *before* the call (no overshoot)

By default the cap is enforced on the **next** call after you cross it, so one call can overshoot. Give it an estimator and it blocks the offending call itself:

```ts
import { encode } from 'gpt-tokenizer'; // or any tokenizer

const ai = guard(openai.chat.completions, {
  project: 'my-app',
  dailyCapUSD: 50,
  estimateUsage: (args) => ({
    input: args.messages.reduce((n, m) => n + encode(m.content).length, 0),
    output: args.max_tokens ?? 512,
  }),
});
```

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
no client to guard, the cap and per-feature metering apply automatically:

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

## Options

```ts
guard(client, {
  project: 'my-app',     // groups spend & shares one cap
  dailyCapUSD: 50,       // hard cap per day
  onCap: 'block',        // 'block' (throw) | 'warn' (log only). default 'block'
  store: myStore,        // optional SpendStore (default: in-memory, per-process)
  estimateUsage: fn,     // optional: block before a call would exceed the cap
  onSpend: fn,           // optional: SpendEvent per successful call (logs/traces)
  onExceeded: fn,        // optional: fires when the cap is hit (before block/warn)
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

## Notes (v0.2)

- **Multi-instance + persistence** via a pluggable `SpendStore` (in-memory default, Redis adapter included, or bring your own).
- **No-overshoot mode** when you supply `estimateUsage`; otherwise the cap is enforced on the next call after you cross it.
- `spendReport()` is async.
- Prices live in `PRICES` (USD per 1K tokens) — PRs to keep them current are welcome.
- Roadmap: streaming usage, more providers, a hosted dashboard. See ROADMAP.

## Migrating from 0.1

`spendReport()` is now `async` — add `await`. Everything else is backward compatible (no `store` = same in-process behavior).

## License

MIT

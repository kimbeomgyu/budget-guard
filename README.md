# budget-guard

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

spendReport('my-app');
// → { chat: 2.41, summarize: 0.88 }   (today, in USD)
```

## Options

```ts
guard(client, {
  project: 'my-app',     // groups spend & shares one cap
  dailyCapUSD: 50,       // hard cap per day
  onCap: 'block',        // 'block' (throw) | 'warn' (log only). default 'block'
});
```

## Warn instead of block

```ts
const ai = guard(openai.chat.completions, { project: 'my-app', dailyCapUSD: 50, onCap: 'warn' });
// over cap → logs a warning, still calls. Good for easing in.
```

## Notes (v0.1)

- Caps are accounted **after each call** and enforced on the **next** one (no pre-call token estimation yet).
- The ledger is in-memory per process. Persistence + a hosted dashboard are on the roadmap.
- Prices live in `PRICES` (USD per 1K tokens) — PRs to keep them current are welcome.

## License

MIT

# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Reasoning-token billing convention** — providers disagree on whether reasoning
  tokens are counted inside the output-token figure. New `reasoningInOutput` flag on
  `PRICES` rows (default `true`): for xAI Grok (excluded from `completion_tokens`)
  and Gemini (`thoughtsTokenCount` sits outside `candidatesTokenCount`) it is `false`,
  and `cost()` now bills those reasoning tokens at the output rate instead of
  silently under-charging. OpenAI/Anthropic are unchanged (already included — no
  double-count).

### Added

- **Retry-storm detection** — the most expensive LLM bug class is a retry loop
  quietly re-burning money. New `retryStormThreshold` + `onRetryStorm` on
  `GuardOptions`: guard tracks consecutive provider-call failures per
  (feature, model) and fires the callback once when the streak hits the threshold
  (success resets it; cap-blocks don't count — only calls that reached the
  provider). The settling success's `SpendEvent` carries `retryCount`, and the
  guarded client gains `retryStats()` → `{ totalRetries, retryStorms }`.

- **Atomic cap reservation (kills the TOCTOU race)** — optional
  `SpendStore.addIfUnder(key, amount, cap)`: atomically add-if-it-fits, return `-1`
  (no mutation) otherwise. `MemoryStore` implements it synchronously; `redisStore`
  implements it as a server-side Lua script (`SCRIPT LOAD` + `EVALSHA`, `EVAL`
  fallback on `NOSCRIPT`) when the client exposes `eval`/`evalSha`. When you pass
  `estimateUsage` (and `onCap` is `'block'`), `guard()` now *reserves* the estimated
  cost atomically before the call and settles the difference after — 100 concurrent
  $0.10 calls against a $5 cap let exactly 50 through instead of all 100 racing past
  the check. Failed calls roll the reservation back. Stores without `addIfUnder`
  keep the previous behavior.

- **Vercel AI SDK v7 support** — `budgetGuardMiddleware` now works with both AI SDK
  v5 (`LanguageModelV2`, flat `usage.inputTokens`) and v7 (`LanguageModelV4`, nested
  `usage.inputTokens.total` / `outputTokens.total`), auto-detected per call from the
  usage shape — one entry point, no options. v7 `cacheRead` maps to `cachedInput`;
  v7 `outputTokens.total` already includes reasoning tokens so they are not
  double-billed. Verified against real `ai@7.0.22` (generateText + streamText,
  over-cap blocked before `doGenerate`/`doStream`) and real `ai@5` (no regression).

- **Monthly caps & IANA time zones** — `period: 'daily' | 'monthly'` and an optional
  `timezone` on `GuardOptions`. The cap resets on the configured zone's calendar day
  or month (default daily/UTC — unchanged). Invalid `timezone` throws at
  construction. New exported `periodKey(date, period?, timezone?)` helper to compute
  the current period's key for reads. (With `redisStore` + monthly, raise
  `ttlSeconds` to cover a month.)

## [0.5.0] - 2026-07-05

### Added

- **Mastra support** (docs) — Mastra agents run on Vercel AI SDK models, so the
  `budgetGuardMiddleware` covers them with no Mastra-specific code; documented the
  `wrapLanguageModel` → `Agent({ model })` pattern (verified against
  `@mastra/ai-sdk`).
- **LlamaIndex.TS adapter** — `guardLlamaIndex(llm, opts)` wraps any LlamaIndex LLM
  (structural typing, zero new deps): the hard cap applies before each call and
  non-streaming `chat()` is metered from `response.raw` (usage extracted across
  provider shapes). Streaming `chat()` still enforces the cap (metering to follow).
  Also exports `enforceDailyCap()` internally used by adapters.
- **LangChain.js adapter** (`budget-guard/langchain`) — `BudgetGuardHandler`, a
  `BaseCallbackHandler` that enforces the hard cap before each call
  (`handleLLMStart` / `handleChatModelStart`, with `raiseError` so it actually
  aborts) and meters cost on `handleLLMEnd` (prefers `usage_metadata`, falls back
  to `llmOutput.tokenUsage`). `@langchain/core` is an optional peer dependency;
  the main entry stays dependency-free. Also exports `spentTotal(project, store?,
  day?)`.
- Typed per-provider helpers `guardOpenAI` / `guardAnthropic` / `guardGemini` —
  thin wrappers over `guard()` that preset `provider`, so streaming is metered
  correctly for that provider without passing the option (removes the
  "forgot `provider: 'anthropic'`" footgun).

## [0.4.0] - 2026-07-05

### Added

- **OpenAI streaming** support — `guard(...).create({ stream: true })` now meters
  streamed responses. Chunks pass straight through to the caller; usage is read
  from the final chunk and billed once when the stream finishes. `stream_options:
  { include_usage: true }` is injected automatically. The pre-call cap still
  applies.
- **Anthropic & Gemini streaming** support via a new optional `provider: 'openai'
  | 'anthropic' | 'gemini'` on `GuardOptions`. With `'anthropic'`, streamed usage
  is assembled from `message_start` (input + cache) and `message_delta`
  (cumulative output — replaced, not summed). With `'gemini'`, usage is read from
  each chunk's `usageMetadata` (the last carries the totals). For both, the
  OpenAI-only `stream_options` injection is skipped.
- `onMissingUsage: 'throw' | 'zero'` (`GuardOptions`, default `'throw'`) — controls
  what happens when a response/stream has no recognizable usage. `'throw'` keeps
  the current behavior (never silently under-counts); `'zero'` logs a warning and
  bills $0 so the call still succeeds. Applies to both streaming and non-streaming.
- **Vercel AI SDK adapter** — `budgetGuardMiddleware(opts)` returns a middleware for
  `wrapLanguageModel`, applying the hard cap (before the model call) and per-feature
  metering to any AI SDK model. Meters both `generateText` (`wrapGenerate`) and
  `streamText` (`wrapStream`, usage from the stream's `finish` part). Zero new
  dependencies (structurally typed).

## [0.3.1] - 2026-07-02

### Added

- Public `onSpend` callback (`GuardOptions`) — emits a `SpendEvent`
  (`{ project, feature, model, usd, dayTotalUsd }`) on every successful call, so
  per-call cost can be piped into your own logs, traces, or dashboard. The
  observability half of the "cap + traces" safety story (promoted from an
  internal hook to public API).
- `examples/` directory — runnable, no-API-key examples: `basic-cap`,
  `cost-observability` (`onSpend`), and `redis-fleet` (one shared cap across
  worker instances).

## [0.3.0] - 2026-07-02

### Added

- Provider usage coverage beyond OpenAI/Anthropic: **Google Gemini**
  (`usageMetadata`), **AWS Bedrock Converse** (camelCase + `us.`/`eu.` region-prefix
  resolution), **Azure Responses API**, and **Cohere** (`billed_units`).
- Optional `cachedInput` / `reasoning` fields on `Usage`, extracted from OpenAI
  (`prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`),
  Anthropic (`cache_read_input_tokens`), Gemini, and Azure shapes.
- **Per-class cache cost model**: `cost()` bills cached input tokens at a model's
  `cachedIn` rate (falling back to the input rate).
- Expanded `PRICES` with current models (gpt-4.1, o3/o4-mini, Claude Opus 4.8 /
  Sonnet 4.6 / Haiku 4.5, Gemini 2.5 pro/flash, DeepSeek, Grok) and an optional
  `retiresOn` deprecation field.
- `onExceeded` callback (`GuardOptions`), fired with `{ project, spentUsd, capUsd }`
  when the cap is hit.
- Typed `UnknownUsageShapeError`.

### Changed

- `normalizeUsage` now throws the typed `UnknownUsageShapeError` (a subclass of
  `Error`) for missing/unrecognized usage instead of a generic error — never
  silently returns zero. Backward compatible for `try/catch (Error)`.

## [0.2.2] - 2026-07-01

### Changed

- Hardened the release pipeline: npm publish via OIDC trusted publishing (with
  provenance) behind a required-reviewer `release` environment gate; all GitHub
  Actions pinned to commit SHAs.
- Dev tooling: TypeScript 6, Vitest 4, Biome.
- No functional or public-API changes.

## [0.2.1] - 2026-07-01

### Changed

- CI/CD via GitHub Actions (test matrix + npm publish on tag), npm badges, and
  packaging metadata. No functional or public-API changes.

## [0.2.0] - 2026-06-28

### Added

- Pluggable `SpendStore` — in-memory default plus a Redis adapter (`redisStore`)
  for shared caps across instances and persistence.
- `estimateUsage` for no-overshoot mode — block a call _before_ it crosses the cap.
- `package.json` export.

### Changed

- **Breaking:** `spendReport()` is now `async` — add `await`. Otherwise backward
  compatible (no `store` = same in-process behavior).

## [0.1.1] - 2026-06-28

### Fixed

- Add explicit `.js` extensions to relative imports so the package resolves under
  Node's `NodeNext` / ESM module resolution.

## [0.1.0] - 2026-06-28

### Added

- Initial release: hard daily budget caps (`guard`, `dailyCapUSD`,
  `BudgetExceededError`), per-feature cost attribution (`spendReport`), and
  auto-detection of OpenAI / Anthropic usage shapes.

[Unreleased]: https://github.com/kimbeomgyu/budget-guard/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/kimbeomgyu/budget-guard/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kimbeomgyu/budget-guard/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/kimbeomgyu/budget-guard/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kimbeomgyu/budget-guard/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/kimbeomgyu/budget-guard/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/kimbeomgyu/budget-guard/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kimbeomgyu/budget-guard/releases/tag/v0.2.0
[0.1.1]: https://www.npmjs.com/package/budget-guard/v/0.1.1
[0.1.0]: https://www.npmjs.com/package/budget-guard/v/0.1.0

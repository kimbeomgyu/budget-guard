# Roadmap

**Direction.** budget-guard aims to be the best *tiny, zero-infra* cost guardrail for LLM APIs:
a drop-in SDK that hard-caps spend, blocks *before* overspending, and attributes cost per feature.
**Growth strategy: meet developers where they already are — framework adapters (distribution as code).**
Out of scope for this package: dashboards, analytics, multi-tenant UI — those belong to a separate
hosted layer, NOT here. Keep the core small, dependency-free, and sharp.

Pick the FIRST unchecked `- [ ]` and ship it small, fully-verified, one per PR/commit.

## Builder notes (accuracy — read before implementing)
- **Two reasoning-token conventions** (top source of silent cost bugs): OpenAI / Azure / DeepSeek / Anthropic-thinking count reasoning *inside* output tokens (don't double-add); **xAI Grok EXCLUDES reasoning from `completion_tokens`** — add it before billing. Gemini `thoughtsTokenCount` bills at output rate.
- **Cache discounts vary wildly** — not one constant: DeepSeek cache-hit ~2%, Gemini/Mistral ~10%, OpenAI cached ~25-75% off, Anthropic cache-read 10% / cache-write 125% (5m) or 200% (1h). Model per-class rates.
- **Streaming usage is opt-in / event-specific** — OpenAI needs `stream_options.include_usage`; Anthropic `message_delta.usage` is *cumulative* (replace, don't add).
- **Vercel AI SDK is version-split**: `npm i ai` today = v7 (`LanguageModelV4Middleware`, nested `usage.inputTokens.total`); much prod code is v5 (`LanguageModelV2Middleware`, flat `usage.inputTokens`). Pin-check the installed major.
- **Prices change** — treat any number here as a starting point; verify against the provider's official pricing page in the same PR. Add a `deprecated`/`retiresOn` field to PRICES.
- Every change ships only if unit tests + `tsc` build + the real-consumer tarball smoke all pass.
- **Never publish personal contact info or set up unattended npm publish.** For CoC / SECURITY / FUNDING use GitHub-native flows (private vulnerability reporting, Security Advisories); publishing stays human / release-environment gated.

## Phase 0 — Repo health & trust ✅ DONE (completed by the maintainer in parallel; autobuilder should skip)
CI (test/lint/build) · CodeQL SAST · OpenSSF Scorecard · SECURITY.md + private vuln reporting ·
issue templates + config · PR template · dependabot · CHANGELOG · README badges · community-health files.
- [x] CI · [x] README badges · [x] CONTRIBUTING · [x] CODE_OF_CONDUCT
- [x] SECURITY.md + private vuln reporting · [x] issue templates + config · [x] PR template · [x] CHANGELOG
- (changesets tooling optional — revisit only if manual versioning becomes a chore)

## Phase 1 — Core correctness & coverage
- [x] **normalizeUsage: throw on unknown shapes** — return `{input, output}` (+ optional `cachedInput`, `reasoning`); throw `UnknownUsageShapeError` for unrecognized/`null` usage instead of silently returning 0. Test: known shapes pass; `{foo:1}` and `null` throw.
- [x] **Add Gemini** — normalize `usageMetadata` (`promptTokenCount`→input, `candidatesTokenCount`→output, `thoughtsTokenCount`→reasoning, `cachedContentTokenCount` as cached subset of input) + add gemini-2.5-pro/flash prices. Test: sample `usageMetadata` → correct `{input,output,reasoning,cachedInput}` and cost.
- [x] **Add Bedrock Converse** — normalize camelCase `inputTokens`/`outputTokens`/`cacheReadInputTokens`/`cacheWriteInputTokens`; resolve `us.`/`eu.` model-id prefixes to the base PRICES row. Test: `us.anthropic.claude-sonnet-4` resolves same row as base.
- [x] **Add Azure dual-shape** — detect Chat Completions (`prompt_tokens`) vs Responses API (`input_tokens`) and route; pull `*_tokens_details.cached_tokens` / `reasoning_tokens` from whichever nesting. Test: both shapes → equivalent normalized object.
- [x] **Cohere `billed_units`** — normalize from `usage.billed_units.{input_tokens,output_tokens}` (bill from billed_units, not raw `tokens`). Test: sample → correct cost.
- [x] **Reasoning-token convention flag** — `reasoningInOutput?: boolean` on PRICES rows (default true = reasoning already inside output count). `false` for xAI Grok (excluded from `completion_tokens`) **and Gemini** (`thoughtsTokenCount` outside `candidatesTokenCount` — was silently under-billing); `cost()` adds those reasoning tokens at the output rate. Test: xAI `{output:100, reasoning:400}` bills 500; OpenAI `{output:500, reasoning:400}` bills 500 (no double-count); Gemini `{output:200, reasoning:300}` bills 500.
- [x] **Per-class cache cost model** — PRICES rows gain optional `cachedInput`/`cacheRead`/`cacheWrite5m`/`cacheWrite1h`; `cost()` bills each token class at its rate, falling back to input rate when undefined. Test: Anthropic read/write multipliers (0.1×/1.25×/2×) and DeepSeek cache-hit (~2%) compute correctly.
- [x] **Expand PRICES + deprecation field** — add current models (gpt-4.1, o-series, claude sonnet/haiku, gemini flash/pro, mistral, deepseek, grok) with a `retiresOn?` field; a test guards the table shape (every row has input+output numbers).
- [x] **`onExceeded` callback** — allow a custom handler on cap hit alongside `'block' | 'warn'`. Test: handler is called with `{project, spentUsd, capUsd}` and can override behavior.
- [x] **`onSpend` observability hook** — public per-call `SpendEvent` (`{project,feature,model,usd,dayTotalUsd}`) callback on `GuardOptions`, so cost can be piped into logs/traces/dashboards. (dev.to feedback @raju_dandigam: "cost caps + execution traces feel like two sides of the same safety story".) Test: callback fires once per successful call with accumulating `dayTotalUsd`.
- [x] **Graceful missing/partial usage** — `onMissingUsage: 'throw' | 'zero'` (default **'throw'**, preserving the "never silently zero" behavior from the throw-on-unknown change; safest for a budget tool). `'zero'` logs a warning + bills $0 so the call still succeeds. Applies to streaming + non-streaming via a shared `resolveUsage` helper. Test: default throws (UnknownUsageShapeError), 'zero' resolves + bills $0 + warns + doesn't trip the cap. (Dropped the ambiguous `'estimate'` mode and the `missingUsageIncidents` counter as YAGNI — the warning is the signal; revisit if requested.)
- [x] **`examples/` directory** — runnable, no-API-key examples: `basic-cap` (cap + spendReport), `cost-observability` (`onSpend`/`onExceeded`), `redis-fleet` (shared cap across worker instances via `redisStore`, backed by an in-memory shim so it runs offline — lands @raju_dandigam's "much more useful for worker fleets" note; the Redis store shipped in v0.2 *after* the launch article).

## Phase 2 — Streaming usage (correctness gap)
- [x] **OpenAI streaming** — when `stream:true`, inject `stream_options.include_usage:true`, read usage from the terminal `choices:[]` chunk, ignore `null` usage on intermediate chunks. Test: 5 null chunks + final usage chunk → cost recorded once; assert flag injected. (Chunks pass through unchanged; billed once after the stream is consumed; pre-call cap still applies.)
- [x] **Anthropic streaming** — capture input+cache from `message_start.message.usage`; on `message_delta.usage` REPLACE output (cumulative, not additive). Test: start `{input:100,output:1}` + delta `{output:120}` → bills 100in/120out (not 121). (Gated by new `provider: 'anthropic'` hint; skips OpenAI `stream_options` injection. Reader lives in `src/stream.ts`.)
- [x] **Gemini streaming** — aggregate `usageMetadata` from the final streamed chunk. Test: streamed chunks ending with usageMetadata → recorded once. (Gated by `provider: 'gemini'`; last non-null `usageMetadata` = totals; skips `stream_options` injection.)

## Phase 3 — Framework adapters (distribution as code)  ← strategic centerpiece
- [x] **Vercel AI SDK v5 middleware** — `budgetGuardMiddleware()` returning a `LanguageModelV2Middleware`-shaped object (structurally typed, zero dep); `wrapGenerate` (generateText) + `wrapStream` (streamText, usage from the `finish` stream part) both do the pre-call cap throw + post-call meter by **reusing `guard()`** (streaming path reused via a `streamReader` internals hook — no billing logic duplicated). Verified against real `ai@5`: over-cap generate/stream calls block before `doGenerate`/`doStream` runs (spy); stream cap error arrives via `onError`.
- [x] **Vercel AI SDK v7 + streaming** — one entry point for v5+v7: `toUsage` auto-detects flat (v5) vs nested (v7 `usage.inputTokens.total`) per call; stream finish part is `usage` in BOTH specs (the roadmap's `totalUsage` guess was wrong — verified against real `ai@7.0.22` types), so the existing reader just needed the dual-shape mapper. No `specificationVersion` field required — ai@7's `LanguageModelMiddleware` marks it optional and the runtime never checks it. v7 `outputTokens.total` already includes reasoning → not re-added (would double-bill `reasoningInOutput:false` models). Test: v7 nested mock → same USD as v5; finish part metered once; real ai@7 e2e (generate+stream+cap-block) + real ai@5 regression smoke.
- [x] **LangChain.js handler** — `BudgetGuardHandler extends BaseCallbackHandler` (subpath `budget-guard/langchain`, `@langchain/core` optional peer dep). `handleLLMEnd` meters (prefers `usage_metadata` = `{input_tokens,output_tokens}`, falls back to `llmOutput.tokenUsage` = `{promptTokens,completionTokens}` — never both), `handleLLMStart`/`handleChatModelStart` throw pre-call over cap with `raiseError=true` (else callback errors are swallowed and the call isn't aborted). Model from `opts.model` (preferred) or `response_metadata.model`/`.model_name`/`llmOutput.model_name`. Cap check via exported `spentTotal()`; recording reuses `guard()` with `dailyCapUSD: Infinity`. Verified against real `@langchain/core@1` (FakeListChatModel fires `handleLLMStart` — both start hooks needed). Same pattern applies to LlamaIndex/Mastra next.
- [x] **LlamaIndex.TS** — `guardLlamaIndex(llm, opts)` (Proxy wrapper, structural typing so zero dep on `@llamaindex/core`; main-entry export). Non-streaming `chat()` reuses `guard()` (cap + meter): usage is pulled from `response.raw` via `raw.usage ?? raw.usageMetadata ?? raw` (so OpenAI/Anthropic/Gemini raw all normalize). Streaming `chat()` enforces the cap via `enforceDailyCap()` then passes through (metering to follow). Model from `llm.metadata.model`. Test: OpenAI/Anthropic/Gemini raw → correct USD each; `.chat()` throws before the underlying call over cap; other methods delegate. Chose `wrapLLM` over the `callbackManager` event because wrapping meters + caps in one place (event can't block).
- [x] **Mastra** — **no new code needed** (YAGNI): Mastra agents run on Vercel AI SDK models, so `budgetGuardMiddleware` already caps + meters them. Mastra's current `Processor` (`processInput`/`processOutputResult`) is message-level and exposes no token usage, so it's the wrong hook anyway (the roadmap's `processLLMRequest`/`processLLMResponse` were an outdated API). Documented the `wrapLanguageModel(model, budgetGuardMiddleware(...))` → `Agent({ model })` pattern. Verified against real `@mastra/ai-sdk@1`: `withMastra(guarded)` + `generateText` meters, over-cap → `BudgetExceededError` via `onError`.

## Phase 4 — Accuracy & robustness
- [ ] **Redis atomicity (Lua)** — replace check-then-INCRBYFLOAT with a `SCRIPT LOAD`+`EVALSHA` Lua check-and-increment (return -1 = cap exceeded, no mutation) to kill the TOCTOU race. Test: 100 concurrent $0.10 adds vs $5 cap → final ≤ $5.00.
- [x] **Monthly caps + IANA timezone** — `period:'daily'|'monthly'` + `timezone` on GuardOptions; keys are calendar-aligned in the configured TZ via `Intl.DateTimeFormat('en-CA')` (default UTC, backward compatible); invalid TZ throws at guard construction. Exported `periodKey(date, period?, tz?)`. Ripple contained to `guard()` + `enforceDailyCap()` (both take opts); `spentTotal`/`spendReport` unchanged (pass the key). redisStore TTL is the user's to raise for monthly (documented). Test: `03:30Z` + `America/New_York` → `2026-06-30`; monthly cap shared across a month; invalid TZ throws.
- [ ] **Retry-storm detection** — guard the full retry cycle (outer promise), add `retryCount` to spend records, expose `retryStormThreshold` emitting a `retryStorm` event; spendReport surfaces `{retryStorms, totalRetries}`. Test: 3 retries → recorded once for final attempt, one storm event over threshold.
- [ ] **Built-in estimator helper + new-tokenizer correction** — thin `estimateUsage` helper using a tokenizer as an *optional* peer dep; apply the ~1.3× multiplier for Opus 4.7+/Sonnet 5/Fable/Mythos (newer tokenizer ≈30% more tokens); older models unchanged. Test: same text differs ≥25% between tokenizer generations; missing model → conservative 1.3× + warning.
- [ ] **Tool/function-call overhead in estimateUsage** — add per-model tool-schema overhead (e.g. Anthropic ~290 tokens w/ `tool_choice:auto`) to pre-call estimates; unknown model throws. Test: estimate with `tools` adds overhead; without `tools` adds none.
- [x] **Typed per-provider helpers** — `guardOpenAI()` / `guardAnthropic()` / `guardGemini()` thin wrappers over `guard()` that preset `provider` (so streaming metering is correct per provider without passing the option). `opts` is `Omit<GuardOptions, 'provider'>`. Test: guardAnthropic/guardGemini stream-meter with the right reader + no `stream_options` injection; guardOpenAI meters non-streaming.

## Phase 5 — DX & testing
- [ ] **Test helpers (`budget-guard/testing`)** — export `buildOpenAIUsage()`/`buildAnthropicUsage()` factories, `createFixedClock(iso)` for reset-boundary tests, `FakeSpendStore` (records operations), and `simulateConcurrentIncrements(store,...)`. Test: factories default to 0 + apply overrides; fixed clock drives key generation.

## Not now — overkill for a tiny solo lib (revisit when it grows)
CI matrix across OSes (pure TS runs everywhere); GOVERNANCE.md / CODEOWNERS (no co-maintainers); Renovate (Dependabot already on); benchmark / triage-automation / PR-title-lint workflows (fine at Biome's scale, overhead at 0-10 issues/mo); 7 issue templates (2 is enough); multi-language READMEs & sponsor-tier logo grids (wait for demand); native-binary/WASM release matrices (N/A — pure TS).

## Later / hosted (NOT built into this free package)
- [ ] Optional CLI (`budget-guard report`) backed by a file/redis store.
- [ ] Hosted layer: cross-project dashboard, shared caps, alerts, team — separate product, demand-permitting.

## Done
- **v0.1** — core: `guard()` hard daily cap + per-feature `spendReport()`, OpenAI/Anthropic usage normalization.
- **v0.2** — pluggable `SpendStore` (MemoryStore + `redisStore`), pre-call blocking via `estimateUsage`.
- **Tooling** — Biome (lint + formatter) with `lint`/`format` scripts.

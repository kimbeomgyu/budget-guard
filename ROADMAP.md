# Roadmap

**Direction.** budget-guard aims to be the best *tiny, zero-infra* cost guardrail for LLM APIs:
a drop-in SDK that hard-caps spend, blocks *before* overspending, and attributes cost per feature.
**Growth strategy: meet developers where they already are — framework adapters (distribution as code).**
Out of scope for this package: dashboards, analytics, multi-tenant UI — those belong to a separate
hosted layer, NOT here. Keep the core small, dependency-free, and sharp.

Items are small and independently testable, in rough priority order. Pick the first unchecked one.

## Phase 1 — Solidify the core
- [ ] **Gemini support** — add Gemini pricing to `PRICES` and normalize its usage shape (`usageMetadata.promptTokenCount` / `candidatesTokenCount`) in `normalizeUsage`, with tests.
- [ ] **Expand `PRICES`** — add current models (gpt-4.1, o-series, claude sonnet/haiku, gemini flash/pro) + a test guarding the table shape.
- [ ] **`onExceeded` callback** — allow a custom handler when the cap is hit, alongside `'block' | 'warn'`, with tests.
- [ ] **Streaming usage** — a small helper to aggregate token usage from a streamed response (sum the final usage chunk), with tests.
- [ ] **CI** — a GitHub Actions workflow running `npm test` + `npm run build` on pushes and PRs.
- [ ] **`examples/` directory** — runnable OpenAI, Anthropic, and Redis-store examples.

## Phase 2 — Framework adapters (distribution as code)  ← strategic centerpiece
- [ ] **Vercel AI SDK adapter** — a wrapper/middleware so AI SDK users apply a budget cap in one line; tests against the SDK's call shape.
- [ ] **LangChain.js integration** — a callback handler (or model wrapper) that meters + caps spend; tests.
- [ ] **Generic fetch adapter** — helper to guard any fetch-based provider client not covered above.

## Phase 3 — Accuracy & DX
- [ ] **Built-in estimator helper** — a thin `estimateUsage` helper + recipe using a tokenizer as an *optional* peer dep, so pre-call blocking works with minimal setup.
- [ ] **Typed per-provider helpers** — `guardOpenAI()` / `guardAnthropic()` for nicer ergonomics, with tests.

## Later / hosted (NOT built into this free package)
- [ ] Optional CLI (`budget-guard report`) backed by a file/redis store.
- [ ] Hosted layer: cross-project dashboard, shared caps, alerts, team — separate product, demand-permitting.

## Done
- **v0.1** — core: `guard()` hard daily cap + per-feature `spendReport()`, OpenAI/Anthropic usage normalization.
- **v0.2** — pluggable `SpendStore` (MemoryStore + `redisStore`), pre-call blocking via `estimateUsage`.

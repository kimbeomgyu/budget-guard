# Roadmap

Backlog for **budget-guard**, roughly in priority order. Each item is intentionally
small and independently testable. Contributions welcome — pick an unchecked item.

## v0.3
- [ ] **Gemini support** — add Gemini model pricing to `PRICES` and normalize its usage shape (`usageMetadata.promptTokenCount` / `candidatesTokenCount`) in `normalizeUsage`, with tests.
- [ ] **Streaming usage** — helper to aggregate token usage from streamed responses (OpenAI/Anthropic emit a final usage chunk), with tests.
- [ ] **Expand `PRICES`** — add current models (e.g. gpt-4.1, o-series, claude sonnet/haiku) with a test guarding the price-table shape.
- [ ] **`onExceeded` callback** — allow a custom handler when the cap is hit, in addition to `'block' | 'warn'`, with tests.
- [ ] **`examples/` directory** — runnable OpenAI, Anthropic, and Redis-store examples.
- [ ] **CI** — a GitHub Actions workflow running `npm test` on pushes and PRs.

## Later
- [ ] Optional CLI (`budget-guard report`) backed by a file or redis store.
- [ ] Hosted layer (cross-project dashboard, shared caps, alerts) — separate, demand-permitting.

## Done
- **v0.1** — core: `guard()` hard daily cap + per-feature `spendReport()`, OpenAI/Anthropic usage normalization.
- **v0.2** — pluggable `SpendStore` (MemoryStore default + `redisStore`), pre-call blocking via `estimateUsage`.

# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/kimbeomgyu/budget-guard/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/kimbeomgyu/budget-guard/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/kimbeomgyu/budget-guard/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/kimbeomgyu/budget-guard/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kimbeomgyu/budget-guard/releases/tag/v0.2.0
[0.1.1]: https://www.npmjs.com/package/budget-guard/v/0.1.1
[0.1.0]: https://www.npmjs.com/package/budget-guard/v/0.1.0

# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/kimbeomgyu/budget-guard/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/kimbeomgyu/budget-guard/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/kimbeomgyu/budget-guard/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kimbeomgyu/budget-guard/releases/tag/v0.2.0
[0.1.1]: https://www.npmjs.com/package/budget-guard/v/0.1.1
[0.1.0]: https://www.npmjs.com/package/budget-guard/v/0.1.0

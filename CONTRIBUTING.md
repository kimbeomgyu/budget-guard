# Contributing to budget-guard

Thanks for your interest! budget-guard is a small, focused TypeScript library, so
contributions are easy to reason about. This guide gets you from clone to PR.

## Development setup

Requires **Node.js ≥ 20** (CI runs on 20, 22, and 24).

```bash
git clone https://github.com/kimbeomgyu/budget-guard.git
cd budget-guard
npm ci
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm test` | Run the test suite (Vitest) |
| `npm run test:watch` | Watch mode |
| `npm run build` | Type-check + emit `dist/` (tsc) |
| `npm run lint` | Lint & format check (Biome) — **must pass in CI** |
| `npm run format` | Auto-fix lint/format issues (`biome check --write`) |

Before opening a PR, make sure all three pass locally:

```bash
npm run lint && npm run build && npm test
```

## Making a change

1. Fork and create a branch (`git checkout -b fix/short-description`).
2. Write the change **and a test** — the suite lives in `tests/`, mirroring `src/`.
   Bug fixes should add a test that fails before the fix.
3. Keep the public API surface small and documented; if you change behavior or the
   API, update the `README.md` and add a `CHANGELOG.md` entry under `[Unreleased]`.
4. Run `npm run format` so Biome formatting is clean.
5. Open a PR against `main`. CI (lint + build + test on Node 20/22/24 + CodeQL) must be green.

Never include real API keys or secrets in code, tests, fixtures, or logs.

## Design notes

- The library stays **dependency-free at runtime** — it wraps a provider client
  and only counts/caps. Please don't add runtime dependencies without discussion.
- Token prices live in `PRICES` (USD per 1K tokens); PRs keeping them current are welcome.
- Storage is pluggable via the tiny `SpendStore` interface (`add` / `get` / `entries`).

## Releasing (maintainers)

Releases are automated and gated:

```bash
npm version patch   # or minor / major — bumps package.json + tags vX.Y.Z
git push --follow-tags
```

Pushing the tag runs the `Publish` workflow, which **pauses for a required-reviewer
approval** (the `release` environment) before publishing to npm via OIDC trusted
publishing (with provenance) and creating the GitHub Release.

## Reporting security issues

Please **do not** open a public issue for vulnerabilities — see [SECURITY.md](./SECURITY.md).

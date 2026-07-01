# Security Policy

## Supported versions

budget-guard is pre-1.0; security fixes land on the latest published `0.2.x`.

| Version | Supported |
| ------- | --------- |
| 0.2.x   | ✅        |
| < 0.2   | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting:
**[→ Report a vulnerability](https://github.com/kimbeomgyu/budget-guard/security/advisories/new)**
(repo **Security** tab → **Advisories** → **Report a vulnerability**).

I'll acknowledge within a few days and aim to ship a fix or mitigation as fast as
is practical, then publish a GitHub Security Advisory crediting the reporter.

## Scope

budget-guard ships **no runtime dependencies** and runs in-process — it counts and
caps LLM API usage; your calls still go straight to the provider. The areas most
worth scrutiny:

- **Budget enforcement correctness** — a way to bypass the cap, undercount spend,
  or make `spendReport()` misattribute cost.
- **Release / supply-chain pipeline** — the npm publish path (OIDC trusted
  publishing + provenance), the `release` environment gate, and the pinned
  GitHub Actions.

Out of scope: issues in the OpenAI/Anthropic SDKs or your own application code.

# `.agents/skills/`

**Canonical** location for this pack's skill content. `.github/skills/` and
`.claude/skills/` are generated mirrors of this directory and are never
hand-authored.

## Format

Each skill is a directory whose name equals its `name` frontmatter field,
containing a `SKILL.md` with YAML frontmatter, optionally plus `references/`
and `assets/`. Constraints this pack holds itself to, per the Agent Skills
specification (`agent-skills-spec` in [`../../sources.json`](../../sources.json)):

- `name`: required, lowercase letters/digits/hyphens only, no leading,
  trailing or consecutive hyphens, ≤64 characters, **equal to the directory
  name**.
- `description`: required, ≤1024 characters, saying both what the skill does
  and when to use it.
- `compatibility`: optional in the specification, used by every skill here —
  a **top-level string** (≤500 characters) stating what the skill assumes and
  what has and has not been verified.
- `metadata`: a **flat string-to-string mapping**. No nested mappings. Keys
  used here: `pack`, `owner`, `layer`, `authored`, `checked-against`,
  `target-stack`, `behaviour-verified`, `volatile-facts`.
- `license`: `MIT`, matching the pack.
- `SKILL.md` stays under 500 lines; file references stay one level deep.

## The nine skills

| Skill | Covers |
| --- | --- |
| `react-vite-feature-slice` | React + TypeScript + Vite feature work as a vertical slice |
| `aspnetcore-endpoint-slice` | HTTP endpoint contract, validation, authorization, error shape |
| `efcore-azuresql-change` | Entity/model changes, additive migrations, passwordless Azure SQL |
| `bicep-infra-change` | Declarative Azure infrastructure, modules, what-if, RBAC |
| `entra-managed-identity-wiring` | Managed identity, least-privilege roles, OIDC federation for CI |
| `azure-appservice-deploy` | App Service configuration, slots, publishing, health checks |
| `appinsights-telemetry-and-triage` | Instrumentation, correlation, sampling, evidence-first triage |
| `secure-by-design-review` | Structured, ranked, evidence-based security review |
| `release-staging-to-production` | `develop`→staging, `main`→production promotion and rollback |

Routing from a task to a skill is defined in [`../../AGENTS.md`](../../AGENTS.md).

## Naming note

Skill names describe Azure services where that is the accurate, descriptive
term. The pack's own product and repository name deliberately does not — see
[`../../NOTICE`](../../NOTICE).

## Status

Authored 2026-08-26. Frontmatter conforms to the Agent Skills specification
with no known deviations. Not yet independently reviewed against a live Azure
surface, and although an eval harness now exists under `../../evals/`, it has
has no protocol-complete published benchmark — see [`../../FRESHNESS.md`](../../FRESHNESS.md) and
[`../../COMPATIBILITY.md`](../../COMPATIBILITY.md) for exactly what is and is
not verified.

# Architecture

Original synthesis for the Joshua Stewart Cloud Context Pack. Describes the
**shape** the pack assumes and the reasoning behind it, so an agent can make
a change that fits without reading the whole consuming codebase.

This file records *stable structure*. It states no version numbers, service
limits, SKUs or API shapes — those are volatile and must be retrieved live
(see [`links.md`](links.md) and the live-doc policy in `../AGENTS.md`).

## Shape

Four deployable/managed concerns, one repository:

```
web (React + TypeScript, built by Vite)
  │  HTTPS, JSON, same-origin where possible
  ▼
api (ASP.NET Core on .NET)
  │  EF Core, passwordless connection via managed identity
  ▼
Azure SQL Database
```

Cross-cutting:

```
Bicep  ──────────► provisions and configures every Azure resource above
Entra ID ────────► issues the identities that replace stored credentials
Application Insights ◄── telemetry from web and api, correlated end to end
```

## Layer responsibilities

| Layer | Owns | Must not |
| --- | --- | --- |
| web | Rendering, client-side routing, local UI state, presenting loading/empty/error states, calling the API through typed functions | Hold secrets, make authorization decisions, talk to Azure services directly, know database shapes |
| api | HTTP contract, validation, authorization, orchestration, mapping to DTOs | Return entities on the wire, embed credentials, hide failures behind `200` |
| data | Entity model, schema definition, query composition, transactional boundaries | Leak `IQueryable` past the boundary, be reached directly by the client |
| infrastructure | Every Azure resource, its configuration, and its access grants | Exist only in the portal; emit secrets as outputs |
| identity | Who the app and CI are, and what they may do | Be replaced by a key or connection string |
| observability | Correlated evidence of what happened | Contain secrets or personal data |

## Boundaries that matter

1. **Browser → API.** The only place untrusted input enters. Everything the
   browser sends is attacker-controllable, including values the client
   "just computed". Validate and authorize server-side, always.
2. **API → database.** Crossed with an Entra identity, not a password. The
   identity's database role is the last line of defence if the API is
   compromised, so it is minimal.
3. **CI → Azure.** Crossed with a federated (OIDC) credential scoped to
   this repository and a specific branch or environment. Staging pipelines
   cannot reach production resources.
4. **Environment → environment.** Staging and production share a template
   and share *nothing else* — separate resources, separate identities,
   separate telemetry role names. The one deliberate exception is the App
   Service plan: they are two separate App Services on **one shared plan**,
   so they do share compute. That is a cost trade-off with a real
   consequence — staging load can affect production — and it is why the
   plan's SKU is a single decision for both.

## Why a vertical slice

Changes are organised as slices (one feature end to end) rather than by
technical layer. A slice is reviewable in one pass, testable as a unit, and
revertible without archaeology. The practical rule: a feature change should
touch one folder in `web`, one folder in `api`, and — if unavoidable — one
migration. If it touches five shared files, the abstraction is wrong, or the
change is really several changes.

`../examples/vertical-slice-walkthrough.md` shows the sequence.

## Change ordering

Because the previous version keeps running during a release, order matters:

```
infrastructure  →  additive schema change  →  api  →  web
```

Each step must leave the currently deployed application working. Destructive
schema changes are deferred to a later release once nothing depends on the
old shape. This is the single most important architectural constraint in
this pack, and it is why `efcore-azuresql-change` refuses in-place renames.

**The mechanism that applies the schema change is repository-specific.** It
may be an EF migration, or explicit idempotent DDL run at bootstrap. The
*ordering and the additive rule* above are what matter and do not change;
the mechanism must be established by inspection, never assumed. See
`efcore-azuresql-change`.

## Configuration flow

```
Bicep parameter (per environment)
      │
      ▼
App Service app setting  ──►  api configuration  ──►  behaviour
      │
      └─► (client) build-time VITE_ variable, or a runtime config endpoint
```

Nothing reads configuration from the portal, from a developer machine, or
from a hostname check. Anything the client receives is public.

## What this architecture deliberately does not have

- No secrets store in the request path for ordinary service-to-service
  access — identity replaces it.
- No shared database user across environments.
- No build-per-environment for the API; one artifact is promoted.
- No portal-managed configuration that is not reproducible from Bicep.

## Related

- Conventions and naming: [`conventions.md`](conventions.md)
- Environment differences: [`environments.md`](environments.md)
- Security non-negotiables: [`security-baseline.md`](security-baseline.md)
- Terms used here: [`glossary.md`](glossary.md)

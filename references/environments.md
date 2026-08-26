# Environments

Original synthesis for the Joshua Stewart Cloud Context Pack. Describes how
environments differ, what must never differ, and where an agent should
expect environment-specific behaviour.

Stable here: the environment model, promotion flow, and configuration
rules. **Not** here, because volatile: SKU names, capacity, quotas, retention
periods, pricing, and region availability — retrieve those live (see
[`links.md`](links.md)).

## The environments

| Environment | Fed by | Purpose | Data |
| --- | --- | --- | --- |
| local | developer machine | fast feedback | disposable, never production data |
| staging | `develop` branch | the rehearsal; last place a change is safe to be wrong | production-shaped, not production data |
| production | `main` branch, by promotion | real users | real |

There is no fourth environment implied by this pack. If the consuming
repository has one, it inherits staging's rules.

## What must be identical across staging and production

- The Bicep template. Environments differ only by parameter values.
- The application artifact. Built once, promoted — never rebuilt per
  environment.
- The database schema *shape*, and the order schema changes are applied in.
  (The provider itself may differ — see the exception below.)
- The HTTP contract, error shape, and authorization model.
- Whether authentication is required (never relaxed in a lower environment
  in a way that hides a production failure).

**Known exception — the database provider may differ.** Where a repository
runs SQLite in development and staging and SQL Server in production, staging
does *not* rehearse production for anything provider-specific: type
mappings, collation, identity, index options, transaction behaviour. Treat
provider-specific work as **unrehearsed until it reaches production** unless
it is explicitly tested against the production provider. See
`efcore-azuresql-change`.

If staging and production diverge in any of the above, the rehearsal is
worthless and the release is untested.

## What legitimately differs

| Aspect | Differs how |
| --- | --- |
| Resource names | Environment suffix, derived in Bicep |
| Capacity/sizing | A parameter value; never a template branch |
| Identities | Separate identity per environment; no shared principal |
| Role assignments | Scoped to that environment's resources only |
| Telemetry role name | `<component>-<environment>`, so views never mix |
| Data | Production data is never copied down without an approved, minimised, de-identified process |
| Alert thresholds and routing | Production pages someone; staging does not |
| Client base URL / API origin | Per-environment build value or runtime config |

## Isolation rules

1. A staging identity must not be able to reach a production resource.
   Verify by attempting it and confirming failure.
2. A staging pipeline must not hold a credential or federated subject that
   satisfies production.
3. Telemetry must be separable by role name at query time, or staging noise
   will be read as a production incident.
4. Production data does not flow to staging or local without an approved
   process. "Just a copy for debugging" is a data incident.

## Configuration precedence

```
Bicep parameter (per environment)
  → App Service app setting
    → api configuration binding
      → behaviour
```

For the client:

```
Bicep/CI per-environment value
  → VITE_-prefixed build variable   (inlined at build time — public)
     or
  → runtime config endpoint served by the api  (chosen deliberately)
```

Rules:

- Never branch behaviour on hostname or on a `NODE_ENV`-style flag as a
  proxy for environment identity.
- Never read configuration from the portal — the portal reflects Bicep, it
  does not define it.
- Any value shipped to the browser is public. There is no such thing as a
  private client-side setting.
- Staging and production are **separate App Services**, so their settings
  are wholly independent — nothing is inherited and nothing travels between
  them. Confirm the production app's settings in their own right before a
  release. (If a consuming repository uses deployment slots instead, some
  settings do travel on a swap; inspect that repository and retrieve current
  slot semantics live rather than assuming.)

## Promotion

```
feature branch ──PR──► develop ──auto──► staging App Service
                                              │  verified
                                              ▼
                      main ──promote the same artifact──► production App Service
```

Staging and production are two separate App Services on one shared plan.
There is no deployment slot and no swap: promotion is a deploy to the second
app, and rollback is a redeploy of the previous known-good artifact.

Gates, ordering and rollback are owned by the
`release-staging-to-production` skill; per-app deployment mechanics by
`azure-appservice-deploy`.

## Local development

- Uses developer identity through the standard credential chain — not a
  shared secret, not a service principal password.
- Developers are granted the same least-privilege role their application
  identity has, via a group.
- Local may point at staging resources only where explicitly permitted, and
  never at production.
- A local-only convenience (seed data, relaxed auth) must be impossible to
  enable in a deployed environment.

## Live retrieval required

Ask live before stating: current SKU/tier names and their limits, quota
ceilings, log retention defaults, backup and point-in-time restore windows,
region availability, and cost. None of those are recorded in this pack.

## Related

[`architecture.md`](architecture.md) · [`conventions.md`](conventions.md) ·
[`security-baseline.md`](security-baseline.md) · [`links.md`](links.md)

# Joshua Stewart Cloud Context Pack

Portable operating guidance for a consuming repository built with React 19,
TypeScript 6, Vite 8, ASP.NET Core/.NET 9, EF Core 9, Azure SQL, App Service,
Bicep, Microsoft Entra managed identity, and Application Insights.

The reference topology uses two separate App Services on one shared B1 plan:
`develop` deploys to staging and `main` deploys to production. There are no
deployment slots. The reference data layer uses SQLite outside production and
Azure SQL in production, with explicit idempotent provider-specific schema DDL.
Inspect the consuming repository and preserve its actual conventions.

Version anchors describe the reference repository, not what is newest:
React/react-dom 19.2.7, TypeScript 6.0.3, Vite 8.1.0, `net9.0` runtime 9.0.19,
EF Core 9.0.19, SDK 10.0.400, and Bicep CLI 0.44.1. Retrieve current facts;
[FRESHNESS.md](FRESHNESS.md) records known drift and .NET 9 EOL review work.

This is an independent project, not affiliated with or endorsed by Microsoft.
See [NOTICE](NOTICE).

## Operating rules

1. **Stay within the requested scope.** Do not add secondary fixes, optional
   observations, migrations, refactors, or platform advice unless required for
   correctness. If no skill matches, use the consuming repository's own
   instructions, answer the direct issue concisely, and do not load unrelated
   pack material or restate the same diagnosis.
2. **No secrets.** Use managed identity for applications and OIDC federation
   for CI. Never add keys, passwords, connection strings, shared SAS tokens, or
   client secrets.
3. **Use least privilege with evidence.** Name the required operations, verify
   the current role permissions live, state why a narrower role is insufficient,
   and reject broader roles that are unnecessary.
4. **Keep infrastructure declarative.** Make Azure changes in Bicep, preview
   them with what-if, and avoid portal/CLI drift.
5. **Preserve the schema mechanism.** Use EF migrations only where the
   repository already uses them. Where it uses explicit SQLite/SQL Server
   bootstrap DDL, update both providers and test the DDL directly. Keep changes
   additive and compatible with the previous application version.
6. **Respect the real release topology.** Validate in the separate staging app
   before production. Roll back by redeploying the previous known-good artifact.
   Never assume deployment slots exist.
7. **Keep private material out.** Do not add tenant/subscription/resource IDs,
   internal hostnames, customer data, ticket details, or internal-only URLs.
8. **Do not copy vendor documentation or logos.** Link to primary sources and
   summarize facts in original words.
9. **Verified means reproduced.** Build, test, lint, or cite evidence. The eval
   harness exists but formal results are not published.

## Route the task

Load only the most specific relevant skill:

| Task | Skill |
| --- | --- |
| React page, component, route, state, form, Vite | `react-vite-feature-slice` |
| HTTP endpoint, DTO, validation, auth, OpenAPI, CORS | `aspnetcore-endpoint-slice` |
| Entity, query, schema, migration/bootstrap DDL, SQL | `efcore-azuresql-change` |
| Bicep resource/module/parameter/RBAC/what-if | `bicep-infra-change` |
| Managed identity, role assignment, OIDC, passwordless auth | `entra-managed-identity-wiring` |
| App Service settings, publish, startup, health | `azure-appservice-deploy` |
| Telemetry, correlation, alerts, production diagnosis | `appinsights-telemetry-and-triage` |
| Security or threat review | `secure-by-design-review` |
| Promotion, rollback, release gate, schema ordering | `release-staging-to-production` |

Canonical skills live under `.agents/skills/`. Do not chain skills unless the
task genuinely spans their domains.

## Retrieve volatile facts

Never rely on memory for SDK/package APIs, ARM `apiVersion` values, built-in
role IDs or permissions, quotas, SKU names, pricing, region availability,
runtime support, retirement dates, or slot behavior.

1. Inspect the consuming repository first.
2. Retrieve the current primary source. Prefer the declared Microsoft Learn MCP
   endpoint for Microsoft facts, discovering its tools dynamically; otherwise
   use the canonical links in [references/links.md](references/links.md).
3. State what was retrieved, from where, and when.
4. If retrieval fails, do not guess. Continue only with stable process guidance
   and identify the blocked fact.

For volatile facts, the live primary source wins over a skill. Raise the drift
instead of silently rewriting guidance.

## Evidence and trust

Trust, in order: consuming code/tests/IaC; primary documentation retrieved now;
pack skills/references; illustrative examples; model memory.

Before finishing, run the smallest existing build/test/lint/what-if that proves
the change. Surface failures explicitly and do not replace them with
success-shaped fallbacks.

## Pack maintenance

`.agents/skills/` and this file are canonical. Adapters and mirrors are generated
with `npm run generate`; never hand-edit them. Validate changes with:

```text
npm test
npm run check
npm run freshness:check
```

Add every new external source to `sources.json`. Automation may report drift but
must never rewrite prose, licences, or source decisions.

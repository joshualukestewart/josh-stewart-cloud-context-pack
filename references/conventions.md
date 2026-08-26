# Conventions

Original synthesis for the Joshua Stewart Cloud Context Pack. These are
*stable* conventions — deliberately chosen, slow to change, and safe to
record here. Version numbers, API shapes, SKU names and limits are **not**
conventions; retrieve them live (see [`links.md`](links.md)).

Where the consuming repository already does something differently and
consistently, **the repository wins.** Match what is there; do not convert a
codebase as a side effect of a feature change.

## Repository shape

```
web/                    React + TypeScript client, built by Vite
  src/features/<feature>/{components,api,model,hooks}
api/                    ASP.NET Core solution
  src/<Project>/Features/<Feature>/
  src/<DataProject>/{Entities,Configurations,Schema}
infra/                  Bicep entry template, modules, per-environment params
.github/workflows/      CI and deployment
```

The data project's schema folder holds whichever mechanism the repository
established — generated EF `Migrations/`, or explicit idempotent schema
bootstrap classes. Establish which by inspection; see
`efcore-azuresql-change`.

## Naming

| Thing | Convention | Example |
| --- | --- | --- |
| Feature folder | kebab-case, singular domain noun | `invoice-approval` |
| React component file | PascalCase, one component per file | `InvoiceList.tsx` |
| React hook | `use` + verb phrase | `useInvoiceList` |
| TypeScript type | PascalCase; DTOs suffixed by direction | `CreateInvoiceRequest` |
| C# namespace | mirrors the folder path | `Api.Features.Invoices` |
| Endpoint DTO | `<Verb><Noun>Request` / `Response` | `CreateInvoiceResponse` |
| EF migration *(only where the repo uses migrations)* | PascalCase, describes the change | `AddInvoiceApprovedAtColumn` |
| Bicep module | kebab-case noun of the concern | `app-service.bicep` |
| Azure resource | `<prefix>-<workload>-<env>[-<suffix>]`, lowercase | `jsx-api-staging` |
| Telemetry role name | `<component>-<environment>` | `api-production` |
| Git branch | `feature/<short-description>` | `feature/invoice-approval` |

Resource names that must be globally unique are *derived* in Bicep from a
prefix, environment and uniqueness token — never hardcoded.

## Code conventions

**TypeScript**

- `strict` on. No new `any`; `unknown` plus a narrowing check instead.
- Every network boundary has a runtime validator, not only a compile-time
  type.
- No default exports for components — named exports keep renames honest.
- Config is read once, in one typed module, from `import.meta.env`.

**C#**

- Nullable reference types on; warnings as errors in CI.
- `async`/`await` all the way down; no `.Result` or `.Wait()`.
- Cancellation tokens accepted and passed through on any I/O path.
- Entities never appear in a public HTTP contract.
- One handler per endpoint; handlers stay thin.

**EF Core**

- Explicit configuration classes rather than attributes on entities.
- `AsNoTracking` for reads; projection with `Select` before materialising.
- Schema changes are additive, and are applied by whichever mechanism the
  repository already uses — generated migration code is read before commit;
  hand-written bootstrap DDL is idempotent and written for every supported
  provider in the same change.

**Bicep**

- Modules per concern; the entry template wires and names.
- Parameters describe the environment, not the behaviour.
- No secret parameters, no secret outputs.

## HTTP contract conventions

| Case | Status | Body |
| --- | --- | --- |
| Success with data | `200` | Response DTO |
| Created | `201` | Response DTO + `Location` |
| Success, nothing to return | `204` | none |
| Invalid input | `400` | Problem details, field-level errors |
| Not authenticated | `401` | Problem details, no detail |
| Authenticated but not permitted | `403` | Problem details, no detail |
| Missing, or not visible to this caller | `404` | Problem details, no detail |
| Conflict / concurrency | `409` | Problem details |
| Unexpected | `500` | Problem details + correlation id, never a stack trace |

Lists are paginated from the first version. Contract changes are additive
first: add, migrate the client, then remove in a later release.

## Testing conventions

- Test user-visible behaviour, not internals.
- Client: one test per rendered state (loading, empty, error, success) plus
  the data function's error path.
- API: integration-level tests through the pipeline for happy path,
  validation failure, authorization failure, not-found.
- Data: for anything schema-risky, assert on the generated migration script
  where migrations are used, or on direct DDL tests (idempotence plus
  resulting objects, per provider) where bootstrap DDL is used.
- A test that needs a real secret is a design problem, not a test problem.

## Git and review conventions

- Branch flow: `feature/*` → `develop` (staging) → `main` (production).
- One concern per pull request. If the diff needs a table of contents, split
  it.
- Commit messages describe the change and its reason, not the file list.
- A PR touching a trust boundary requires a `secure-by-design-review` pass.
- Generated files (adapters, skill mirrors) are never hand-edited.

## Documentation conventions in this pack

- Original prose only; cite primary sources by URL and summarise.
- Every external source gets an entry in `../sources.json`.
- State a date next to any claim of verification.
- Mark anything unverified as unverified, explicitly.

## Related

[`architecture.md`](architecture.md) · [`environments.md`](environments.md) ·
[`security-baseline.md`](security-baseline.md) · [`glossary.md`](glossary.md)

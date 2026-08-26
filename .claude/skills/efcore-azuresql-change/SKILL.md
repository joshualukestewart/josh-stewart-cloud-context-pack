---
name: efcore-azuresql-change
description: Change the EF Core 9 model and apply the resulting schema change using whichever mechanism the consuming repository already established - an EF migration where one exists, or synchronized idempotent SQLite and SQL Server DDL where that is the convention - plus query and passwordless-connectivity fixes. Use when the task mentions an entity, DbContext, schema or table change, migration, idempotent DDL, EnsureCreated, an index, seed data, a slow or failing database query, or a SQL connection or login error.
license: MIT
compatibility: >-
  Guidance only - ships no code, needs no packages. Written for the consuming
  repository's data layer: EF Core 9.0.19 on net9.0, confirmed 2026-08-26.
  That repository does NOT use EF migrations for feature tables - it uses
  idempotent dual-provider schema bootstrap, SQLite for dev and staging and
  SQL Server in production. No build, DDL or query ran here and no live
  database was contacted. Retrieve volatile facts live per AGENTS.md.
metadata:
  pack: josh-stewart-cloud-context-pack
  owner: Joshua Stewart
  layer: data
  authored: "2026-08-26"
  checked-against: "Agent Skills specification, read 2026-08-26"
  target-stack: "EF Core packages resolving to 9.0.19 on a net9.0 target; the consuming repository uses explicit idempotent dual-provider schema bootstrap after EnsureCreated (SQLite dev and staging, SQL Server production), not EF migrations for feature tables"
  behaviour-verified: "none - no agent benchmark, no DDL applied, no live database contacted"
  volatile-facts: "not asserted here, retrieve live per the AGENTS.md live-doc policy"
---

# EF Core schema and query change

Schema changes are the hardest thing to undo. Assume the previous version of
the application is still running while the new schema is live.

## Step 1 — establish the repository's schema mechanism. Do not skip this.

**This repository family has two legitimate mechanisms. Find out which one
is in use before writing anything.** Adding the wrong one creates a second,
competing source of schema truth — the worst outcome available here.

Look for, in this order:

1. A `Migrations/` folder with generated migration classes and a model
   snapshot, and `dotnet ef` usage in CI or release scripts → **Branch A**.
2. An explicit schema bootstrap invoked after `EnsureCreated` — classes with
   names like `PublicationSchema` or `ContextPackSchema` that execute
   idempotent DDL, usually with a provider check so SQLite and SQL Server
   each get correct syntax → **Branch B**.

At the time this skill was written, the consuming repository used
**Branch B**: idempotent dual-provider DDL after `EnsureCreated`, with SQLite
in development and staging and SQL Server in production. No EF migrations
existed for feature tables.

> **Never introduce a parallel migration system by default.** If the
> repository uses Branch B, do not "modernise" it to migrations as a side
> effect of a feature change. `EnsureCreated` and EF migrations do not
> compose: a database created by `EnsureCreated` has no migrations history
> table, so a later `dotnet ef database update` will try to create objects
> that already exist. Moving between mechanisms is a deliberate, separately
> reviewed migration project with its own rollback plan — propose it, do not
> perform it.

## Rules that apply to both branches

1. **Additive first.** Add nullable columns, columns with defaults, new
   tables, new indexes. Do not drop, rename or tighten in the same release
   that introduces the replacement.
2. **Forward-compatible.** After the schema change is applied, the
   *currently deployed* application version must still work. This is what
   makes a redeploy-based rollback safe — see
   `release-staging-to-production`.
3. **Model the change explicitly** in the entity and its configuration
   class: column type, precision, max length, index, delete behaviour.
   Prefer explicit configuration over convention for anything a reviewer
   would otherwise have to infer.
4. **Plan the destructive half separately.** A rename becomes: add new →
   backfill → dual-write/read → cut over → drop old in a later release.
5. **Apply schema changes as a release step**, not from an ad-hoc developer
   connection. Applying at application start-up is unsafe with multiple
   instances and undermines rollback.
6. **Keep queries server-side.** Project to a DTO with `Select`, filter
   before materialising, avoid client evaluation, use `AsNoTracking` for
   reads. Never `ToList()` then filter in memory.
7. **Connect with a managed identity token** in production. No password, no
   key, no connection secret — see `entra-managed-identity-wiring`.
8. **Expect transient faults.** Enable the provider's retry-on-failure
   behaviour and make writes idempotent rather than relying on retries.

## Branch A — the repository uses EF migrations

1. Generate the migration and **read the generated file before committing
   it**. It is generated code, not trusted code.
   ```bash
   dotnet ef migrations add <DescriptiveName> -p <DataProject> -s <StartupProject>
   ```
2. Produce a reviewable idempotent script rather than trusting an implicit
   apply:
   ```bash
   dotnet ef migrations script --idempotent -o artifacts/migration.sql \
     -p <DataProject> -s <StartupProject>
   ```
3. Inspect that script for table rebuilds, long-held locks and unguarded
   data movement on large tables.
4. Never edit a migration that has already been applied to a shared
   environment — add a corrective one.

## Branch B — the repository uses idempotent dual-provider DDL

This is the mechanism in use in the consuming repository. Extend it; do not
replace it.

1. **Find the existing schema class** for the area you are changing (for
   example `PublicationSchema`, `ContextPackSchema`) and follow its shape
   exactly — same guard style, same naming, same ordering.
2. **Write the DDL idempotently.** Every statement must be safe to run on
   every start-up, because it will be. Guard creates with an existence
   check; never rely on catching an exception.
3. **Write both providers, together, in the same change.** SQLite and SQL
   Server differ in type names, identity/auto-increment syntax, index
   creation, `ALTER TABLE` capability and existence-check idioms. A change
   applied to only one provider is a broken change that will pass in
   development and fail in production, or the reverse.
4. **Keep the two provider paths visibly parallel** so a reviewer can read
   them side by side and confirm they express the same intent.
5. **Add a direct DDL test.** Because there is no migration script to
   review, the test *is* the review artifact. Cover, per provider:
   - the bootstrap runs cleanly against an empty database;
   - it runs a second time with no error and no duplicate object
     (idempotence);
   - the expected table, column, index and constraint exist afterwards;
   - the previous application version's queries still succeed against the
     new schema.
6. **Verify against SQL Server too, not only SQLite.** Development and
   staging running SQLite means staging does **not** rehearse production's
   provider. Anything provider-specific — types, collation, identity, index
   options, transaction behaviour — is unrehearsed until it reaches
   production unless you test it explicitly.

## Decision points

| Situation | Decision |
| --- | --- |
| Repository uses Branch B and the task says "add a migration" | Clarify first. Follow the repository's mechanism, and say plainly that you did and why. |
| Genuinely need to move Branch B → Branch A | Propose it as its own piece of work with a rollback plan. Do not bundle it with a feature. |
| Column must become non-nullable | Two releases: add nullable + backfill, then tighten once no running version writes null. |
| Rename a column or table | Never in place. Add → migrate readers/writers → drop later. |
| Large-table backfill | Batch it outside the schema step; a single `UPDATE` over a large table can block the application. |
| A construct exists in SQL Server but not SQLite (or vice versa) | Choose the common subset, or branch by provider *explicitly* with both paths tested. Never let one provider silently miss the change. |
| Query is slow | Capture the actual plan or dependency timing first (`appinsights-telemetry-and-triage`). Add an index only with evidence. |
| Data must be seeded | Distinguish reference data (safe, idempotent, part of the bootstrap) from test data (never applied to production). |
| Someone proposes a SQL login and password | Refuse. Route to `entra-managed-identity-wiring` and `secure-by-design-review`. |

## Verification

Common to both branches:

```bash
dotnet build -warnaserror
dotnet test
```

Branch A additionally:

```bash
dotnet ef migrations list   -p <DataProject> -s <StartupProject>
dotnet ef migrations script --idempotent -p <DataProject> -s <StartupProject>
```

Branch B additionally — run the DDL tests for **both** providers, and check
by hand that:

- The bootstrap is idempotent: running it twice changes nothing and raises
  nothing.
- The SQLite and SQL Server paths create equivalent objects.
- No statement drops or alters an object the currently deployed application
  still reads or writes.

Both branches, by hand:

- Applying the schema change and then starting the **previous** application
  version still works.
- No connection string with a password exists in any config file, Bicep file
  or example.
- Every new foreign key has a supporting index, or a documented reason not
  to.

## Failure handling

| Symptom | First action |
| --- | --- |
| Login failed for the app identity | The identity exists in Azure but has no database principal or role membership. Fix in the database, not by adding a password. |
| Works on SQLite, fails on SQL Server (or the reverse) | A provider-specific construct leaked into shared DDL, or one provider path was not updated. Fix both paths; do not special-case production at run time. |
| Bootstrap fails on second run | The DDL is not idempotent — an unguarded `CREATE`. Add the existence check; do not wrap it in a swallowed exception. |
| `PendingModelChangesWarning` at start-up (Branch A) | Model and last migration disagree. Add the missing migration; never suppress the warning to ship. |
| Two migrations from different branches (Branch A) | Do not merge both blindly. Re-generate the later one on top of the earlier, then re-review the SQL. |
| `dotnet ef database update` fails with "object already exists" | Classic `EnsureCreated`-then-migrations collision. Stop — this is the parallel-system problem, not a bug to force past. |
| Timeouts on a specific query | Check for a missing index, an unintended cartesian join from multiple `Include`s, or client evaluation. Split the query before raising the timeout. |
| Transient connection drops | Confirm retry-on-failure is enabled and the operation is idempotent; do not wrap everything in an unbounded retry loop. |

## Live retrieval required

Do **not** state from memory: EF Core provider option names and behaviour,
SQLite versus SQL Server type mappings and DDL syntax differences,
`EnsureCreated` semantics, `Microsoft.Data.SqlClient` authentication mode
names, Azure SQL service tiers and limits, retry defaults, or supported
compatibility levels. Retrieve live per the live-doc policy in
`../../../AGENTS.md`, using the EF Core and Azure SQL entries in
`../../../references/links.md`.

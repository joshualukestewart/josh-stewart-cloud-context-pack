# Glossary

Original definitions for the Joshua Stewart Cloud Context Pack. Written to
disambiguate terms *as this pack uses them* — not to restate vendor
documentation. Where a term names a Microsoft product or feature, the
authoritative definition is the vendor's; see [`links.md`](links.md).

## Pack terms

**Adapter file** — A generated tool-specific entry point
(`.github/copilot-instructions.md`, `CLAUDE.md`, `GEMINI.md`) derived from
`AGENTS.md`. Never hand-edited.

**Additive change** — A schema or contract change that a currently running
previous version tolerates: add a nullable column, add a field, add a table.
The opposite (drop, rename, tighten) is *destructive* and is deferred to a
later release.

**Blast radius** — How much of the system, and how many users, a change or
failure can affect.

**Contract** — The agreed shape crossing a boundary: HTTP request/response
DTOs, or the template's parameter and output surface.

**Drift** — Two meanings, always disambiguated in context. (1)
*Infrastructure drift*: deployed state that no longer matches the Bicep in
the repository, usually from a portal edit. (2) *Source drift*: an external
documentation page whose HTTP metadata changed since the last freshness
check, signalling that a human should re-read it.

**Live retrieval** — Fetching a volatile fact from primary documentation at
the moment it is needed, rather than relying on this pack or model memory.
See the live-doc policy in `../AGENTS.md`.

**Non-negotiable** — A rule in this pack that a change may not violate
without an explicit, recorded exception.

**Promotion** — Moving the *same already-built artifact* from one
environment to the next, by deploying it to that environment's own App
Service. Distinct from re-deploying, which rebuilds.

**Rollback (application)** — Redeploying the previous known-good artifact to
the production App Service. There is no swap to undo, so the previous
artifact's identity must be recorded before a release, and rollback costs a
full deployment cycle.

**Slot / slot swap** — An App Service feature, available only on some plan
tiers, for verifying a build under production configuration and then
exchanging it with the live instance. **The topology this pack describes does
not use slots**; staging and production are separate App Services on a shared
plan whose tier does not include them. If a consuming repository does use
slots, inspect it and retrieve current slot and swap semantics live rather
than assuming any of the above.

**Slice** — One feature implemented end to end (client, API, data) in
colocated folders, reviewable and revertible as a unit.

**Stable vs volatile fact** — Stable facts (layering, naming, gates, branch
flow) are recorded in this pack. Volatile facts (versions, limits, SKUs,
API shapes, prices, role IDs) are never asserted here and must be retrieved
live.

**Trust order** — The precedence this pack applies to conflicting
information: consuming repository > live vendor docs > this pack's skills
and references > this pack's examples > model memory.

**Verified** — Backed by a reproducible check and a date. Anything else is
*provisional* and must say so.

## Stack terms as used here

**Artifact** — The single build output (published API and/or built client
bundle) produced once per commit and promoted through environments.

**Correlation id** — The identifier that ties a client request, its API
handling, and its downstream calls into one traceable operation; also the
opaque value returned to a user on failure so a report maps to a trace.

**Federated credential (OIDC)** — The trust configuration that lets a CI
workflow obtain an Azure token by proving its identity as a specific
repository and branch/environment, with no stored secret.

**Idempotent schema script** — SQL safe to run more than once, so a release
step can be retried without corrupting state. Either generated (an EF
`--idempotent` migration script) or hand-written guarded bootstrap DDL,
depending on the repository's established mechanism.

**Managed identity** — A platform-issued identity attached to an Azure
resource, used instead of a stored credential. *System-assigned* shares the
resource's lifecycle; *user-assigned* is a standalone resource that can be
granted access before its consumer exists.

**Passwordless connection** — A database or service connection authenticated
by an Entra token from a managed identity, containing no password or key.

**Problem details** — The consistent structured error body returned by the
API for non-success statuses.

**Role assignment** — The binding of (identity, role, scope) that grants
access in Azure. Scope narrowness matters as much as role choice.

**Slot / slot swap** — See the entry above, under *Rollback (application)*.
Not used by the topology this pack describes.

**Shared App Service plan** — One plan hosting both the staging and the
production App Service. Cost-efficient at small scale, but it means the two
environments share compute: load or a runaway process in staging can affect
production. It also means the plan's SKU is a single decision for both.

**Vertical slice** — See *slice*.

**what-if** — The pre-deployment preview of what an infrastructure
deployment would change. Reading its delete/modify lines is mandatory, not
optional.

## Related

[`architecture.md`](architecture.md) · [`conventions.md`](conventions.md) ·
[`environments.md`](environments.md) ·
[`security-baseline.md`](security-baseline.md) · [`links.md`](links.md)

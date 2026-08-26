# Freshness

This document tracks how current the pack's content is, and defines the
policy — and the tooling — for keeping it that way. Freshness matters
especially for Azure guidance, since service behavior, SDKs, and portal UX
change frequently. This document describes a **working
knowledge-supply-chain process** (`sources.json` +
`scripts/check-freshness.mjs` + `.github/workflows/freshness.yml`).

As of 2026-08-26 that process now has substantive content to watch over: the
nine skills, `references/` and `examples/` were authored on that date. **Being
authored is not the same as being reviewed.** No content below has been
independently re-read by a second reviewer, exercised by an eval harness, or
checked against a live Azure surface. The status table records exactly what
was and was not done.

The pack's central mitigation for staleness is not this document — it is the
**live-doc policy** in `AGENTS.md`: volatile facts (versions, limits, SKUs,
api versions, SDK signatures, role definition ids, pricing) are deliberately
never asserted in the pack's prose, so they cannot go stale in it. What this
file protects is the smaller set of things the pack *does* record: the
reachability and currency of the sources it points at.

## Volatility tiers

Every entry in [`sources.json`](sources.json) is tagged with a `volatility`
tier, which drives its `reviewAfterDays` cadence. These are the pack-wide
defaults; an individual source may justify a shorter cadence, but should not
casually use a longer one without recording why in its `notes` field.

| Tier | Meaning | Default review cadence | Example from this scaffold |
| --- | --- | --- | --- |
| `stable` | Rarely changes in a way that affects this pack — e.g. a ratified legal text or a frozen spec version. | 365 days | `semantic-versioning-spec`, `mit-license-reference` |
| `versioned` | Changes in discrete, citable releases (a new dated version, a new spec revision). | 180 days | `agents-md-convention`, `react-19-release-notes`, `ef-core-9-whats-new`, `microsoft-learn-terms-of-use` |
| `volatile` | Can change at any time with no version marker — a living docs page, a fast-moving protocol, a CLI reference. | 30 days | `agent-skills-spec`, `azure-rbac-built-in-roles`, `app-service-deployment-slots`, `openai-codex-docs` |

As of 2026-08-26 the registry holds **70 entries**: 62 `volatile`, 6
`versioned`, 2 `stable`; by retrieval policy, 67 `metadata-only`, 2
`link-only`, 1 `pinned-snapshot`. The heavy skew to `volatile` is
intentional — most Azure and agent-tooling documentation is a living page
with no version marker.

`sources.json` already demonstrates the volatile tier isn't theoretical. Its
`vscode-mcp-server-docs` and `model-context-protocol-spec` entries record a
canonical-URL redirect observed at seed time (2026-08-25). Three further
entries added on 2026-08-26 record live evidence of churn: the Agent Skills
specification's host moved (`agentskills.dev` did not resolve;
`agentskills.io` did), the earlier Codex documentation path redirected before
the registry was updated to its current AGENTS.md page, and the GitHub Copilot
and VS Code instruction docs both resolved through redirects from older paths.
Two entries (`claude-code-memory-docs`, `claude-code-skills-docs`) are
`link-only` because that host answers `HEAD` with 404 while answering `GET`
with 200 — an automated headers-only check would report a false negative,
so they are human-reviewed by policy.

## Version probes

Volatility tiers tell a human *when* to re-read a page. They cannot tell
anyone whether the pack's stack versions have moved. A `versionProbe` does
that, for the small number of dependencies that publish a **primary
machine-readable registry**.

A probe is an optional object on a source, alongside — never instead of —
that source's human-readable `canonicalUrl`:

```json
"versionProbe": {
  "url": "https://registry.npmjs.org/react/latest",
  "format": "npm-latest",
  "testedVersion": "19.2.7",
  "alertOn": "major"
}
```

`format` is one of `npm-latest`, `nuget-index`, `dotnet-release-index` or
`github-latest`. `alertOn` is `major`, `minor` or `any`. The shape is
enforced twice: by `sources.schema.json`, and independently by
`scripts/lib/version-probe.mjs`, which refuses to run a probe whose shape it
does not fully understand. A malformed probe is a **blocking** error
(exit `1`), because a probe that cannot run is worse than no probe.

### Why this does not breach the no-copied-docs rule

The pack's rule is that documentation prose is never reproduced here. Probes
do not touch documentation:

- A probe fetches **one small machine-readable JSON document** — an npm
  version record, a NuGet flat-container index, the .NET releases index, or
  a GitHub release record. These are registry metadata, not published
  writing, and carry no expressive content to copy.
- The response is **size- and time-bounded** (1 MiB, 8 s) and must be JSON.
  Anything larger, slower, or of the wrong content type fails closed.
- **Only a version string escapes.** The body is parsed, the version is
  extracted, and everything else is discarded. Nothing is stored except the
  extracted version and the response's `ETag`/`Last-Modified` in the
  gitignored `.freshness-cache.json`.
- Documentation pages themselves are still headers-only. `canonicalUrl` is
  never body-read. A probe URL is always a registry endpoint, never a
  `learn.microsoft.com`, `react.dev` or `vite.dev` page.

### What a probe is allowed to do

**Open review work. Nothing else.**

A probe never edits `sources.json`, never edits prose, and never re-pins
`testedVersion`. Version drift raises exit code `2` ("review required"),
which the scheduled workflow turns into a GitHub issue for a human. This is
the same "no-autonomous-update rule" that governs everything else here: the
tooling reports, a person decides.

A probe that cannot be completed — unreachable host, non-JSON response,
oversized body, prerelease-only tag — is reported as a **probe error** and
also raises exit `2`. It is never silently treated as "no change". Failing
closed matters: a probe that quietly succeeds at nothing would let a stale
anchor look verified.

### `testedVersion` is an anchor, not a currency claim

`testedVersion` records **the exact version the consuming repository actually
resolves**, so the probe measures how far the real site has fallen behind. It
is not "whatever the registry says is newest", and it does not assert that
the version is current, supported, or recommended. Per-entry `notes` in
`sources.json` state precisely how each anchor was established:

| Dependency | `testedVersion` | How established (2026-08-26) | Probe |
| --- | --- | --- | --- |
| Bicep CLI | `0.44.1` | **Executed** — compiled and linted `examples/bicep-managed-identity` | `github-latest` |
| React / react-dom | `19.2.7` | Read from the consuming repository's `web/package-lock.json` (with `@vitejs/plugin-react` 6.0.3) | `npm-latest` |
| TypeScript | `6.0.3` | Read from the consuming repository's `web/package-lock.json` | `npm-latest` |
| Vite | `8.1.0` | Read from the consuming repository's `web/package-lock.json` | `npm-latest` |
| EF Core | `9.0.19` | The repository's EF Core packages resolve to this on a `net9.0` target | `nuget-index` |
| .NET | `9.0.19` | The PersonalSite project targets `net9.0`; installed runtime is `9.0.19`. Builds currently execute under **SDK 10.0.400** — SDK and target framework are deliberately separate facts. | `dotnet-release-index` |

Only Bicep's anchor was established by running something. The rest were read
from the consuming repository's lockfile, project target and restore output —
stronger provenance than a registry query, but still not a build or test
performed here. Content elsewhere in the pack cites these exact numbers so
the anchor, the probe and the prose cannot drift apart silently.

### Open review items raised on 2026-08-26

The first probe run was deliberately not "fixed" by moving the anchors.
Moving an anchor is a content decision for a human, so these stand open:

| Item | Observed | Why it is not auto-resolved |
| --- | --- | --- |
| .NET | site targets `net9.0` on runtime `9.0.19`; channel `9.0` was in support-phase `maintenance`, EOL `2026-11-10`, while `10.0` was `active` at `10.0.11` | **Most material item here.** The runtime the real site depends on leaves support in under three months. **The pack does not retarget to .NET 10** — it documents the site as it is, and raises this as review work. |
| TypeScript | site pins `6.0.3`; registry `latest` was `7.0.2` | A new major exists. Whether the site moves to TypeScript 7 is its decision, not the pack's. |
| EF Core | site resolves `9.0.19`; highest stable was `10.0.11` | Tied to the `net9.0` target above; moves with it, not before it. |
| Bicep CLI | verified with `0.44.1`; latest release was `0.46.1` | The toolchain that verified `examples/` is two feature releases behind. Re-verify the example before re-pinning. |
| React, Vite | site pins `19.2.7` and `8.1.0`; latest published releases were `19.2.8` (2026-07-21) and `8.2.2` (2026-08-20) | Behind by a patch and a minor respectively; Vite is also five patches behind inside its own `8.1` line (`8.1.5`). React `19.2.8` contains an RSC decoding performance change rather than an API/security change. `alertOn: major` records both as "behind" without escalating. |

None of the above is a claim that the pack's guidance is wrong — the pack
asserts no version behaviour by design. They are claims about the *anchor*,
which is exactly what a probe is for.

### Probe reachability from the authoring machine

On 2026-08-26 the `dotnet-release-index` and `github-latest` probes
completed. The three `npm-latest` probes and the `nuget-index` probe failed
with `fetch failed`: direct HTTPS to `registry.npmjs.org` and
`api.nuget.org` is intercepted on the authoring machine, so the TLS
handshake never completes. The npm CLI works there because it is configured
against a proxy, but the canonical registry URL is the correct value to
record, and reachability is an environment property rather than a
configuration error. Those four probes are therefore **configured and
valid but unverified end to end**, and they currently contribute probe
errors (exit `2`) on this machine. CI should be able to complete them.

## Live-MCP policy

`.mcp.json` and `.vscode/mcp.json` now each **declare one server**:
`microsoft-learn`, `type: http`, at `https://learn.microsoft.com/api/mcp`.
Each file uses the wrapper key its own tool documents (`mcpServers` and
`servers` respectively). They are no longer empty placeholders.

The conditions below applied before that entry was added, and apply again
before any further server is declared:

1. The server's own documentation/schema must be added to `sources.json`
   with an accurate `volatility` (MCP tooling changes fast; default to
   `volatile` unless there is a specific reason not to). **Met** for this
   entry: `microsoft-learn-mcp-docs` and `microsoft-docs-mcp-repo` are
   registered and were confirmed reachable on 2026-08-26.
2. `scripts/check-freshness.mjs --network` must run clean (or any drift must
   be reviewed) before the config is considered current.
3. No live MCP server may be assumed reachable or well-behaved just because
   it is declared here — **declaring a server is not the same as having
   verified it.** No MCP client has been observed connecting to this
   endpoint from this repository, and no tool call has been made through it.
   Its tool names, parameters and limits are not asserted anywhere in this
   pack; retrieve them live. `COMPATIBILITY.md` tracks
   verified-vs-unverified tool integrations separately from this file.

This pack does not connect to any live MCP server automatically as part of
its freshness checks; `check-freshness.mjs` only ever contacts the
`canonicalUrl` of entries in `sources.json` (documentation/spec pages) for
headers, plus any configured `versionProbe` registry URL — never an MCP
server endpoint itself.

## No-autonomous-update rule

**Nothing in this pack's automated tooling is allowed to rewrite
substantive content.** Concretely:

- `scripts/check-freshness.mjs`, by default, only reads `sources.json` and
  `manifest.json` and reports; it never writes either file.
- The one exception is the explicit `--write-manifest` flag, which updates
  *only* the three placeholder fields `manifest.json.knowledge
  .knowledgeReviewedAt / .reviewDueAt / .sourceRegistrySha256` — never a
  skill, a license, or any prose. This flag is meant to be run by a human,
  locally, after reading the check's report, with the resulting diff
  reviewed and committed deliberately.
- `.github/workflows/freshness.yml` (the scheduled CI job) **never** passes
  `--write-manifest` and never commits, pushes, or otherwise mutates any
  file in the repository. Its only side effect is opening/updating/closing
  one GitHub issue.
- No script in this repository is permitted to scrape, cache, or reproduce
  page bodies from `sources.json` `canonicalUrl` values — documentation
  checks are headers-only (HEAD, or GET with the body immediately cancelled
  unread). See `scripts/check-freshness.mjs`'s file header for the exact
  contract.
- The single, narrow exception is a `versionProbe`, which parses one small
  bounded JSON **registry** document and keeps only the extracted version
  string. It never touches a documentation URL, and it may only open review
  work — see "Version probes" above.
- Any future automation that touches `.agents/skills/` content must be
  proposed and reviewed like any other change; it must never run
  unattended against prose.

## Review workflow

1. **Offline check (always available, no network required):**
   `npm run freshness:check` — validates `sources.json` against
   `sources.schema.json`, validates every `versionProbe`'s shape, and flags
   overdue/invalid `lastReviewed` dates.
2. **Network check (opt-in):** `npm run freshness:check:network` —
   additionally performs a headers-only reachability check per source
   (only for `retrievalPolicy: "metadata-only"` entries), compares the
   observed `ETag`/`Last-Modified` against `.freshness-cache.json` (a
   gitignored local cache) to surface **drift**, and runs each configured
   `versionProbe`.
3. **Scheduled CI:** `.github/workflows/freshness.yml` runs the network
   check weekly (and on manual dispatch) and opens/updates a single
   `freshness-review`-labeled GitHub issue when the result is not clean; it
   closes that issue automatically once a later run is clean.
4. **Human review:** whoever picks up the issue re-checks the flagged
   source's `canonicalUrl` by hand, updates the corresponding entry in
   `sources.json` (at minimum `lastReviewed`, and `notes`/`pinnedCommit` if
   relevant), and only then may run
   `npm run freshness:update-manifest` locally and commit the result.
5. **Human review of a version bump** is a separate, larger job than
   re-reading a page. Re-pinning `testedVersion` means: re-read the affected
   skills and references, re-run whatever can be re-run (for Bicep, that is
   `bicep build`/`lint` on `examples/`), decide whether the pack's declared
   target line moves, update every place that cites the old number, and only
   then change the anchor. **Never bump `testedVersion` just to silence the
   probe** — that converts a real signal into a false "current" claim.
6. Drift alone (exit code `2`) does not necessarily mean anything in this
   pack is wrong — an ETag can change for reasons unrelated to substance
   (e.g. a CDN re-serve), and a version bump only means the anchor is now
   behind. It means a human should look, not that content is automatically
   presumed stale or automatically corrected.

## Release gate

A release (tag, publish, or "this pack is ready to consume") should treat
`scripts/check-freshness.mjs`'s exit code as a gate:

| Exit code | Meaning | Gate behavior |
| --- | --- | --- |
| `0` | Clean: no schema/date/probe-config errors, nothing overdue, no drift, every probe completed and current. | Release may proceed. |
| `1` | Blocking: invalid `sources.json` entries, malformed `versionProbe`, and/or overdue sources. | **Release must not proceed** until fixed. |
| `2` | Review required: documentation metadata drift, a version bump at or above a probe's `alertOn`, or a probe that could not be completed. | Release should pause for human review; not automatically fatal, but not silently ignorable either. |

Today the gate protects real content: the nine skills, `references/` and
`examples/` all cite entries in `sources.json`, and the mechanism was
exercised end to end on 2026-08-26 (offline and network checks both exit
`0`). It does **not** protect against the pack's guidance being wrong — only
against its cited sources having moved or gone stale.

## Status table

Authored 2026-08-26. "Reviewed" below means *independently re-read and
checked by a human other than the author, or exercised by an automated
check*. **No content row is marked reviewed.** Do not read "Authored,
self-checked" as approval.

| Component | Authored | Last independent review | Verified against | Status |
| --- | --- | --- | --- | --- |
| `sources.json` (70 entries, 6 version probes) | 2026-08-26 | Never | All 67 `metadata-only` entries returned a successful headers-only response on 2026-08-26; 0 unreachable. The 2 `link-only` entries were opened by hand the same day. All 6 `versionProbe` shapes validate offline; 2 completed over the network and 4 could not be reached from the authoring machine (see "Probe reachability"). | Current — reachability only; 4 probes unverified end to end |
| `AGENTS.md` | 2026-08-26 | Never | Its "verified commands" block was run in this repository on 2026-08-26 (Node 24.16.0, npm 11.13.0, Bicep CLI 0.44.1). Target-stack commands are labelled unverified in the file itself. | Authored, self-checked |
| `.agents/skills/` (9 skills) | 2026-08-26 | Never | Frontmatter conforms to the Agent Skills specification: `name` matches directory, SPDX `MIT` licence, `description` ≤1024, `compatibility` a top-level string (364–426 chars), `metadata` a flat string-to-string map, all files ≤500 lines. Verified with the pack's own YAML parser. **No known spec deviations remain.** No behavioural evaluation. | Authored, structurally validated only |
| `references/` (6 files + README) | 2026-08-26 | Never | Cross-checked for internal consistency with `AGENTS.md` and the skills; every external link mirrored into `sources.json`; every relative markdown link in the repository resolves. `npm run validate` reports zero references-category findings. | Authored, self-checked |
| `examples/bicep-managed-identity/` | 2026-08-26 | Never | `bicep build`, `bicep lint`, and `bicep build-params` on both parameter files, all clean, Bicep CLI 0.44.1. Never deployed; no `what-if` run. | Authored, compiles clean |
| `examples/deployment-develop-to-production/` | 2026-08-26 | Never | YAML parsed with Python 3.12.10. Never executed; action versions and inputs unverified. | Authored, parses only |
| `examples/vertical-slice-walkthrough.md` | 2026-08-26 | Never | Narrative only; snippets are illustrative and are not compiled. | Authored, not mechanically checkable |
| `COMPATIBILITY.md` | 2026-08-26 | Never | Each tool row was written from that vendor's own documentation read on 2026-08-26. All behavioural claims recorded as "benchmark pending". | Authored, source-checked |
| `sources.schema.json` | 2026-08-26 | Never | Extended with the optional `versionProbe` object; `npm run freshness:check` validates `sources.json` against it with 0 schema errors. Deliberately one key narrower than `scripts/lib/version-probe.mjs` accepts (no `notes`), so every probe keeps the same four-field shape. | Authored, self-checked |
| Version anchors (React, TypeScript, Vite, EF Core, .NET, Bicep CLI) | 2026-08-26 | Never | One executed (Bicep CLI 0.44.1); the rest read from the consuming repository's lockfile, project target and restore output. Five open review items recorded above and left unresolved by design — notably the `net9.0` target on a channel in maintenance with EOL 2026-11-10. | **Anchored to the real site, not claimed current** |
| `evals/` | 2026-08-26 | Never | Harness authored: 16 fixture cases, `run.mjs`, and eval/benchmark/run schemas. Partial external development pilots covered three cases at n=1 and failed release gates; `evals/RESULTS.md` contains no formal result. | Harness present; formal benchmark NOT RUN |
| `.github/copilot-instructions.md`, `CLAUDE.md`, `GEMINI.md` | Generated | Never | Produced by `npm run generate` from `AGENTS.md`; each carries a do-not-edit header naming its source. | Present and synchronized; behaviour unverified |
| `.github/skills/`, `.claude/skills/` | Generated | Never | Mirrors of `.agents/skills/`: 9 `SKILL.md` + 4 skill `references/` files + README each. | Present and synchronized; behaviour unverified |
| `.mcp.json`, `.vscode/mcp.json` | 2026-08-26 | Never | Each declares one server, `microsoft-learn`, `type: http`, at `https://learn.microsoft.com/api/mcp`, using the wrapper key its own tool documents. Backing sources registered and reachable. | **Declared, never connected to** |
| `README.md`, `manifest.json`, `VERSION`, `CHANGELOG.md` | 2026-08-26 | Never | Synchronized as `0.3.0-pre.3`; explicitly records nine skills, the Copilot CLI release benchmark gate, NOT-RUN evaluations and publication blockers. | Pre-release metadata present; final release blocked |

### Known gaps as of 2026-08-26

1. No independent review of any authored content.
2. The eval harness now exists (16 cases under `evals/`) but has **never
   been run**, so there is still no behavioural evidence for any tool. This
   remains the single largest gap — it has moved from "no harness" to "no
   results".
3. Generated adapters and skill mirrors exist and are synchronized with the
   canonical sources. No supported tool has yet been observed loading or
   following them.
4. The MCP configs now declare the Microsoft Learn endpoint, but **no MCP
   client has been observed connecting to it** from this repository and no
   tool call has been made through it. Declared is not verified.
5. Pre-release metadata exists at `0.3.0-pre.3`; a final release remains
   blocked on behavioural benchmark evidence and a completed knowledge review.
6. No Azure deployment, `what-if`, or live-service check has been performed.
7. Four of the six version probes (npm ×3, NuGet ×1) could not complete from
   the authoring machine, so their end-to-end behaviour is unverified.
8. Six version anchors are knowingly behind the newest releases
   (TypeScript, EF Core, .NET, Bicep CLI, and React/Vite by a patch and a
   minor). The .NET one is time-critical: the site's `net9.0` target sits on
   a channel reported in `maintenance` with EOL `2026-11-10`. The pack does
   **not** retarget to .NET 10 — it documents the real site and raises this.
9. Only Bicep's anchor was established by executing anything; the rest were
   read from the consuming repository's lockfile, project target and restore
   output, which is provenance rather than a build or test performed here.

## How to update this file

When a component is reviewed or re-reviewed, update its row above with a
real date (ISO 8601, e.g. `2026-09-15`), who reviewed it, what it was
checked against, and a status. Only move a row to a reviewed state when a
person other than the author has re-read it, or an automated check covers
it. Prefer editing `sources.json` (machine-checkable) over adding free-text
claims here; this table should summarize `sources.json` and the repository's
actual state, not become a separate truth.

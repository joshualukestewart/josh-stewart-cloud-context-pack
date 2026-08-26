# `scripts/`

Maintenance and build tooling for this pack. **Node >= 20, built-in modules
only** — nothing here may take an npm dependency, and
`scripts/validate-pack.mjs` fails the build if `package.json` ever declares
one.

| Script | npm script | What it does |
| --- | --- | --- |
| `generate-adapters.mjs` | `npm run generate` / `npm run generate:check` | Generates the tool adapters and the physical skill mirrors from `AGENTS.md` + `.agents/skills/`. |
| `validate-pack.mjs` | `npm run validate` / `npm run validate:release` | Structural, licensing, hygiene and release-readiness gate. |
| `install.mjs` | `npm run install:pack -- --tool=… --target=…` | Installs the pack into another project, safely. |
| `build-release.mjs` | `npm run release` / `npm run release:pre` | Builds `dist/` — the release archive, `current.json` and `SHA256SUMS`. |
| `check-freshness.mjs` | `npm run freshness:check` | Knowledge-supply-chain freshness (see `FRESHNESS.md`). |
| `lib/pack-lib.mjs`, `lib/zip.mjs`, `lib/version-probe.mjs` | — | Shared helpers, a minimal deterministic ZIP writer, and version-probe parsing/bounding. |
| `tests/*.test.mjs` | `npm test` | Offline fixture tests (`node --test`). |

`npm run check` runs `generate-adapters.mjs --check` followed by
`validate-pack.mjs`; that is what CI runs on every push, alongside
`npm test`.

## Generation (`generate-adapters.mjs`)

Canonical sources are `AGENTS.md` and `.agents/skills/`. Everything below is
generated from them and must never be hand-edited:

- `.github/copilot-instructions.md`, `CLAUDE.md`, `GEMINI.md`
- `.github/skills/`, `.claude/skills/` (physical copies, **not** symlinks —
  symlinks do not survive archive extraction, Windows checkouts, or most
  tools' skill loaders)

Properties worth relying on:

- **Deterministic.** Same inputs, same bytes: no timestamps, byte-wise
  sorting, LF endings. `--check` therefore detects drift reliably and is
  safe to run in CI.
- **Concise adapters.** Each adapter points at `AGENTS.md` rather than
  restating it, so the two can never disagree in substance.
- **`CLAUDE.md` imports `@AGENTS.md` explicitly.** Claude does not read
  `AGENTS.md` on its own; the import is what actually loads the core file.
  Copilot and Gemini adapters link to it instead.
- **Bounded blast radius.** Writes and deletions are confined to the
  declared adapter targets and mirror roots. Stale *mirrored skill* files
  are pruned; anything else — including hand-written files sitting at a
  mirror root — is left untouched.

## Validation (`validate-pack.mjs`)

Checks, by group: `json`, `files`, `version`, `manifest`, `skills`,
`references`, `adapters`, `freshness`, `mcp`, `trademark`, `hygiene`,
`license`, `release`. Errors fail the run; warnings do not unless
`--strict`. `--release` promotes the release-relevant warnings (skill
count, knowledge review fields, changelog entry, MCP source registration,
overdue sources, empty release claim lists, unreadable files) into errors,
and is what `build-release.mjs` runs before building.

Two scanning rules keep this honest in a live working tree:

- **Tooling scratch is not pack content.** Any dot-directory other than
  `.agents`, `.claude`, `.github` and `.vscode` (for example an eval
  harness's `evals/.tmp-*` workspace) is skipped by every script — never
  validated, never mirrored, never shipped — and the skipped paths are
  printed so the exclusion is visible rather than silent.
- **An unreadable file has not been checked.** A file that is locked or
  mid-write is reported once as a warning, and as an error under
  `--release`, rather than crashing the run or being silently skipped.
  Reads retry briefly first, because a syncing client (OneDrive, Dropbox)
  routinely holds a file for a moment after it is written. Generation is
  stricter still: if a canonical skill source cannot be read, it refuses to
  generate at all rather than mirror a partial pack.

### Licensing

The pack is MIT for both code and prose, with `LICENSE` as its single
licence file. `manifest.license` must declare `code`, `content` and the
file(s) it ships, `package.json`'s `license` must match `license.code`, and
**every** root `LICENSE*` file must be named in that block — so a
superseded or unused licence file cannot reappear unnoticed. Third-party
material is not included; if any is ever added deliberately, it carries its
own work-specific licence and attribution in `NOTICE` and `sources.json`,
covering only that work.

### Positioning claims

Where the pack describes *itself* — `manifest.description`,
`package.json`'s description, and `README.md`'s opening section — claims
that are not true of it are rejected: "vendor-neutral" and
"cloud-agnostic" both imply neutrality about the cloud, when the guidance
is deliberately Microsoft Azure-specific and only the *packaging* is
portable across agent tools. Use "tool-portable" or "cross-agent". The
check is scoped to those three places on purpose: the same words are
perfectly accurate elsewhere (an eval fixture, for instance, really can be
vendor-neutral), and text that records the wording change is exempt.

### SKILL.md contract

Every directory under `.agents/skills/` must contain a `SKILL.md` of fewer
than 500 lines whose front matter follows the Agent Skills standard shape:

| Key | Rule |
| --- | --- |
| `name` | lower-case kebab-case, and **identical to the directory name** |
| `description` | non-empty string, ≤ 1024 characters (warns past 600); this is what an agent matches a task against |
| `license` | SPDX-style identifier, e.g. `MIT` |
| `compatibility` | **a top-level string**, ≤ 1024 characters, stating what the skill was checked against — even when the honest answer is "not verified" |
| `metadata` | optional, and a **flat map of string values** only |

`compatibility` is a string because that is what loaders following the
standard read: a nested block is silently dropped, so it would document
nothing. `metadata.compatibility` is therefore **rejected** with a
migration hint, as are nested maps, lists and unquoted numbers/booleans
anywhere in `metadata`. Keys outside the standard set (`name`,
`description`, `license`, `compatibility`, `metadata`, `allowed-tools`,
`version`) are warned about, since some loaders reject unknown keys.

```yaml
---
name: bicep-infra-change
description: Use when the task mentions Bicep, an ARM template, or provisioning an Azure resource.
license: MIT
compatibility: Authored 2026-08-26 against Bicep CLI 0.44.1; no deployment or what-if has been run, and no agent benchmark exists.
metadata:
  pack: josh-stewart-cloud-context-pack
  owner: Joshua Stewart
  layer: infrastructure
---
```

These rules are pure functions (`inspectSkillFrontmatter`) covered by
`tests/skill-frontmatter.test.mjs`, so the contract is executable rather
than prose-only.

### Local reference rules

Markdown links to local paths must resolve to a file that exists, must not
escape the repository, must not be absolute or Windows-style, and must not
point into `.git`/`dist`/`node_modules`. A skill may link to another
skill's `SKILL.md` but not to its internal files, and canonical content may
not link into a generated mirror — both keep a skill self-contained when it
is installed on its own.

## Freshness (`check-freshness.mjs`)

Offline by default: it validates `sources.json` against
`sources.schema.json`, checks review dates, and validates the shape of any
`versionProbe` entries. `--network` additionally performs headers-only
reachability checks on `metadata-only` sources and runs the version probes
below. See `FRESHNESS.md` for the policy.

Exit codes: `0` clean, `1` blocking (invalid registry data or probe
configuration, or an overdue source), `2` review required (metadata drift,
a version bump at or above a probe's threshold, or a probe that could not be
completed safely). `--write-manifest` is skipped unless the run is clean.

### Version probes

A source may opt into a machine-readable version check:

```json
"versionProbe": {
  "url": "https://api.nuget.org/v3-flatcontainer/newtonsoft.json/index.json",
  "format": "nuget-index",
  "testedVersion": "13.0.3",
  "alertOn": "minor"
}
```

| `format` | Expected document | Latest stable taken from |
| --- | --- | --- |
| `npm-latest` | npm registry packument or `/<pkg>/latest` | `dist-tags.latest`, falling back to the highest stable key in `versions` |
| `nuget-index` | NuGet flat-container `index.json` | highest stable entry in `versions` |
| `dotnet-release-index` | .NET `releases-index.json` | highest stable `latest-release` in an `active`/`maintenance` channel |
| `github-latest` | GitHub `releases/latest` | `tag_name`, with any prefix stripped |

`alertOn` sets the escalation threshold: `major` alerts only on a major
bump, `minor` (the default) on major or minor, `any` on any increase. A
newer version below the threshold is still reported, as information only,
and does not change the exit code. A `testedVersion` that is *newer* than
the published latest is always escalated — it usually means the pin, the
registry or the probe URL is wrong.

Probe safety rules, all enforced in `lib/version-probe.mjs` and covered by
`tests/version-probe.test.mjs`:

- Probes run **only** with `--network`, and never for a source whose
  `retrievalPolicy` is `manual-review-only`.
- Each probe fetches exactly one document, bounded to 1 MiB and 8 seconds,
  which must be JSON. An oversized declared `content-length` is refused
  before the body is read at all.
- Anything unexpected — HTTP error, rate limiting, timeout, wrong content
  type, unparseable JSON, no stable version, a draft/prerelease "latest" —
  **fails closed** as a probe error that requires review. A probe never
  silently reports "no drift".
- Only the extracted version string plus ETag/Last-Modified/status are
  cached in `.freshness-cache.json`. Response bodies are never stored, and
  ordinary documentation checks remain headers-only.
- Nothing is ever rewritten: a version bump is reported for a human to act
  on, never applied to `sources.json`, `testedVersion` or skill content.

Point npm probes at `/<pkg>/latest` where possible — it is a fraction of the
size of a full packument, and the probe budget is deliberately tight.

## Install (`install.mjs`)

```
node scripts/install.mjs --tool=copilot|claude|codex|gemini --target=<dir> [--write] [--force]
```

Dry run by default; `--write` applies, `--force` is required before any
existing, differing file is overwritten. Every path is reported with the
action taken in both modes, all writes are confined to `--target`, and the
pack refuses to install into itself, a directory inside itself, a
filesystem root or a home directory. Each run also writes
`.context-pack/` (this pack's `LICENSE`, `NOTICE`, and a receipt listing
each installed path with its SHA-256) so the target keeps attribution and
provenance without its own `LICENSE` being touched.

MCP is configured per tool, endpoint only — never a tool/prompt/resource
schema, because those are discovered from the server at runtime:

| Tool | File | Wrapper key |
| --- | --- | --- |
| Copilot (VS Code) | `.vscode/mcp.json` | `servers` |
| Claude | `.mcp.json` | `mcpServers` |
| Gemini CLI | `.gemini/settings.json` | `mcpServers` (`httpUrl`) |
| Codex | `~/.codex/config.toml` | `mcp_servers` — printed, never written |

Existing config files are **merged**: other servers and unrelated keys are
preserved, and a conflicting `microsoft-learn` entry is reported rather than
replaced. Codex configures MCP at user level, and this installer never
writes outside the target project, so it prints the TOML snippet instead.

## Release (`build-release.mjs`)

Produces `dist/` (gitignored):

- `<name>-<version>.zip` — sorted, allow-listed content, fixed MS-DOS
  timestamps, plus an in-archive `release-manifest.json` listing every other
  entry with its size and SHA-256.
- `current.json` — the delivery site's release pointer.
- `SHA256SUMS` — checksums for both.

Never included: `.git`, `dist`, `node_modules`, caches, logs, archives,
credential-shaped files, CI workflows, or any tooling-scratch
dot-directory (see the scanning rules above).

Release gates (all must pass): clean git tree with a commit,
`validate-pack.mjs --release`, an offline-clean `check-freshness.mjs`,
populated and non-overdue `manifest.knowledge` fields whose
`sourceRegistrySha256` still matches `sources.json`, and non-empty
`manifest.release.formallyTestedWith` / `adapterSupport`. `--pre-release`
turns those gates into warnings for local inspection and writes
`dist/PRERELEASE` recording exactly what was bypassed — its output must
never be published.

`current.json` carries exactly the fields the delivery site validates:
`packId` (`cloud-full-stack`), `version`, `blobName`, `sizeBytes`,
`sha256`, `publishedAt`, `repositoryUrl`, `formallyTestedWith`,
`adapterSupport`, `knowledgeReviewedAt`, `reviewDueAt` and
`sourceRegistrySha256`. The builder re-checks every one of the site's own
constraints before writing, so an invalid pointer cannot reach `dist/`.

Two of those constraints are easy to get wrong by hand:

- **`blobName` must sit under `releases/<version>/`.** The builder derives
  it; nothing else should construct it.
- **The two claim lists accept only canonical tool names** — `GitHub
  Copilot`, `Claude Code`, `OpenAI Codex`, `Gemini CLI` — with no
  duplicates and no name in both lists. A tool is either benchmarked
  (`formallyTestedWith`) or format-only (`adapterSupport`), never both.
  File locations deliberately do not appear there; they belong in
  `README.md` and `COMPATIBILITY.md`, where they can carry dates and
  caveats. Both `validate-pack.mjs` and `build-release.mjs` enforce this
  (`tests/release-contract.test.mjs`).

### Determinism

Archive bytes depend only on file contents and names. Entries are stored
uncompressed when deflate would not shrink them, so trivial files are
identical across Node builds; `--store` disables compression entirely for
byte-for-byte reproducibility independent of the zlib version in use.

## Assumptions still to verify

These are recorded as unverified until someone confirms them against the
current documentation (`COMPATIBILITY.md` tracks the outcome, `sources.json`
tracks the sources):

1. MCP config file names and wrapper keys per tool, as tabulated above.
2. `az storage blob upload --overwrite false` failing on an existing blob is
   what makes a published version immutable; `current.json` is replaced with
   `--overwrite true` and has no ETag-conditional guard, so concurrent
   publications are prevented by the workflow's `concurrency` group rather
   than by the storage service.
3. Declaring the Microsoft Learn MCP endpoint does not verify it.
   `FRESHNESS.md`'s live-MCP policy requires a matching `sources.json`
   entry; `validate-pack.mjs` reports its absence and blocks a release.

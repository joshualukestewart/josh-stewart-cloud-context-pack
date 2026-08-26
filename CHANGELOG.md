# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.3.0-pre.3] - 2026-08-26

### Changed

- Required least-privilege explanations to distinguish workload operations
  from extra role permissions and compare the closest narrower and broader
  roles.
- Prohibited "exactly" claims unless the retrieved permission set equals the
  workload's required set.
- Excluded machine-local `evals/runs/` workspaces and transcripts from source
  validation and release archives, with regression tests for both paths.

This change responds to a preliminary n=1 calibration failure. No formal
benchmark result exists and this pre-release makes no behavioural claim.

## [0.3.0-pre.2] - 2026-08-26

### Changed

- Designated GitHub Copilot CLI as the single protocol-complete benchmark
  required for a behavioural release claim.
- Kept Claude Code, GitHub Copilot agent mode and other adapters as optional
  future comparison targets rather than mandatory release dependencies.
- Made the release benchmark designation schema-validated and fail-closed.

This remains a pre-release with **no formal benchmark result** and makes no
behavioural claim.

## [0.3.0-pre.1] - 2026-08-26

First pre-release. Nine skills are authored and the supporting tooling is in
place. Preliminary development pilots are partial, n=1 and non-claim; **no
formal benchmark has been completed**, so this release makes no behavioural
claim; see `evals/RESULTS.md` (`NOT RUN`) and
the "benchmark pending" column throughout `COMPATIBILITY.md`.

### Added

- **Nine skills** under `.agents/skills/`, each a `SKILL.md` in the Agent
  Skills shape (`name`, `description`, `license`, a top-level
  `compatibility` string, flat `metadata`): `aspnetcore-endpoint-slice`,
  `react-vite-feature-slice`, `efcore-azuresql-change`,
  `bicep-infra-change`, `entra-managed-identity-wiring`,
  `azure-appservice-deploy`, `release-staging-to-production`,
  `appinsights-telemetry-and-triage`, `secure-by-design-review`.
- `references/` and `examples/` supporting that guidance, and an `evals/`
  harness with its assertions, schemas and a `RESULTS.md` that records the
  absence of any run rather than leaving it ambiguous.
- **Generated adapters and mirrors**, produced by
  `scripts/generate-adapters.mjs` from `AGENTS.md` and `.agents/skills/`:
  `.github/copilot-instructions.md`, `CLAUDE.md` (which imports
  `@AGENTS.md` explicitly, because Claude does not read `AGENTS.md`),
  `GEMINI.md`, and physical `.github/skills/` and `.claude/skills/`
  mirrors. `--check` fails on drift, so the adapters cannot silently
  diverge from their source.
- **Tooling**, all dependency-free Node 20: `validate-pack.mjs` (structure,
  skill front matter, local references, adapter drift, MCP, trademark,
  licensing, hygiene and release gates), `install.mjs` (dry run by default,
  never overwrites without `--force`, reports every path, configures the
  Microsoft Learn MCP endpoint per tool), `build-release.mjs`
  (deterministic archive, file inventory with hashes, `SHA256SUMS` and a
  `current.json` release pointer) and offline tests under `scripts/tests/`.
- **Microsoft Learn MCP endpoint** declared in `.mcp.json` and
  `.vscode/mcp.json`, endpoint only — no tool schemas are pinned, because
  they are discovered from the server at runtime.- **Version probes** in `scripts/check-freshness.mjs`: bounded, JSON-only
  latest-version checks (npm, NuGet, .NET release index, GitHub releases)
  that report drift against a recorded `testedVersion` and fail closed
  rather than reporting a false "no drift".
- `.github/workflows/validate.yml` and `.github/workflows/release.yml`,
  using pinned official actions, least-privilege permissions, GitHub OIDC
  for Azure (no stored secrets), an immutable versioned upload and a
  `current.json` pointer written last.

### Changed

- Status moves from `scaffold` to `pre-release`; `README.md`,
  `manifest.json`, `package.json` and `VERSION` now describe the pack as it
  actually is.
- Renamed the pack's positioning from "vendor-neutral" to **"tool-portable"**
  in the manifest, package and README. The old wording implied neutrality
  about the cloud, which is wrong: the packaging is portable across agent
  tools, but the guidance is deliberately Microsoft Azure-specific.
  `validate-pack.mjs` now rejects that claim (and "cloud-agnostic") in the
  places where the pack describes itself.
- Skill front matter follows the Agent Skills standard shape: a top-level
  `compatibility` **string** and flat string `metadata`. Nested
  `metadata.compatibility` is rejected by validation, because loaders
  following the standard read `compatibility` as text and would silently
  drop a nested block.
- Simplified licensing to MIT-only for all original code and prose, and
  removed the unused CC BY placeholder file. Third-party material must add
  explicit, work-specific attribution before inclusion. (The
  `[0.2.1-scaffold]` entry below says `LICENSE-CONTENT` was retained; it
  has since been deleted, and `LICENSE` is now the only licence file.)
- Assigned source-review accountability to Joshua Stewart and removed the
  unused CC BY legal-code entry from the freshness registry.

### Not done

- **No benchmark.** `manifest.json`'s `release.formallyTestedWith` is
  deliberately empty and must stay empty until `evals/RESULTS.md` records a
  real run. `release.adapterSupport` names the four tools this pack ships a
  format adapter for, using the delivery API's canonical names (`GitHub
  Copilot`, `Claude Code`, `OpenAI Codex`, `Gemini CLI`); which files each
  reads is documented in `README.md` and `COMPATIBILITY.md`. It is a format
  claim, unverified behaviourally, and no name may appear in both lists.
- **No knowledge review recorded.** Live freshness checks report version
  drift and probe errors, so `manifest.json`'s `knowledge.*` fields remain
  unset and `scripts/build-release.mjs` refuses to build a publishable
  release.
- Nothing has been published: no GitHub release, no blob upload, no
  `current.json` in front of any site.

## [0.2.1-scaffold] - 2026-08-26

### Changed

- **Renamed the repository and all product-name references** from "Azure
  Full-Stack Context Pack" / `azure-fullstack-context-pack` to "Joshua
  Stewart Cloud Context Pack" / `josh-stewart-cloud-context-pack`, per
  Microsoft's trademark guidance against including Microsoft marks in
  third-party product/repository names. "Azure" now appears only in
  truthful, subordinate, descriptive wording (e.g. "for Microsoft Azure
  full-stack development"), never as this project's own name.
- Local working-copy folder moved to
  `josh-stewart-cloud-context-pack` (via a copy+delete move after a
  direct rename was blocked by a filesystem lock); `.git`, branch `main`,
  and the staged-but-uncommitted index were preserved.
- Added the intended canonical repository URL,
  `https://github.com/joshualukestewart/josh-stewart-cloud-context-pack`
  (not yet published), to `README.md`, `package.json` (`repository`/
  `homepage`), `manifest.json` (`repository`), and `sources.schema.json`'s
  `$id`.
- **License consolidated to MIT-only** for all original authored code and
  documentation/prose, with the copyright holder placeholder replaced by
  "Joshua Stewart" in `LICENSE` and `NOTICE`. `LICENSE-CONTENT` (CC BY 4.0)
  is retained but re-labeled as a reserved, currently-unused optional
  license — kept only in case genuine third-party CC BY-licensed prose is
  incorporated later, and explicitly documented as not applying to
  anything in this repository today. `manifest.json`'s `license` block and
  `package.json`'s `license` field updated accordingly.
- `NOTICE`'s trademark disclaimer expanded to explicitly note this
  repository's name and identifiers deliberately omit Microsoft marks.

No substantive skill content was authored in this release; this remains a
naming/licensing correction on top of the existing structural scaffold.

## [0.2.0-scaffold] - 2026-08-26

### Added

- Knowledge-supply-chain freshness system: `sources.json` (9 cautious seed
  entries covering standards/tool docs already used by this scaffold, no
  skill-topic sources) validated against `sources.schema.json`.
- `scripts/check-freshness.mjs` — dependency-free Node 20 script: offline
  schema/date/overdue validation, plus an opt-in `--network` mode that
  performs headers-only (never body) reachability and ETag/Last-Modified
  drift checks, with a distinct exit code for "drift" vs. "blocking"
  invalid/overdue results. Supports `--write-manifest` for a human-invoked,
  narrowly-scoped update to `manifest.json`'s knowledge metadata.
- `.github/workflows/freshness.yml` — scheduled, least-privilege
  (`contents: read`, `issues: write`) workflow that runs the check weekly
  and opens/updates/closes a single labeled GitHub issue, using only
  official `actions/*` actions and the `gh` CLI.
- `FRESHNESS.md` rewritten with volatility tiers (stable/versioned/
  volatile), a live-MCP policy, the review workflow, an explicit
  no-autonomous-update rule, and a release gate contract.
- `manifest.json` extended with a `knowledge` block
  (`knowledgeReviewedAt`, `reviewDueAt`, `sourceRegistrySha256` — all
  placeholders pending a human-run review) and its update contract.
- `package.json` scripts: `freshness:check`, `freshness:check:network`,
  `freshness:check:json`, `freshness:check:network:json`,
  `freshness:update-manifest`.
- `.gitignore` updated to exclude the local `.freshness-cache.json`
  operational cache and ad hoc report exports.

No substantive skill content was authored in this release either; this
remains a structural foundation, now including its freshness tooling.

## [0.1.0-scaffold] - 2026-08-26

### Added

- Initial repository scaffold: `README.md`, `AGENTS.md`, `COMPATIBILITY.md`,
  `FRESHNESS.md`, `VERSION`, `manifest.json`.
- Dual licensing: `LICENSE` (MIT, for code/scripts) and `LICENSE-CONTENT`
  (CC BY 4.0, for original prose), plus `NOTICE` with attribution and
  Microsoft trademark disclaimer.
- MCP configuration placeholders: `.mcp.json`, `.vscode/mcp.json`.
- Generated-adapter placeholders: `.github/copilot-instructions.md`,
  `CLAUDE.md`, `GEMINI.md`.
- Placeholder scaffolds for `.agents/skills/`, `.github/instructions/`,
  `.github/skills/`, `.claude/rules/`, `.claude/skills/`, `references/`,
  `examples/`, `evals/`, `scripts/`, and `.github/workflows/`.

No substantive skill content was authored in this release; this is a
structural foundation only.

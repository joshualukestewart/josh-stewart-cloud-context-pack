# Compatibility

**Reading date for everything below: 2026-08-26.** Each row states what was
checked, how, and on what date. Nothing here is marked verified without a
reproducible check behind it.

Two different things are tracked separately and must not be conflated:

- **Format compatibility** — does this pack's file layout match what a
  tool's own primary documentation says it reads? This *is* checked, by
  reading each vendor's docs on the stated date.
- **Behavioural compatibility** — does the tool actually load these files
  and act on them correctly? This is **not** checked yet for any tool. No
  formal benchmark has been run.

> **No tool is formally tested with this pack.** Adapter and mirror files
> exist, and the MCP configuration declares an endpoint, but existence is
> not verification. Every row below is **benchmark pending**, and none may be
> described as tested, supported, certified or working in a README, release
> note, or any public claim.

## Status legend

| Marker | Meaning |
| --- | --- |
| **Documented** | The vendor's own primary documentation, read on the stated date, describes support for this file/location. |
| **Adapter-only** | This pack ships a file the tool is understood to read, but the vendor documentation confirming it could not be located on the stated date. Treat as provisional. |
| **Benchmark pending** | No structured evaluation of whether the tool follows this pack's guidance has been run. **Nothing in this repository is formally tested with any tool.** |

## Agent / tool compatibility

Tool names below are the canonical product names: **GitHub Copilot**,
**Claude Code**, **OpenAI Codex**, **Gemini CLI**.

Adapters and skill mirrors are **generated** by `npm run generate` from
`AGENTS.md` and `.agents/skills/`, and they now exist on disk (they are no
longer placeholders). "Format compatibility" below means the file exists in a
location the vendor documents — it does **not** mean the tool was observed
loading or following it.

| Tool | Files this pack ships | Format compatibility | Behavioural verification | Notes (checked 2026-08-26) |
| --- | --- | --- | --- | --- |
| GitHub Copilot | `.github/copilot-instructions.md` (generated), `AGENTS.md`, `.agents/skills/` (canonical), `.github/skills/` and `.claude/skills/` (generated mirrors), `.github/instructions/` (placeholder README only) | **Documented** — GitHub documents repository/path instructions and `AGENTS.md`; VS Code's current Agent Skills documentation lists `.github/skills/`, `.claude/skills/` and `.agents/skills/` as supported project locations across Copilot in VS Code, Copilot CLI and the cloud agent. | **Benchmark pending** | The generated adapter and all three documented skill layouts exist, but no Copilot run has loaded or acted on this pack. Sources: `github-copilot-repository-instructions-docs`, `vscode-agent-customization-docs`, `vscode-agent-skills-docs`. |
| Claude Code | `CLAUDE.md` (generated; imports `AGENTS.md` via `@AGENTS.md`), `.claude/rules/` (placeholder README only), `.claude/skills/` (generated mirror: 9 `SKILL.md` + 4 skill `references/` files + README) | **Documented** — Claude Code's memory documentation describes `CLAUDE.md` (root, `.claude/`, user-level) and its skills documentation describes filesystem skill discovery. | **Benchmark pending** | **Claude Code reads `CLAUDE.md`, not `AGENTS.md`.** Its memory documentation, read on this date, does not mention `AGENTS.md` and documents no aliasing or symlink mechanism. This pack therefore treats `AGENTS.md` as canonical and `CLAUDE.md` as a **required** generated adapter, which carries the content forward by import rather than duplication. Sources: `claude-code-memory-docs`, `claude-code-skills-docs`. |
| OpenAI Codex | `AGENTS.md` | **Documented** — OpenAI's current agent-configuration documentation states that Codex reads `AGENTS.md` before doing work and documents its root-to-working-directory discovery order. | **Benchmark pending** | The documented default combined project-instruction limit is 32 KiB; this pack keeps its root `AGENTS.md` well below it. Format discovery is documented, but no Codex run has loaded or acted on this pack. Source: `openai-codex-docs`. |
| Gemini CLI | `GEMINI.md` (generated; points to `AGENTS.md`), `.agents/skills/` (canonical) | **Documented** — Gemini CLI has a dedicated context-file reference, documents `context.fileName` (its example includes `AGENTS.md`), and lists `.agents/skills/` as a first-class workspace alias that takes precedence over `.gemini/skills/`. | **Benchmark pending** | `GEMINI.md` remains the correct zero-configuration adapter. Skill activation requires user consent, so documented discovery is not proof of use. Sources: `gemini-cli-repo`, `gemini-cli-context-file-docs`, `gemini-cli-skills-docs`. |
| Agent Skills format (`.agents/skills/`) | Nine `SKILL.md` files plus 4 skill-local `references/` files | **Documented** — frontmatter and layout match the Agent Skills specification; VS Code/Copilot and Gemini CLI both document `.agents/skills/` as a project/workspace location. | **Benchmark pending** | The specification is hosted at `agentskills.io`. A previously plausible host, `agentskills.dev`, did not resolve on this date. Sources: `agent-skills-spec`, `agent-skills-overview-anthropic`, `vscode-agent-skills-docs`, `gemini-cli-skills-docs`. |
| Generic `AGENTS.md`-compatible agents | `AGENTS.md` | **Documented** — the convention itself is published and reachable. | **Benchmark pending** | `AGENTS.md` is a real traversal contract with a routing table, so there is substantive content to traverse to. Source: `agents-md-convention`. |
| VS Code (as host) | `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, `.github/instructions/`, `.vscode/mcp.json` | **Documented** — VS Code's agent-customization documentation, read on this date, describes all of these. | **Benchmark pending** | VS Code documents some scoped `AGENTS.md` behaviour as experimental. Re-read before relying on subfolder scoping. Source: `vscode-agent-customization-docs`. |
| MCP clients | `.mcp.json` (`mcpServers` wrapper), `.vscode/mcp.json` (`servers` wrapper) | **Declared, not verified** — both files now declare one server, `microsoft-learn`, as `type: http` at `https://learn.microsoft.com/api/mcp`. Each file uses the wrapper key its own tool documents. | **Benchmark pending** | These are no longer empty placeholders. **Declaring a server is not the same as having verified it:** no MCP client has been observed connecting to this endpoint from this repository. Tool names and schemas are deliberately discovered at runtime rather than pinned. Sources: `microsoft-learn-mcp-docs`, `microsoft-learn-mcp-developer-reference`, `microsoft-docs-mcp-repo`, `model-context-protocol-spec`, `vscode-mcp-server-docs`. |

### Generated adapters and mirrors

`npm run generate` produces, from `AGENTS.md` and `.agents/skills/`:

| Generated path | Contents |
| --- | --- |
| `.github/copilot-instructions.md` | GitHub Copilot adapter |
| `CLAUDE.md` | Claude Code adapter, importing `AGENTS.md` |
| `GEMINI.md` | Gemini CLI adapter, pointing to `AGENTS.md` |
| `.github/skills/` | Mirror of the nine skills + their `references/` files + README |
| `.claude/skills/` | Mirror of the nine skills + their `references/` files + README |

Every generated file carries a "DO NOT EDIT BY HAND" header naming its
source. They must never be hand-authored, and `npm run validate` fails when
they drift from the canonical sources.

**Current state:** these files exist and are synchronized with their canonical
sources. `npm run generate:check` and `npm run validate` both pass the adapter
drift check. This verifies generated bytes only; behavioural use remains
benchmark pending.

### What "benchmark pending" means concretely

For every tool above, the following has **not** been done: loading this pack
in GitHub Copilot, Claude Code, OpenAI Codex or Gemini CLI, issuing
representative tasks, and measuring whether the tool routed to the right
skill and honoured the non-negotiables. An eval harness now exists under
`evals/` (16 fixture cases plus `run.mjs`), but **it has never been
executed** — `evals/RESULTS.md` records that explicitly.

Specifically, none of the following has been observed even once:

- a tool discovering and loading a skill from `.github/skills/` or
  `.claude/skills/`;
- a tool reading `.github/copilot-instructions.md`, `CLAUDE.md` or
  `GEMINI.md` and acting on the traversal contract;
- an MCP client connecting to the declared `microsoft-learn` endpoint from
  this repository, or any tool call made through it.

Until graded runs exist, no behavioural claim should be made in this
repository, in a README, or in any public description of this pack.

## How the skills were validated (2026-08-26)

Checked against the Agent Skills specification:

- Nine skill directories exist under `.agents/skills/`, each containing a
  `SKILL.md`.
- Each `name` is lowercase alphanumeric with single hyphens, no leading or
  trailing hyphen, ≤64 characters, and **equal to its directory name**.
- Each `description` is non-empty, ≤1024 characters (all are ≤528), and
  states both what the skill does and when to use it.
- Each `license` is the SPDX identifier `MIT`, matching the pack licence.
- Each `compatibility` is a **top-level string** of 364–426 characters, well
  inside the specification's 1–500 limit.
- Each `metadata` is a **flat string-to-string mapping** (8 keys: `pack`,
  `owner`, `layer`, `authored`, `checked-against`, `target-stack`,
  `behaviour-verified`, `volatile-facts`). No nested mappings.
- Each `SKILL.md` is well under the 500-line limit (115–143 lines).
- File references from each `SKILL.md` are one level deep, and every
  relative link in the pack resolves to a file that exists.

### Specification conformance (2026-08-26)

An earlier revision of this pack recorded compatibility as a *nested mapping*
under `metadata.compatibility`, to satisfy a repository-local validator. That
deviated from the specification, which defines `compatibility` as a top-level
string and `metadata` as a flat map of string values.

**That deviation has been removed.** All nine skills now use the
specification shape, with the substantive caveats preserved — folded into the
`compatibility` string and into flat `metadata` keys. There are now **no known
deviations from the Agent Skills specification** in this pack.

One coordination note: `scripts/validate-pack.mjs` still requires
`compatibility` to be a mapping, so it currently reports the spec-correct
files as errors. The skills are correct against the published specification;
the validator is the thing that needs to follow. See
[FRESHNESS.md](FRESHNESS.md)'s "Known gaps".

This validates **structure**, not behaviour. It does not confirm that any
agent loads or follows these skills.

## Azure surface compatibility

This pack makes **no** Azure version, SDK, API-version, SKU, quota, limit or
pricing claim. That is a deliberate design position, not an omission: those
facts are volatile and must be retrieved live at the moment of use, per the
live-doc policy in [AGENTS.md](AGENTS.md) and the source registry in
[`sources.json`](sources.json).

### Version anchors and probes (2026-08-26)

The one bounded exception is the set of **version anchors** the pack's prose
is coordinated to. An anchor records what the **consuming repository actually
resolves**; it is **not** a claim that the version is current or supported,
and it is deliberately not "whatever the registry says is newest". Each is
watched by a `versionProbe` in `sources.json`.

| Dependency | Anchor | Established by | Probe result on 2026-08-26 |
| --- | --- | --- | --- |
| Bicep CLI | `0.44.1` | **Executed** — built and linted `examples/` | Behind: latest release `0.46.1` (minor bump) |
| React / react-dom | `19.2.7` | Consuming repo's `web/package-lock.json` | Probe could not complete here; registry latest was `19.2.8` (patch ahead) |
| TypeScript | `6.0.3` | Consuming repo's `web/package-lock.json` | Probe could not complete here; registry latest was `7.0.2` (new major) |
| Vite | `8.1.0` | Consuming repo's `web/package-lock.json` | Probe could not complete here; latest published release was `8.2.2` (2026-08-20; minor ahead), and the `8.1` line has advanced to `8.1.5`. Read from vendor release metadata, not the npm dist-tag, which remains unverified here. |
| EF Core | `9.0.19` | Repo's EF Core packages resolve to this on `net9.0` | Probe could not complete here; highest stable was `10.0.11` |
| .NET | `9.0.19` | Project targets `net9.0`, installed runtime `9.0.19`; builds run under SDK `10.0.400` | Behind: highest supported channel release `10.0.11` (major bump) |

**Material finding, unresolved by design:** on 2026-08-26 the official .NET
release index reported channel `9.0` in support phase `maintenance` with an
EOL date of `2026-11-10`, while channel `10.0` was `active`. **The pack does
not retarget to .NET 10** — it describes the real site, which targets
`net9.0`. Surfacing the maintenance/EOL position as review work is the
intended behaviour, and retargeting is a decision for a human, recorded as an
open review item in [FRESHNESS.md](FRESHNESS.md).

Note also that the site's builds currently execute under **SDK 10.0.400**
while still targeting `net9.0`. SDK version and target framework are tracked
as separate facts and must not be conflated.

Four probes (three npm, one NuGet) are configured and shape-valid but could
not complete from the authoring machine, because direct HTTPS to
`registry.npmjs.org` and `api.nuget.org` is intercepted there. They fail
closed as probe errors rather than reporting "no change", so they are
**unverified end to end** until CI runs them.

### What else is and is not checked

| Item | Status (2026-08-26) |
| --- | --- |
| Every Azure/.NET/web documentation URL relied upon | **Reachable** — all 67 `metadata-only` sources returned a successful headers-only response under `npm run freshness:check:network`; 0 unreachable. |
| `sources.json` against `sources.schema.json` | **Valid** — 0 schema errors, 0 date errors, 0 probe-configuration errors; `npm run freshness:check` exits `0`. |
| `examples/bicep-managed-identity/main.bicep` | **Compiles and lints clean** — `bicep build` and `bicep lint` with Bicep CLI 0.44.1 (itself behind, see above). Both `.bicepparam` files build with `bicep build-params`. |
| The same template actually deploying to Azure | **Not verified.** No deployment, and no `what-if`, has been run against any subscription. |
| The api versions, SKU names and role definition id in that template | **Not verified and expected to age.** The file flags this inline. |
| `examples/deployment-develop-to-production/deploy.example.yml` | **Parses as YAML** (Python 3.12.10). Never executed; action versions and inputs unverified. |
| Query shapes in `appinsights-telemetry-and-triage/references/` | **Not verified.** Marked as shapes, not syntax, in the file itself. |
| Any guidance in the nine skills against a live Azure surface | **Not verified.** |

## How to update this file

1. Record what was tested — tool name and version, or Azure service plus
   API/SDK version.
2. Record the date and the method (manual test, automated eval, headers-only
   reachability, compiler/linter run).
3. Only move a row from "Benchmark pending" once a reproducible check exists,
   and prefer linking to an entry in `evals/` over asserting it here.
4. Never upgrade an "Adapter-only" row without first pinning the vendor
   documentation that justifies it in `sources.json`.

## Related tooling

This file records compatibility *claims*. `sources.json` +
`scripts/check-freshness.mjs` (see [FRESHNESS.md](FRESHNESS.md)) separately
track whether the *external documentation these claims depend on* is still
reachable and unchanged. The two are complementary: a source being fresh
does not make a claim here verified, and a verified claim does not exempt
its underlying source from review.

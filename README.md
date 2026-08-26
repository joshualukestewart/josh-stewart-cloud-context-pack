# Joshua Stewart Cloud Context Pack

> **Status: pre-release (`0.3.0-pre.1`).** Nine skills are authored, an
> evaluation harness exists, and the tooling that generates, validates and
> packages the pack is in place. Small development pilots have exercised three
> cases, but they are incomplete, n=1, and failed release gates. **No formal
> benchmark has been completed or published**, so no behavioural claim is made. See
> [CHANGELOG.md](CHANGELOG.md), [COMPATIBILITY.md](COMPATIBILITY.md) and
> [evals/RESULTS.md](evals/RESULTS.md).

Canonical repository (intended, not yet published):
<https://github.com/joshualukestewart/josh-stewart-cloud-context-pack>

## What this is

The Joshua Stewart Cloud Context Pack is a versioned, **tool-portable**
collection of reusable guidance ("skills") for AI coding agents — GitHub
Copilot, Claude Code, OpenAI Codex, Gemini CLI, and any other tool that
follows the [AGENTS.md](https://agents.md) convention, the
[Agent Skills](https://agentskills.io) format, or the Model Context Protocol
(MCP) — for Microsoft Azure full-stack development.

"Tool-portable" describes the packaging, not the subject matter. The same
skills load into several agent tools because they are shipped in each
tool's documented layout — but the guidance itself is **deliberately
Microsoft Azure-specific**, and is not intended to be neutral about which
cloud you are building on.

Everything in this pack is original, independently written material. No text
or logos are copied from Microsoft Learn, Microsoft documentation, or any
other Microsoft-owned source. "Microsoft" and "Azure" are trademarks of
Microsoft Corporation, used here only in truthful, subordinate, descriptive
wording (e.g. "for Microsoft Azure full-stack development") — this project
is independent and not affiliated with, sponsored by, or endorsed by
Microsoft. See [NOTICE](NOTICE) for the full attribution and trademark
disclaimer.

## What is and is not verified

This distinction is deliberate and is enforced by the tooling, not just by
prose:

| Claim | Status |
| --- | --- |
| The pack's file layout matches what each vendor's own documentation says it reads | **Checked by reading those documents on 2026-08-26** — see [COMPATIBILITY.md](COMPATIBILITY.md) for the per-tool table, dates and sources |
| An agent loads these files and follows them | **Pilot-observed in GitHub Copilot CLI only; not formally verified.** Claude Code remains unauthenticated and no protocol-complete benchmark exists |
| The guidance produces better outcomes than no pack | **Not established.** Development pilots were partial and mixed; [evals/RESULTS.md](evals/RESULTS.md) remains `NOT RUN` for formal results |
| Cited external sources are still current | Tracked in `sources.json`; `npm run freshness:check` reports status. Live checks currently report drift that has not been reviewed |

Every compatibility statement in this repository is therefore **format
compatibility only, behaviourally unverified**, and must be read that way.

### Which files each tool reads

The delivery API publishes only canonical tool names; the file locations
behind them live here and in [COMPATIBILITY.md](COMPATIBILITY.md), where
each row carries the date its vendor documentation was read.

| Tool | Files this pack ships for it | Behaviour |
| --- | --- | --- |
| GitHub Copilot | `.github/copilot-instructions.md`, `AGENTS.md`, `.github/instructions/`, `.github/skills/` | **Unverified** |
| Claude Code | `CLAUDE.md` (imports `@AGENTS.md`), `.claude/rules/`, `.claude/skills/` | **Unverified** |
| OpenAI Codex | `AGENTS.md`, `.agents/skills/` | **Unverified** |
| Gemini CLI | `GEMINI.md`, `.agents/skills/` | **Unverified** |

`manifest.json`'s `release.adapterSupport` lists exactly those four names
and nothing else: it is a statement that the pack *ships an adapter* for
each, not that any of them has been observed to follow it.
`release.formallyTestedWith` is empty and stays empty until a benchmark
exists.

## Skills

Nine skills are authored canonically under `.agents/skills/`, each as a
`SKILL.md` following the Agent Skills front-matter shape (`name`,
`description`, `license`, a `compatibility` string, flat `metadata`):

| Skill | Layer |
| --- | --- |
| `aspnetcore-endpoint-slice` | API |
| `react-vite-feature-slice` | Web |
| `efcore-azuresql-change` | Data |
| `bicep-infra-change` | Infrastructure |
| `entra-managed-identity-wiring` | Identity |
| `azure-appservice-deploy` | Hosting |
| `release-staging-to-production` | Release |
| `appinsights-telemetry-and-triage` | Observability |
| `secure-by-design-review` | Cross-cutting |

Each skill's `compatibility` string states what was and was not checked for
that skill, in its own words. None claims verified behaviour.

## Repository layout

| Path | Purpose |
| --- | --- |
| `AGENTS.md` | Canonical, tool-agnostic entry point agents should read first. |
| `.agents/skills/` | Canonical skill content: nine `SKILL.md` files plus their references. |
| `.github/copilot-instructions.md` | Generated adapter for GitHub Copilot. |
| `CLAUDE.md` | Generated adapter for Claude; imports `@AGENTS.md` explicitly, because Claude does not read `AGENTS.md`. |
| `GEMINI.md` | Generated adapter for Gemini. |
| `.github/skills/`, `.claude/skills/` | Generated physical mirrors of `.agents/skills/` (never symlinks, never hand-edited). |
| `.github/instructions/` | Path-scoped Copilot custom instructions. |
| `.claude/rules/` | Claude-specific rule files. |
| `references/` | Primary-source reference material backing the skills. |
| `examples/` | Worked examples that demonstrate skill guidance. |
| `evals/` | Evaluation harness, assertions and `RESULTS.md` — **never run**. |
| `scripts/` | Dependency-free Node 20 tooling; see [scripts/README.md](scripts/README.md). |
| `.mcp.json`, `.vscode/mcp.json` | MCP configuration declaring the Microsoft Learn endpoint (endpoint only; tool schemas are discovered at runtime). |
| `manifest.json` | Machine-readable summary of pack contents, status and release contract. |
| `sources.json`, `sources.schema.json` | Knowledge-supply-chain registry of external sources this pack cites, and its JSON Schema. |
| `COMPATIBILITY.md` | Per-tool format compatibility, with dates and sources; behaviour is "benchmark pending" everywhere. |
| `FRESHNESS.md` | Content freshness policy, review cadence and the no-autonomous-update rule. |
| `CHANGELOG.md` | Human-readable history, following Keep a Changelog. |
| `VERSION` | Single-line current version string. |

## Using the pack

Install into another project with the pack's own installer — a dry run by
default, which writes nothing until you pass `--write`:

```bash
node scripts/install.mjs --tool=claude --target=/path/to/project          # preview
node scripts/install.mjs --tool=claude --target=/path/to/project --write  # apply
```

`--tool` accepts `copilot`, `claude`, `codex` or `gemini`. Each run reports
every path it would touch, refuses to overwrite a differing file without
`--force`, and writes `.context-pack/` into the target with this pack's
`LICENSE`, `NOTICE` and an install receipt.

## Maintenance

| Command | What it does |
| --- | --- |
| `npm run generate` | Regenerates the adapters and skill mirrors from `AGENTS.md` + `.agents/skills/`. |
| `npm run check` | Fails if any generated file has drifted, then validates the pack. |
| `npm test` | Offline tests for the tooling. |
| `npm run validate` / `npm run validate:release` | Structure, claims and hygiene gates. |
| `npm run freshness:check` | Offline knowledge-registry checks; `:network` adds headers-only reachability and bounded version probes. |
| `npm run release:pre` | Local, non-publishable build into `dist/`. |

## Licensing

All original code and documentation in this repository is licensed under the
**MIT License** — see [LICENSE](LICENSE). One licence covers both code and
prose; there is no separate content licence. Third-party material is not
included; if it is ever deliberately added, its exact source, commit and
licence obligations must be recorded in [NOTICE](NOTICE) and `sources.json`
first, and those terms cover only that work.

## Roadmap

Done: the nine skills, their references and examples, the evaluation
harness, the generated adapters and mirrors, the MCP endpoint declaration,
and the generate/validate/install/release tooling with CI.

Not done, and required before a real release:

1. **Run the evaluation harness** and record actual results in
   `evals/RESULTS.md`. Until then no behavioural claim may be made, and
   `manifest.json`'s `release.formallyTestedWith` stays empty.
2. **Review the live freshness report.** Network checks currently report
   version drift and probe errors, so `manifest.json`'s `knowledge.*` fields
   are unset and `scripts/build-release.mjs` refuses to build a publishable
   release.
3. **Re-read the vendor documentation** behind each `COMPATIBILITY.md` row
   before treating any of it as current.

## Contributing

This is a pre-release. Issues describing gaps, inaccuracies or proposed
skill topics are welcome; please do not open pull requests that add
behavioural claims without a reproducible evaluation behind them.

# `references/`

Cross-skill synthesis for the Joshua Stewart Cloud Context Pack. Original,
independently written material — MIT licensed. No prose, code or logos are
reproduced from Microsoft Learn or any other third-party source.

## What belongs here

**Stable convention** that applies across more than one skill: layering,
naming, environment model, security positions, terminology, and the curated
index of primary sources.

## What does not belong here

**Volatile fact** — versions, service limits, quotas, SKUs, prices, api
versions, SDK signatures, role definition ids, portal UI paths. This pack
never asserts those. They are retrieved live at the moment they are needed,
per the live-doc policy in [`../AGENTS.md`](../AGENTS.md).

## Contents

| File | Purpose |
| --- | --- |
| [architecture.md](architecture.md) | The shape the pack assumes, layer responsibilities, trust boundaries, and why change ordering is fixed. |
| [conventions.md](conventions.md) | Repository shape, naming, per-language conventions, HTTP contract table, testing and review conventions. |
| [environments.md](environments.md) | Local/staging/production model, what must be identical, what may differ, isolation rules, configuration precedence. |
| [security-baseline.md](security-baseline.md) | The ten non-negotiable security positions, identity model, data handling, secret-incident response. |
| [glossary.md](glossary.md) | Terms as this pack uses them, so "drift", "promotion", "additive" and "verified" are unambiguous. |
| [links.md](links.md) | Link-only index of every primary source relied on, keyed to `../sources.json` ids and volatility tiers. |

## Precedence

When these files and a skill disagree on **process**, the skill is more
specific and wins for its task. When these files and the consuming
repository disagree on **fact**, the repository wins. When anything here and
live vendor documentation disagree on a **volatile fact**, the live
documentation wins — and the disagreement should be raised, not silently
patched.

## Maintaining

- Add any new external source to [`../sources.json`](../sources.json) first,
  then mirror it into [`links.md`](links.md) with the same id.
- Run `npm run freshness:check` after editing sources.
- Date any claim of verification, and mark anything unverified as
  unverified.

# `evals/`

A manual, reproducible protocol for asking one question honestly:

> Does this context pack make an agent measurably better at this work, and
> what does it cost?

Nothing in this directory has been run. There are no results here. See
[RESULTS.md](RESULTS.md).

## What is here

| File | What it is |
| --- | --- |
| [`evals.json`](evals.json) | The 16 cases: prompt, fixtures, expected artifacts, assertions, risk, mapped skills. |
| [`evals.schema.json`](evals.schema.json) | Strict schema for `evals.json`. |
| [`run.schema.json`](run.schema.json) | Strict schema for one run's record: timing, tokens, tool calls, judged verdicts, evidence. |
| [`benchmark.schema.json`](benchmark.schema.json) | Strict schema for the aggregate scorecard and launch gates. |
| [`fixtures/`](fixtures/) | Small synthetic workspaces, deliberately incomplete. |
| [`run.mjs`](run.mjs) | Dependency-free orchestration: `--prepare`, `--grade`, `--aggregate`, `--validate`. |
| [`ASSERTIONS.md`](ASSERTIONS.md) | What the mechanical checker may and may not do, and how the LLM judge is blinded. |
| [`RESULTS.md`](RESULTS.md) | The empty scorecard. Marked **NOT RUN**. |

`run.mjs` **never launches an agent.** It does not import
`node:child_process`. GitHub Copilot and Claude Code are driven by hand, by
you, and the tooling only prepares inputs and grades outputs. That is a
deliberate constraint: automating a proprietary agent CLI would make the
runs less reproducible, not more, because their versions and defaults move
without notice.

## The 16 cases

| # | Case | Category | Risk | Why it is in the suite |
| --- | --- | --- | --- | --- |
| 1 | `vertical-slice-react-api-ef` | implementation | medium | Half-finished slices look complete in review. |
| 2 | `ef-additive-schema-change` | data-safety | critical | Destructive migrations against a large table cause downtime or data loss. |
| 3 | `storage-managed-identity-no-keys` | security | critical | "Fixing" a key by moving it is not a fix. |
| 4 | `aspnetcore-rate-limiting` | resilience | high | A global limiter is an outage dressed as protection. |
| 5 | `appinsights-event-and-kql` | observability | medium | Telemetry and query that disagree produce a permanently empty dashboard. |
| 6 | `bicep-app-settings-and-rbac` | infrastructure | critical | Wrong scope grants standing access to data. |
| 7 | `distributed-trace-diagnosis` | diagnosis | high | The loudest span is not the expensive one. |
| 8 | `frontend-and-dotnet-tests` | testing | medium | Tests that encode assumptions are worse than none. |
| 9 | `develop-staging-production-promotion` | delivery | high | Rebuilding per environment ships an untested binary. |
| 10 | `build-failure-recovery` | diagnosis | medium | Suppressing a diagnostic converts a build error into a runtime defect. |
| 11 | `unsafe-query-and-api-key-review` | security | critical | Injection plus a checked-in credential, with invented findings as the failure mode. |
| 12 | `live-app-service-runtime-fact` | retrieval | high | A remembered platform fact reads as authoritative and is stale. |
| 13 | `reduced-motion-carousel` | accessibility | medium | Ignoring the preference harms users; removing animation for everyone is not a fix. |
| 14 | `convention-sensitive-refactor` | refactor | medium | Generic house style erodes the repository's own conventions. |
| 15 | `ambiguous-performance-request` | ambiguity | high | Confident answers to unmeasured questions waste sprints. |
| 16 | `kubernetes-out-of-scope-non-trigger` | non-trigger | medium | A pack that fires on everything is a net negative. |

Cases 15 and 16 exist to catch the pack being *harmful*. A suite made only
of cases the pack should win is marketing, not evaluation.

## Protocol

Read this section fully before the first run. The protocol is what makes
the numbers mean anything; skipping a step does not produce a weaker
result, it produces no result.

### 0. Definitions

- **Arm.** `with_pack` = fixture + pack context files. `without_pack` =
  the same fixture bytes, no pack context anywhere. Identical prompt,
  identical tool, identical model, identical clean-context rule.
- **Iteration.** One complete pass of **one tool** over the suite. Two runs
  per tool per case means two iterations for that tool. Four iterations
  covers two tools at two runs each.
- **Run.** One `iteration-N/<eval-id>/<arm>/` directory: one prompt, one
  fresh session, one transcript, one `run.json`, one `grade.json`.

### 1. Prepare

```
node evals/run.mjs --prepare --iteration=1
```

This creates `evals/runs/iteration-1/<eval-id>/{with_pack,without_pack}/`,
copies fixtures into `workspace/`, copies the pack context into the
`with_pack` workspace only, hashes everything into `fixture-manifest.json`
and `PACK-STATE.json`, assigns sealed blind labels, and writes a `run.json`
template with every measured field set to `null`.

Read the warnings it prints. If it says the pack has no authored skills, or
that `VERSION` disagrees with the suite, stop: any comparison you run will
be uninterpretable.

### 2. Clean context, every single time

A run is invalid unless **all** of these were true when you pasted the
prompt:

- A brand new session. Not a cleared one, not a `/new` in a session that
  has already loaded a repository. New.
- No prior turns, no carried-over memory, no custom instructions beyond the
  ones the arm is supposed to have.
- The agent opened on `workspace/` and nothing above it. It must not see
  `CASE.md`, `INSTRUCTIONS.md`, `run.json`, `PROMPT.txt`, this README, or
  any other repository on your machine.
- No other project open in the same window.

`run.json` records `tool.contextState` and `context.cleanContext`. Anything
other than `fresh-session` and `true` fails the evidence gate. That is
deliberate: an unclean run is not a slightly worse data point, it is not a
data point.

### 3. Randomise and blind

- Run the arms in **randomised order**. Do not do all `with_pack` runs
  first: your own attention, patience and machine state drift over a
  session, and that drift would land entirely on one arm.
- Randomise case order too, per iteration.
- `--prepare` writes `iteration-N/blinding/labels.json`, a sealed key
  mapping `A`/`B` to arms, derived deterministically from `--seed`. **Do
  not open it until every judged verdict and rubric score for the iteration
  is written down.**
- Ideally the person who ran a case is not the person who judges it. Where
  that is not possible, write every verdict down before opening the key,
  and record `judgeBlinded` honestly.
- Grading with `--export-blinded` copies each transcript to
  `blinding/<eval-id>/<label>.md`. Hand the judge those files only — not
  the directory that also contains `labels.json`, and never the
  `with_pack/` or `without_pack/` paths.

Blinding is imperfect. A `with_pack` transcript may reveal itself by
mentioning a skill, and the operator always knows which arm they ran.
Before handing work to a judge, strip or ignore any line that names the
pack, a skill slug, `AGENTS.md`, or an adapter file. Where a transcript
cannot be de-identified, record `judgeBlinded: false` in `run.json` rather
than claiming a blinding you did not achieve. See
[ASSERTIONS.md](ASSERTIONS.md) for the full LLM-judge rules.

### 4. Run

- Paste `PROMPT.txt` **verbatim**. No extra context, no rephrasing, no
  "you might want to look at…".
- Do not steer, correct, hint, or retry. If the agent goes wrong, that is
  the measurement.
- Do not answer clarifying questions unless the case's `promptNotes` says
  otherwise. Case 15 in particular measures whether the agent asks; answering
  destroys the case.
- One prompt, one turn set. If you used follow-up turns, record the count in
  `context.followUpTurnsUsed` and explain why in `context.notes`.

### 5. Capture time, tokens and tool calls

Record what the tool actually reports. Where it reports nothing, record
`"unavailable"`. Do not estimate silently, and do not infer token counts
from output length, pricing or duration.

| Measurement | How to capture | If the tool does not report it |
| --- | --- | --- |
| Wall clock | Start a timer when you submit the prompt, stop it when the agent stops producing output. Exclude your own reading time. | Not optional; you always have a clock. |
| Tokens | Whatever usage the tool prints at end of session, or its session export. Screenshot it into `evidence/` and reference it from `evidence.tokenReportPath`. | `measurements.tokens.source: "unavailable"`. The run still grades; it is excluded from the token gate. |
| Tool calls | Count the tool invocations the transcript shows, by name. | `measurements.toolCalls.source: "unavailable"`. |
| Retrieval calls | Count the calls that fetched something over the network. Required for case 12. | The live-retrieval case fails its evidence gate, which is correct. |

Token reporting for both tools is recorded as `unverified` in `evals.json`.
That is honest: this repository has not confirmed what either tool exposes.
Record what you see, not what you expect.

### 6. Grade on quoted evidence

```
node evals/run.mjs --grade --iteration=1 --export-blinded
```

Mechanical assertions run automatically. Judged assertions need one
`manualAssertions` entry each, containing:

- a `verdict` of `pass`, `fail` or `not-applicable` — there is no `partial`;
- at least one **verbatim quote** of 20 characters or more, with a
  `locator` (file and section, or transcript turn);
- `judge` (`human` or `llm-judge`) and `judgeBlinded`.

Rules that are not negotiable:

- **No benefit of the doubt.** If the evidence does not clearly show the
  behaviour, the verdict is `fail`. "It probably meant that" is a fail.
  "It would have worked if…" is a fail.
- **Paraphrase is not evidence.** Quote or fail.
- **Unevidenced rubric criteria score 0.** The grader enforces this.
- **An absent measurement is not a zero and not a pass.** It fails the
  evidence gate and the run is excluded from the comparison entirely,
  in both directions.
- **Review the trace, not just the artifact.** Read the whole transcript
  before scoring. A correct file produced by a chain of reasoning that
  invented a span, guessed a role name, or ignored the fixture is not a
  pass — several cases have an explicit assertion for exactly this.

The grader exits `1` whenever any requested run lacked evidence. That is
the fail-closed path working, not a bug.

### 7. Aggregate

```
node evals/run.mjs --aggregate --iteration=1 --iteration=2 --tool=github-copilot
```

Always pass `--tool` unless you genuinely want tools pooled. The output is
validated against `benchmark.schema.json` before it is written; anything
that cannot be computed from complete evidence is `null` and its gate is
`insufficient-data`, which is never treated as a pass.

## Launch gates

A pack that fails any of these is not ready to be recommended to anyone,
regardless of how good the headline number looks.

| Gate | Threshold | Why |
| --- | --- | --- |
| Lift | with_pack pass rate at least **25 percentage points** above baseline | Below that, the difference is not distinguishable from run-to-run variance at this sample size, and the pack is not worth the context it costs. |
| Correctness regressions | **zero** cases where the baseline was right and the pack arm was not | A pack that makes anything worse is not a net positive, whatever the mean says. |
| Security regressions | **zero** security-relevant checks the baseline passed and the pack arm failed | Same argument, with worse consequences. |
| Token cost | with_pack tokens no more than **1.5×** baseline | Context is not free. Beyond this the pack has to justify itself on more than accuracy. |
| Live retrieval | at least **80%** of live-retrieval cases retrieved and cited correctly, verified by a human opening the URL | A pack about a moving platform that answers from memory is actively dangerous. |
| Non-trigger | at least **80%** of non-trigger cases answered without pack bleed or quality loss | A pack that fires on everything degrades every unrelated task its user does. |

`launchReady` is true only when the benchmark's status is `complete` and
every blocking gate passes. One `insufficient-data` forces false.

## What this suite cannot tell you

- It cannot tell you the pack helps *your* work. Sixteen cases written by
  the pack's author is a conflict of interest that no tooling removes.
- It cannot tell you the code works. Nothing here compiles, runs or tests
  anything an agent produced.
- It cannot survive a model change. A result is a snapshot of one tool
  version and one model on one date.
- It cannot be read as statistics. Two runs per arm is enough to notice a
  large effect and nothing else. Do not compute a p-value from it.

Record those limits alongside any number you ever publish from this
directory.

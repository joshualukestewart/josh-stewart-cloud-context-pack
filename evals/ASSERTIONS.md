# Assertions: what the checker may do, and what it must not

This document is the contract for `evals/run.mjs --grade`. It exists so
that a reader can tell, without reading the code, exactly how much a
"pass" is worth.

## The boundary

The mechanical checker does four things and nothing else:

1. **Reads files** as UTF-8 text, from inside one prepared run's
   `workspace/` directory or from that run's `transcript.md`.
2. **Hashes files** with SHA-256 and compares the digest to the manifest
   recorded at prepare time.
3. **Matches regular expressions** against file text.
4. **Parses JSON** with `JSON.parse` to check a file is still valid JSON.

It does **not**:

- execute, import, evaluate, compile, transpile, lint or type-check
  anything an agent produced;
- start a process of any kind — `run.mjs` does not import
  `node:child_process`, and the fixtures deliberately have no lock files,
  no `node_modules`, no restore and no solution file, so there is nothing
  to build even by accident;
- touch the network;
- read or write anything outside the runs root it was given, and it refuses
  to delete a path that does not resolve inside that root;
- call a model, score anything with a model, or ask a model what it thinks
  of a diff.

This is a deliberate trade. Running the agent's output would tell us more,
and would mean this repository executes untrusted, model-generated code on
whatever machine an operator happens to use. The suite accepts weaker
evidence in exchange for a checker that cannot do harm. Every "pass" in
this suite therefore means *"the output has the shape the case requires"*,
never *"the output works"*.

## Assertion types

| Type | Reads | Passes when |
| --- | --- | --- |
| `file-exists` | directory listing | the path is present in the workspace |
| `file-absent` | directory listing | the path is not present |
| `file-matches` | one file | the regex matches its text |
| `file-not-matches` | one file | the regex does not match its text |
| `any-file-matches` | files matching a glob | at least one matches the regex |
| `no-file-matches` | files matching a glob | none matches the regex |
| `json-parses` | one file | `JSON.parse` succeeds |
| `file-unchanged` | one file + manifest | its SHA-256 equals the prepared baseline |
| `file-changed` | one file + manifest | its SHA-256 differs from the baseline |
| `max-changed-files` | manifest diff | at most N fixture files changed or were removed |
| `max-added-files` | manifest diff | at most N new files appeared |
| `manual` | `run.json` | a judge recorded `pass` with quoted evidence |

Globs support `**` (any depth), `*` (within one path segment) and `?`.
Regular expressions are JavaScript `RegExp` sources with optional
`i`/`m`/`s` flags, declared in `evals.json`.

`target: "transcript"` runs `file-matches` / `file-not-matches` against the
captured transcript instead of a workspace file. It is used for things only
the transcript can show, such as whether a skill activated on an
out-of-scope question.

## Severity

- **`blocking`** — a failure fails the case.
- **`advisory`** — a failure is recorded and reported but does not fail the
  case. Used where a competent agent could legitimately differ: an index
  strategy that depends on a database edition the fixture does not state,
  a cap expressed as `0.3` rather than `30`, a fix offered alongside an
  explanation that was all that was asked for.

Advisory checks are not decoration. They are how the suite records
restraint and thoroughness without punishing a defensible choice, and they
are reported separately in every `grade.json`.

## Things the checker excludes on purpose

- **Pack context files.** Everything copied into the `with_pack` workspace
  is listed in `PACK-STATE.json` and excluded from `any-file-matches`,
  `no-file-matches`, `max-changed-files` and `max-added-files`. Without
  this, the pack's own prose would trip content checks and the pack arm
  would look like it added twenty-odd files to every case.
- **Files larger than 2 MB.** They are not scanned. For `no-file-matches`
  this is treated as a **failure**, because absence cannot be proven from a
  file that was not read. For `any-file-matches` it is simply a miss.

## Known false positives and false negatives

Stating these is part of the contract. A checker whose weaknesses are
undocumented invites over-claiming.

**False negatives (the checker passes bad work):**

- Shape is not correctness. `AddRateLimiter` appearing in `Program.cs`
  says nothing about whether the limiter is wired to the right endpoints,
  which is why every such case also carries a judged assertion.
- A regex can be satisfied by a comment, a string literal, or a `TODO`
  that mentions the right word.
- `file-unchanged` proves bytes did not move, not that the surrounding
  change is coherent.

**False positives (the checker fails good work):**

- An agent that solves a case a different, valid way — a different property
  name, a different limiter shape, a different query formulation — can
  fail a pattern that anticipated only the common form. Where that risk is
  high the assertion is marked `advisory` and its `rationale` says so.
- Anchored patterns such as the file-scoped-namespace check are sensitive
  to formatting.

When a check is wrong, fix the check, bump `suiteVersion` in `evals.json`,
and treat earlier results as non-comparable. Do not quietly re-grade old
runs against new assertions.

## The evidence gate, and why it fails closed

Before any assertion result is allowed to count, `--grade` requires:

- `run.json` valid against `run.schema.json`;
- tool id, version, model, `contextState: "fresh-session"`, operator,
  start and end timestamps, wall-clock seconds, outcome status, and an
  explicit `source` for both token and tool-call counts (`"unavailable"` is
  an accepted, honest answer);
- `context.cleanContext === true`;
- a transcript with at least 200 captured characters below the template
  marker, and `evidence.transcriptCaptured === true`;
- one `manualAssertions` entry per judged assertion, each with a verdict
  and at least one quote of 20+ characters with a locator;
- a `rubricScores` entry per rubric criterion, with quoted evidence for any
  score above 0;
- `measurements.toolCalls.retrievalCalls` for live-retrieval cases.

If any of that is missing, the run is **ungraded**: `casePass` is false, and
the aggregator excludes it from both arms rather than counting it as a
failure. An ungraded run is missing data, not a bad result, and treating it
as either a pass or a fail would be a lie in one direction or the other.

`--grade` exits `1` when anything failed closed. That exit code means
"go and finish recording the evidence", not "the pack did badly".

## The judge

Judged assertions are the load-bearing ones. Most cases have blocking
manual assertions precisely because the interesting question — did it
reason from the evidence, or did it produce plausible shapes? — is not
mechanically decidable.

### Blinding rules

1. Judge from `iteration-N/blinding/<eval-id>/<label>.md`, produced by
   `--grade --export-blinded`. Never from `with_pack/` or `without_pack/`
   paths.
2. Do not open `iteration-N/blinding/labels.json` until every verdict and
   rubric score for the iteration is written down and saved.
3. Judge both labels for a case in the same sitting, in an order you did
   not choose deliberately, before moving to the next case.
4. Before handing a transcript to a judge, remove or ignore anything that
   identifies the arm: skill names, slugs, `AGENTS.md`, `CLAUDE.md`,
   adapter filenames, or a line where the agent announces it is loading
   pack guidance. If the transcript cannot be de-identified — which happens
   — record `judgeBlinded: false` and say so in `run.json.notes`. Do not
   claim a blinding you did not achieve.
5. `judgeBlinded: false` combined with `judge: "llm-judge"` fails the
   evidence gate. An unblinded model judge is not evidence.

### Rules for an LLM judge

- It sees exactly one labelled transcript plus the assertion text. It does
  not see the other arm's output, the arm names, the rubric weights, or
  any earlier verdict.
- It must quote before it concludes: every verdict requires a verbatim
  quote and a locator, and a verdict without one is recorded as missing.
- It is never asked "is this good?". It is asked the assertion's exact
  question, which is written to have a defensible answer.
- Its verdict is advisory to a human on any assertion marked
  `judge: "human"` — currently everything involving whether a cited fact,
  role name, resource type or span actually exists. Those require a person
  to open the page or the fixture and check. A model cannot verify a claim
  about the world by being asked more confidently.
- The same model family that produced the output should not be its sole
  judge on a case where the two arms disagree. Record which model judged in
  `manualAssertions[].notes`.

### Rules for a human judge

- Read the whole transcript before scoring, including the parts that look
  routine. Several cases hide their failure in the reasoning rather than
  the artifact.
- Score against the assertion as written, not against what you would have
  done.
- If you cannot find a quote, the verdict is `fail`. Not `partial`, not a
  benefit of the doubt.
- If you notice a harm no assertion covers, record it in
  `run.json.regressions` with a quote. The aggregator counts operator-
  reported correctness and security regressions in the launch gates
  alongside the derived ones.

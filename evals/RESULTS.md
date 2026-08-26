# Results

## Status: NOT RUN

**No protocol-complete benchmark has been executed or recorded in this
repository.** Small external development pilots exercised three of sixteen
cases at n=1 to debug the pack and harness. They produced mixed results, failed
release gates, and are deliberately not imported as benchmark evidence.

As of 2026-08-26:

- Zero formal run records are published in this repository.
- Zero `grade.json` files exist.
- Zero `benchmark-*.json` files exist.
- No number below has been measured, estimated, projected, or inferred.

### No public claims may be made

Until every cell in the scorecard below is filled from graded runs with
complete evidence, the following statements are all unsupported and must
not appear in a README, a release note, a post, a talk, a CV, or a
conversation with someone deciding whether to use this pack:

- that the pack improves agent output;
- that it improves it by any particular amount;
- that it is "evaluated", "benchmarked", "tested" or "validated";
- that it does not degrade unrelated work;
- that it costs a particular amount of context;
- that it is safe, safer, or production-ready.

The correct statement today is: *"An evaluation harness exists. Preliminary
development pilots are incomplete and non-claim; no formal benchmark result
has been published, so the pack's effect is not established."*

If a future version of this file contains numbers, it must also carry the
tool version, model, date, suite/pack version, iteration count and limitations that produced
them. A number without those is not a result.

## Scorecard (empty)

Populate from `evals/runs/benchmark-*.json`. One table per tool. Never
pool tools into a single headline figure.

### Tool: _not run_

- Tool version: _not run_
- Model and version observed: _not run_
- Dates of runs: _not run_
- Iterations included: _not run_
- Runs per case per arm: _not run_ (protocol minimum: 2)
- Pack version and commit: _not run_
- Suite version: _not run_ (copy from the generated benchmark)
- Operator: _not run_

| # | Case | with_pack pass | without_pack pass | Lift (pp) | Correctness reg. | Security reg. | Token ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `vertical-slice-react-api-ef` | — | — | — | — | — | — |
| 2 | `ef-additive-schema-change` | — | — | — | — | — | — |
| 3 | `storage-managed-identity-no-keys` | — | — | — | — | — | — |
| 4 | `aspnetcore-rate-limiting` | — | — | — | — | — | — |
| 5 | `appinsights-event-and-kql` | — | — | — | — | — | — |
| 6 | `bicep-app-settings-and-rbac` | — | — | — | — | — | — |
| 7 | `distributed-trace-diagnosis` | — | — | — | — | — | — |
| 8 | `frontend-and-dotnet-tests` | — | — | — | — | — | — |
| 9 | `develop-staging-production-promotion` | — | — | — | — | — | — |
| 10 | `build-failure-recovery` | — | — | — | — | — | — |
| 11 | `unsafe-query-and-api-key-review` | — | — | — | — | — | — |
| 12 | `live-app-service-runtime-fact` | — | — | — | — | — | — |
| 13 | `reduced-motion-carousel` | — | — | — | — | — | — |
| 14 | `convention-sensitive-refactor` | — | — | — | — | — | — |
| 15 | `ambiguous-performance-request` | — | — | — | — | — | — |
| 16 | `kubernetes-out-of-scope-non-trigger` | — | — | — | — | — | — |
| | **Pooled** | — | — | — | — | — | — |

### Launch gates

| Gate | Threshold | Observed | Verdict |
| --- | --- | --- | --- |
| Lift over baseline | >= 25 pp | — | insufficient-data |
| Correctness regressions | == 0 | — | insufficient-data |
| Security regressions | == 0 | — | insufficient-data |
| Token cost | <= 1.5x | — | insufficient-data |
| Live retrieval compliance | >= 80% | — | insufficient-data |
| Non-trigger compliance | >= 80% | — | insufficient-data |
| **Launch ready** | all gates pass | **no** | — |

`insufficient-data` is never a pass. `launchReady` is false while any gate
is unresolved.

### Cost and latency

| Measure | with_pack | without_pack | Ratio | Source |
| --- | --- | --- | --- | --- |
| Mean total tokens | — | — | — | — |
| Mean wall clock (s) | — | — | — | — |
| Mean tool calls | — | — | — | — |

GitHub Copilot CLI is the one release-gate tool and its token/tool-call
reporting was observed in a non-claim pilot. Other listed tools remain
optional and may be `unverified`. If a run records `"unavailable"`, that run is
excluded from the token gate rather than estimated into it.

## Limitations that will still apply when this file has numbers

These do not go away when the runs are done. They must travel with any
figure quoted from this directory.

1. **Author-written cases.** All 16 were written by the pack's author, who
   also wrote the pack. That is a conflict of interest no tooling removes.
   The mitigations are that the cases were written to be failable, that two
   of them exist to catch the pack being harmful, and that the fixtures and
   assertions are published so anyone can dispute them.
2. **Small n.** Two runs per case per arm detects a large effect and
   nothing else. It supports no confidence interval and no significance
   claim.
3. **Shape, not correctness.** Nothing compiles, runs or tests the agent's
   output. A "pass" means the output has the required shape and survived a
   judge, not that it works. See `ASSERTIONS.md`.
4. **Judged assertions dominate.** Most cases have blocking manual
   assertions. Blinding reduces judge bias; it does not remove it, and
   several transcripts cannot be fully de-identified.
5. **Moving models.** Agent behaviour is non-deterministic and model
   versions change without notice. Every result is a snapshot of one tool
   version and one model on one date, and stops being evidence shortly
   afterwards.
6. **Prompt sensitivity.** Each case is one phrasing of one task. A
   different phrasing could move the result in either direction.
7. **Synthetic fixtures.** They are small, clean and public-safe, which is
   what makes them shareable and also what makes them unlike the
   repositories this pack is meant for.
8. **One measured configuration.** Results say nothing about other IDEs,
   other agent harnesses, other model providers, or the pack loaded
   alongside other packs.
9. **The suite can be gamed.** Anyone, including the author, could write
   pack guidance that targets these regexes. `suiteVersion` and the
   requirement to treat changed assertions as non-comparable exist to make
   that visible; they do not make it impossible.

## How to fill this in

1. Run the protocol in `README.md`. Do not skip the clean-context,
   randomisation or blinding steps.
2. `node evals/run.mjs --aggregate --iteration=… --tool=…` per tool.
3. Copy figures from the generated `benchmark-*.json` — do not retype them
   from memory or round them by hand.
4. Add the tool version, model, dates, suite/pack version, iteration count and operator.
5. Copy the `limitations` array from the benchmark into this file verbatim.
6. Change **Status: NOT RUN** at the top, and state plainly what was and
   was not measured.

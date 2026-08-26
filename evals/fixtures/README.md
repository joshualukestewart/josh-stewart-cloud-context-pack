# `evals/fixtures/`

Small, synthetic, public-safe workspaces used by the evaluation suite.

## Rules these fixtures follow

- **Synthetic only.** Nothing here is copied from a real system, a customer,
  an employer, or a private repository. Names, references, values and log
  lines were invented for this repository.
- **No vendor prose.** No documentation text is reproduced from Microsoft
  Learn or any other copyrighted source. Where a case needs a current
  platform fact, the fixture asks the question and the agent must retrieve
  the answer live (see `live-fact-appservice/`).
- **No credentials.** The one credential-shaped string in these fixtures
  (`security-review/`) is the literal
  `demo-fixture-key-not-a-real-credential`, chosen so it is obviously
  synthetic, has never been valid anywhere, and is safe to publish. It
  exists because the case measures whether an agent recognises a
  checked-in credential.
- **Deliberately incomplete.** Fixtures stop exactly where the agent's work
  should begin. Missing endpoints, missing migrations, missing tests and
  missing role assignments are intentional. Do not "finish" a fixture: the
  gap *is* the eval.
- **Not runnable.** There are no lock files, no `node_modules`, no NuGet
  restore, no solution files and no build. `evals/run.mjs` never compiles or
  executes any of this, and neither should a grader. See `../ASSERTIONS.md`.
- **Byte-stable.** Several assertions are `file-unchanged` checks against a
  SHA-256 recorded at prepare time. Editing a fixture file changes those
  hashes and invalidates comparison with any earlier iteration. If a fixture
  must change, bump `suiteVersion` in `../evals.json` and treat prior results
  as non-comparable.

## Layout

One directory per eval case, named in `../evals.json` under
`cases[].fixtures[].source`. The directory's *contents* are copied into
`<iteration>/<eval-id>/<arm>/workspace/` by `run.mjs --prepare`; the
directory name itself does not appear in the workspace.

`TASK.md` inside a fixture is background context that both arms see. It is
not the prompt. The prompt lives in `../evals.json` and is written to
`PROMPT.txt` beside the workspace at prepare time, so the operator pastes
identical text into both arms.

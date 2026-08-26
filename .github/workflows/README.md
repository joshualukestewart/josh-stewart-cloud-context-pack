# `.github/workflows/`

GitHub Actions workflows for this repository. All three use only official
`actions/*` (and, for release publication, `azure/login`) pinned to a major
version, request the narrowest `permissions` that let them do their job, and
declare a `concurrency` group.

## Workflows

### `validate.yml` — every push and pull request

Read-only structural gate. Asserts the tooling is dependency-free, runs
`generate-adapters.mjs --check` (fails if any generated adapter or skill
mirror has drifted from `AGENTS.md` / `.agents/skills/`), the offline
tooling tests (`npm test`), `validate-pack.mjs` and the offline
`check-freshness.mjs`, then uploads the JSON validation report as an
artifact. A second, advisory job runs `validate-pack.mjs --release` and is
allowed to fail, so work in progress is never blocked by release-only gates
while still reporting whether the commit could be released today.
Permissions: `contents: read`.

### `release.yml` — version tags (`v*`) and manual dispatch

Three jobs, in order:

1. **build** — verifies the requested version matches `VERSION`, re-runs the
   drift and release-mode validations, builds `dist/` with
   `build-release.mjs`, checks `SHA256SUMS`, and uploads `dist/` as an
   artifact so every later job publishes exactly the bytes that were built.
2. **github-release** — attaches those artefacts to the GitHub release
   (`contents: write`, using the built-in `GITHUB_TOKEN`).
3. **publish** — signs in to Azure with **OIDC federation** (`id-token:
   write`; no client secret is stored anywhere), refuses to overwrite an
   existing versioned blob, uploads the archive, re-downloads it and
   compares its SHA-256 against the built hash, and only then writes
   `current.json`. The pointer is always written **last**, so a reader never
   sees a pointer to a blob that does not exist. Runs in the `release`
   environment, so approval plus environment-scoped secrets/variables apply.

Per current `azure/login` guidance, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and
`AZURE_SUBSCRIPTION_ID` are environment **secrets** even though they are
identifiers; this prevents untrusted workflow data from selecting the Azure
identity and lets the action mask the client ID. `PACK_STORAGE_ACCOUNT` and
`PACK_STORAGE_CONTAINER` remain environment variables. The federated identity
needs Storage Blob Data Contributor on the container; no Azure credential,
client secret or storage account key is stored.

Immutability of a published version rests on
`az storage blob upload --overwrite false` (plus the explicit existence
check before it). `current.json` is intentionally mutable and is replaced
with `--overwrite true`; there is no ETag-conditional guard on that write,
so overlapping publications are prevented by the `release-publication`
concurrency group (`cancel-in-progress: false`) rather than by the storage
service. Verify both assumptions before the first real publication.

### `freshness.yml` — scheduled knowledge-supply-chain check

Runs `check-freshness.mjs` weekly (and on demand) against `sources.json`,
and opens, comments on or closes a single labelled tracking issue. In
network mode it also runs any configured `versionProbe`, so a dependency
that has moved past its recorded `testedVersion` shows up as review
required (exit 2) rather than as a silent pass. Permissions:
`contents: read`, `issues: write`. It never writes to `manifest.json`,
`sources.json` or any other file — see the "no-autonomous-update rule" in
`FRESHNESS.md`.

## Candidate future workflows (not yet implemented)

- Markdown linting.
- Running the `evals/` harness once it exists.

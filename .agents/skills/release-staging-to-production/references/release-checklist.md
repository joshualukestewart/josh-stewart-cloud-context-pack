# Release checklist: develop → staging → main → production

Supporting file for the `release-staging-to-production` skill. Original
content, MIT licensed. Every "go/no-go" is a stop point: if the answer is no,
the release does not proceed.

**Topology assumed:** staging and production are two separate App Services on
one shared plan. There are no deployment slots and no swap — promotion means
deploying the staged artifact to the production app, and rollback means
redeploying the previous known-good artifact. If a consuming repository
really does use slots, this checklist does not apply as written; inspect that
repository and retrieve current slot semantics live.

## Stage 1 — merge to `develop`, deploy to staging

- [ ] PR reviewed and CI green on the merge commit.
- [ ] Any trust-boundary change has a completed security review.
- [ ] Database change is additive and has a reviewed idempotent script.
- [ ] Infrastructure `what-if` against the staging parameter file shows only
      intended changes.
- [ ] Staging deploy succeeded and the health endpoint returns success.
- [ ] The intended user journey works in staging.

**Go/no-go:** the artifact now running in staging is the exact artifact that
will be promoted. If it is not, stop.

## Stage 2 — pre-promotion gates

- [ ] Identify the promoted commit and artifact id explicitly.
- [ ] `git log --oneline <lastReleaseTag>..HEAD` reviewed — you can state
      what is shipping.
- [ ] `npm run freshness:check` exits `0`.
- [ ] Production parameter file `what-if` reviewed line by line; no
      unexpected delete or replace.
- [ ] The **production app's own settings** confirmed — they are not
      inherited from staging and nothing travels between the two apps.
- [ ] **Previous known-good commit and artifact id written down**, because
      rollback is a redeploy of that artifact and you cannot redeploy what
      you cannot identify.
- [ ] A named person is watching telemetry during and after the deploy.
- [ ] Release timing accounts for rollback taking a full deployment cycle,
      not seconds.

**Go/no-go:** if the rollback target is "we would have to work it out", stop.

## Stage 3 — production release, in order

1. [ ] Infrastructure deployed (if changed) and confirmed.
2. [ ] Migration applied from the reviewed idempotent script, using CI's own
       database identity.
3. [ ] Migration verified: schema present, previous application version still
       functioning.
4. [ ] Artifact deployed to the **production App Service** through the
       repository's existing deployment path.
5. [ ] Cold start absorbed — health path polled until it returns success.

**Go/no-go:** there is no warmed instance standing by, so do not start this
step without someone able to verify and, if needed, redeploy immediately.

## Stage 4 — post-release verification

Within the first minutes, and again after a stated window:

- [ ] Health endpoint on the production hostname returns success.
- [ ] One real end-to-end user journey completes.
- [ ] Error rate at or below the pre-release baseline.
- [ ] p95 latency at or below the pre-release baseline.
- [ ] No new exception type appearing in telemetry.
- [ ] Deployed build identifier matches the promoted commit, on the
      production app.

**Go/no-go:** if any of these fail, redeploy the previous known-good artifact
before investigating.

## Stage 5 — record

- [ ] Release record written: commit, artifact id, migration applied,
      infrastructure change, time, verifier, outcome.
- [ ] Previous known-good artifact id retained for the next release's
      rollback target.
- [ ] Any deferred destructive migration filed as a tracked follow-up with
      the release it belongs to.
- [ ] Any manual change made during the release captured back into Bicep the
      same day.
- [ ] Hotfixes back-merged to `develop`.

## Anti-patterns

- Rebuilding for production instead of promoting the staged artifact.
- Assuming a deployment slot exists, or that a swap is available as a fast
  rollback, without checking the plan tier.
- Deploying to production without recording the artifact you would roll back
  to.
- Applying migrations at application start-up.
- Combining an additive and a destructive migration in one release.
- Treating a successful deployment as a successful release.
- Fixing production by changing settings in the portal and not recording it.

---
name: release-staging-to-production
description: Promote a change through the branch flow develop to staging and main to production, where staging and production are two separate Azure App Services on one shared plan - release gates, artifact promotion, migration ordering, post-release verification and rollback by redeploying the previous known-good artifact. Use when the task mentions releasing, promoting, shipping, cutting a release, a rollback, a hotfix, a release gate, or the ordering of a database migration relative to a deployment.
license: MIT
compatibility: >-
  Guidance only - this skill ships no code. Assumes GitHub and Azure CLI
  access for verification. Written for the consuming repository's real
  topology - develop to a staging App Service and main to a production App
  Service, two separate apps on one shared plan, deployed through the
  repository's existing Kudu / Deployment Center path. That plan's SKU does
  not support deployment slots, so this skill does not use them. No release
  or rollback was performed. Retrieve volatile facts live per AGENTS.md.
metadata:
  pack: josh-stewart-cloud-context-pack
  owner: Joshua Stewart
  layer: release
  authored: "2026-08-26"
  checked-against: "Agent Skills specification, read 2026-08-26"
  target-stack: "GitHub branch flow develop to a staging App Service and main to a production App Service, two separate apps on one shared plan with no deployment slots, database schema changes applied by whichever mechanism the repository established"
  behaviour-verified: "none - no release or rollback was performed"
  volatile-facts: "deployment action inputs, Kudu behaviour and backup or restore windows are not asserted here, retrieve live"
---

# Release: staging to production

Production is reached only by promoting something that already ran in
staging. The release is not "done" when the deployment succeeds — it is done
when verification passes or the rollback completes.

## Topology this skill assumes

**Staging and production are two separate App Services on one shared App
Service plan.** There are no deployment slots and no swap: the plan's SKU
does not offer them. Promotion means *deploying the same artifact to the
second app*.

```
feature branch ──PR──► develop ──► staging App Service
                                        │  verified
                                        ▼
                              main ──► production App Service
```

| Branch | Target | Reached by |
| --- | --- | --- |
| feature branch | none | PR into `develop` |
| `develop` | the **staging App Service** | merge, then automatic deploy |
| `main` | the **production App Service** | promotion of the staged, verified artifact |

`main` takes no direct pushes. Deployment uses the repository's existing
Kudu / Deployment Center path — confirm what that actually is in the
consuming repository before changing anything about it.

> **If a consuming repository really does use deployment slots**, this
> skill's promotion and rollback steps do not apply as written. Inspect that
> repository's plan tier and slot configuration, and retrieve current slot
> and swap semantics live per the live-doc policy in `../../../AGENTS.md`.
> Never assume slots exist, and never assume swap behaviour from memory.

## Procedure

1. **Freeze the artifact.** Identify the exact commit and the build artifact
   that ran in staging. Promote *that*; do not rebuild for production.
2. **Check the gates** before promoting:
   - CI green on the promoted commit (build, tests, lint).
   - `npm run freshness:check` exit code `0` (see `../../../FRESHNESS.md`).
   - Security review complete for anything crossing a trust boundary
     (`secure-by-design-review`).
   - Infrastructure `what-if` against the production parameter file shows
     only intended changes (`bicep-infra-change`).
3. **Order the release correctly.** The usual safe order is:
   infrastructure → additive database schema change → application. Each step
   must leave the *currently running* production app working.
4. **Deploy infrastructure** if it changed, and confirm before proceeding.
5. **Apply the schema change as a release step**, from a reviewed idempotent
   script or bootstrap, using CI's own database identity — not the
   application's, and not at application start-up. The mechanism is whatever
   the repository already uses (`efcore-azuresql-change`).
6. **Deploy the artifact to the production App Service** through the
   repository's existing deployment path. Because there is no slot to warm,
   the app restarts into the new build directly: expect a brief cold start
   and verify immediately.
7. **Verify within the first minutes**: health endpoint on the production
   hostname, a real user journey, error rate and latency against the
   pre-release baseline (`appinsights-telemetry-and-triage`).
8. **Record the release**: commit, artifact, migration applied, time,
   verifier, and outcome.

The full sequence, with go/no-go points, is in
[references/release-checklist.md](references/release-checklist.md).

## Decision points

| Situation | Decision |
| --- | --- |
| Migration is destructive | Do not release it with the application change. Split: additive now, destructive in a later release once no running version depends on the old shape. |
| Staging and production configuration differ | Reconcile before releasing. An untested configuration is an untested release. Each app has its own settings — they do not travel between apps. |
| Release window is tight | Reduce scope, not verification. |
| Change is client-only | Still promote the same artifact; a client build is not exempt from the gates. |
| Something looks wrong after deploying to production | Redeploy the previous known-good artifact first, diagnose second. |
| Migration already applied and the app is rolled back | The additive rule is what makes this safe. If it was not additive, you now have an incident — route to `efcore-azuresql-change` and treat as data-risk. |
| Someone proposes adding a slot to speed this up | That is a plan-tier change, not a release change. Route to `bicep-infra-change` and price it deliberately; do not assume the current plan supports it. |

## Rollback

There is no swap to undo, so decide the rollback method *before* deploying.

| Change type | Rollback |
| --- | --- |
| Application code | **Redeploy the previous known-good commit/artifact to the production App Service.** This is why every release records its artifact id — you cannot roll back to something you cannot identify. |
| Infrastructure | Re-deploy the previous template revision with the same parameters, after a `what-if`. |
| Additive migration | Usually leave in place; the previous application version tolerates it by design. That compatibility is what makes an app-level rollback safe here. |
| Destructive migration | There is no clean rollback. This is why the additive rule exists. Restore from backup only as a last resort, with explicit sign-off. |

Rolling forward is preferable only when the fix is small, understood, and
already tested. Otherwise redeploy the last known-good artifact.

Because rollback is a redeploy rather than an instant swap, it takes as long
as a deployment. Budget for that when deciding whether to release close to a
busy period.

## Hotfix

1. Branch from `main`.
2. Smallest possible change; no opportunistic refactoring.
3. Deploy to staging and verify there first if at all possible — with no
   slot, production has no safety net.
4. Deploy to the production App Service, then verify.
5. Back-merge to `develop` the same day, or the fix will be lost by the next
   promotion.

## Verification

Before promoting:

```bash
git log --oneline <lastReleaseTag>..HEAD   # what is actually shipping
npm run freshness:check                    # exit code 0
```

After deploying to production:

- Health endpoint returns success from the production hostname.
- One real end-to-end user journey succeeds.
- Error rate and p95 latency are at or below the pre-release baseline over a
  stated window.
- The deployed build identifier matches the promoted commit.
- The release record is written.

## Failure handling

| Symptom | First action |
| --- | --- |
| Errors spike immediately after deploying | Redeploy the last known-good artifact. Diagnose from telemetry, not from the live site. |
| Deploy reported success but the old version is serving | Verify the build identifier and confirm which app received the artifact — staging and production are separate apps with similar names. |
| Migration fails partway | Stop the release. Do not deploy the application. Assess what the idempotent script actually applied before retrying. |
| Staging looks broken after a production release | Check which app you deployed to before assuming a fault. |
| Cannot identify what shipped | Stop releasing until artifact identity and release records are reliable. This is a process failure, not a deployment failure. |
| Cold start after deploy is user-visible | Expected without a warmed slot. Confirm the health path is polled and consider an always-on setting; do not fix it by inventing a slot. |

## Live retrieval required

Do **not** state from memory: App Service plan tiers and which features they
include, deployment action inputs and versions, Kudu deployment behaviour, or
Azure SQL backup and point-in-time restore windows. Retrieve live per the
live-doc policy in `../../../AGENTS.md`, using the App Service, GitHub
Actions and Azure SQL entries in `../../../references/links.md`.

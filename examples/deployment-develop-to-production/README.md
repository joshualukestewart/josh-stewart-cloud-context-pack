# Example: `develop` → staging app, `main` → production app

Illustrative deployment example for the Joshua Stewart Cloud Context Pack.
Original content, MIT licensed. Demonstrates `azure-appservice-deploy` and
`release-staging-to-production`.

The workflow file here is `deploy.example.yml`. It lives **outside**
`.github/workflows/` and is named `.example.yml` so it can never be picked up
and run. It parses as YAML; it has not been executed.

## Topology

**Staging and production are two separate App Services sharing one App
Service plan. There are no deployment slots and no swap** — the plan tier
does not include them. Promotion means deploying the same artifact to the
production app; rollback means redeploying the previous known-good artifact.

```
push to develop ─► build ─► deploy-staging
                              ├─ apply migration (CI identity, idempotent)
                              ├─ deploy artifact to the STAGING App Service
                              └─ verify /healthz (retrying through cold start)

push to main    ─► build ─► deploy-production   (environment: production, gated)
                              ├─ record the rollback target (last known-good SHA)
                              ├─ apply additive migration (CI identity, idempotent)
                              ├─ deploy the SAME artifact to the PRODUCTION App Service
                              ├─ verify /healthz on the production hostname
                              └─ on failure: redeploy the previous known-good artifact
```

> **If a consuming repository really does use deployment slots**, do not copy
> this shape. Inspect that repository's plan tier and slot configuration and
> retrieve current slot and swap semantics live — see
> `../../references/links.md`. Never assume slots exist or how a swap
> behaves.

> **Mechanism note.** This example illustrates a repository that uses EF
> migrations. The repository this pack was written for instead uses explicit
> idempotent dual-provider bootstrap DDL. The release *ordering* — schema
> change before application, from CI's own identity, never at start-up — is
> what transfers; the `dotnet ef` commands do not. See
> `efcore-azuresql-change`.

## What it demonstrates

1. **Build once, promote the same artifact.** One `build` job produces the
   API package and the client bundle. Both deploy jobs consume that same
   artifact. Nothing is rebuilt for production.
2. **No stored cloud credential.** Authentication is federated (OIDC):
   `permissions: id-token: write` plus client/tenant/subscription
   identifiers stored as GitHub environment secrets per current
   `azure/login` guidance — but no Azure credential, client secret or publish
   profile.
3. **Branch-driven, app-targeted environments.** `develop` deploys to the
   staging app; `main` deploys to the production app. They are different
   `app-name` values, and neither job can target the other's resources.
4. **Migration before application, from CI's own identity.** The migration
   runs as a release step from a reviewed idempotent script — not at
   application start-up.
5. **Rollback target recorded before deploying.** Without a slot to swap
   back to, the only rollback is redeploying a specific prior artifact, so
   its identity is captured up front.
6. **Verification is part of the release.** The release is not complete when
   the deployment step succeeds; it is complete when the health check and
   smoke test pass — and the health check retries, because the app restarts
   into the new build with no pre-warmed instance.

## Deliberate choices worth copying

| Choice | Why |
| --- | --- |
| `permissions:` declared explicitly at job level | Default-write tokens are a standing risk; least privilege is the baseline. |
| Migration script generated in `build`, applied in `deploy` | The script is reviewable as a build artifact before it touches a database. |
| `--idempotent` script | The release step can be retried without corrupting state. |
| Additive-only migrations | They are what makes redeploying the previous artifact a safe rollback. |
| "Record rollback target" step before any change | You cannot redeploy an artifact you cannot identify. |
| `--retry` on the health check | The app is cold immediately after deploy; a single probe would produce false failures. |
| Concurrency group per environment | Two releases cannot interleave on the same app. |
| `environment:` on the production job | Gives GitHub a place to enforce approvals and environment-scoped values. |

## Deliberate omissions

Not shown, because they are repository-specific or volatile: caching, matrix
builds, test reporting, artifact retention, notification steps, action
version pinning policy, and the exact inputs of the deployment actions.
Retrieve current action inputs live — see `../../references/links.md`.

Note also that the real repository this pack describes deploys through an
existing Kudu / Deployment Center path. This example uses a deployment action
to keep the illustration self-contained; confirm the actual mechanism in the
consuming repository before changing anything about it.

## Anti-patterns this example avoids

- Rebuilding for production instead of promoting the staged artifact.
- Assuming a deployment slot exists, or that a swap is available as an
  instant rollback, without checking the plan tier.
- Deploying to production without recording what to roll back to.
- Deploying with a publish profile or a stored service principal secret.
- Applying migrations at application start-up.
- Treating a green deployment step as a successful release.

## Verify

```bash
python -c "import yaml; yaml.safe_load(open('deploy.example.yml'))"
```

Verified parsing cleanly on 2026-08-26 with Python 3.12.10. That confirms
YAML validity only — not that the workflow is correct, current, or runnable.

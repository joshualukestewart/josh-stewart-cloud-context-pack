---
name: azure-appservice-deploy
description: Configure and deploy the React/Vite web client and ASP.NET Core API to Azure App Service - app settings, health checks, publish artifacts, SPA routing and startup diagnostics - across separate staging and production App Services on one shared plan, without storing secrets or deploying from a developer machine. Use when the task mentions App Service, a web app, app settings or configuration, a publish or deployment failure, a start-up or container failure, or a site that works locally but not when deployed.
license: MIT
compatibility: >-
  Guidance only - this skill ships no code. Assumes Azure CLI access for
  verification. Written for the consuming repository's real topology - a
  staging and a production App Service on one shared plan whose SKU does not
  support deployment slots - hosting an API targeting net9.0 on runtime
  9.0.19 and a Vite 8.1.0 client, confirmed 2026-08-26. Nothing was deployed.
  SKUs, runtime versions and setting names are not asserted - retrieve them
  live per the AGENTS.md live-doc policy.
metadata:
  pack: josh-stewart-cloud-context-pack
  owner: Joshua Stewart
  layer: hosting
  authored: "2026-08-26"
  checked-against: "Agent Skills specification, read 2026-08-26"
  target-stack: "separate staging and production App Services on one shared plan with no deployment slots, hosting an ASP.NET Core API targeting net9.0 on runtime 9.0.19 and a Vite 8.1.0 client (confirmed in the consuming repository on 2026-08-26)"
  behaviour-verified: "none - nothing was deployed, the example workflow parses as YAML but was never executed"
  volatile-facts: "plan SKUs and their feature sets, runtime stack versions and setting names are not asserted here, retrieve live"
---

# Azure App Service deployment

Deploy a built artifact, configure it from infrastructure, and prove it is
healthy before any traffic depends on it.

## Topology this skill assumes

**Staging and production are two separate App Services sharing one App
Service plan.** There are no deployment slots — the plan's SKU does not
include them — so each environment is reached by deploying to its own app.
Deployment goes through the repository's existing Kudu / Deployment Center
path.

Two consequences that shape everything below:

1. **There is no warm-then-swap step.** Deploying restarts the target app
   into the new build, so verification happens *after* the app is live and a
   cold start is user-visible.
2. **Settings do not travel between apps.** Each App Service has its own
   configuration. Nothing is "slot-specific" because nothing swaps; instead,
   confirm each app's settings independently.

> **If a consuming repository really does use deployment slots**, the
> guidance here about no-warm-up and per-app settings does not apply as
> written. Inspect that repository's plan tier and slot configuration and
> retrieve current slot and swap semantics live per the live-doc policy in
> `../../../AGENTS.md`. Never assume slots exist or how a swap behaves.

## Before you start

Confirm from the consuming repository:

- Whether the web client is served by the API, by its own App Service, or by
  a static host. The SPA-routing step only applies where App Service serves
  the client.
- Which App Services and plan already exist, and which are managed by Bicep.
  Route to `bicep-infra-change` for anything not in the template.
- How deployment is actually triggered today.

## Procedure

1. **Build once, deploy many.** Produce a single artifact per commit and
   promote that same artifact between environments. Never rebuild per
   environment.
   ```bash
   dotnet publish -c Release -o ./publish
   npm ci && npm run build
   ```
2. **Deploy from CI, authenticated by OIDC.** No publish profile, no
   deployment credential, no developer-machine deployment to a shared
   environment. Route to `entra-managed-identity-wiring`.
3. **Configure through app settings supplied by Bicep**, per app. Anything an
   operator would otherwise set in the portal belongs in the template.
   Secrets are Key Vault references or, better, absent because access is
   identity-based.
4. **Separate build-time from run-time configuration.** Vite inlines
   `VITE_`-prefixed values at build time, so a per-environment client value
   requires either a per-environment build or a runtime-fetched config
   endpoint. Decide deliberately and document which you chose.
5. **Enable a health check path** that verifies the app can actually serve —
   including its critical dependency — and is cheap enough to be polled.
   Return a non-200 when unhealthy; a health endpoint that always returns 200
   is worse than none.
6. **Handle SPA deep links** where App Service serves the client: unmatched
   routes must fall back to `index.html`, while API paths and static assets
   must not.
7. **Deploy to staging first, verify there, then deploy the same artifact to
   production.** Promotion mechanics belong to
   `release-staging-to-production`.
8. **Confirm the deployed instance is the expected build** before declaring
   success — compare a version endpoint or build id, not the timestamp.

## Decision points

| Situation | Decision |
| --- | --- |
| Settings differ between staging and production | Expected — they are separate apps. Keep both in Bicep so the difference is reviewable, and check the *production* app's settings explicitly before releasing. |
| Client needs an environment-specific API URL | Prefer a same-origin relative path. If cross-origin, choose per-environment build or runtime config — never detect by hostname. |
| Deployment is slow | Deploy a compressed, pre-built package rather than building on the host. |
| App needs a file on disk | Treat the filesystem as ephemeral. Persist to storage or the database. |
| Cold start after deploy matters | Without a slot there is no pre-warmed instance. Consider an always-on setting and ensure the health path is polled; do not assume a slot is available to fix it. |
| Someone suggests adding a slot | That is a plan-tier decision with a cost, not a deployment tweak. Route to `bicep-infra-change`. |
| A setting was changed in the portal to fix an incident | Record it, then move it into Bicep the same working day, or the next deployment will silently revert it. |

## Verification

```bash
az webapp show     -g <rg> -n <app> --query "{state:state,https:httpsOnly}"
az webapp config appsettings list -g <rg> -n <app> -o table
az webapp log tail -g <rg> -n <app>
curl -fsS https://<app>.azurewebsites.net/healthz
```

Run these against **each** app; staging and production are configured
independently.

Then check by hand:

- HTTPS-only is on and the minimum TLS version matches the security baseline
  (`../../../references/security-baseline.md`).
- No app setting contains a literal secret.
- A deep link into a client route loads (not a 404) and an unknown API path
  still returns the API's 404, not `index.html`.
- The health endpoint fails when its dependency is unavailable.
- The deployed build identifier matches the commit you intended, on the app
  you intended.

## Failure handling

| Symptom | First action |
| --- | --- |
| Site returns 5xx immediately after deploy | Read the platform/start-up log before changing anything. Most cases are a missing app setting or a start-up exception, not a platform fault. |
| Deploy succeeds, old content still served | The artifact went to the other app, or the build was not included in the package. Verify the artifact contents and which app name you targeted. |
| Deep links 404, root works | SPA fallback is missing or is also swallowing API routes. Fix the fallback rule ordering. |
| Works in staging, fails in production | Compare the two apps' settings and role assignments directly — nothing is shared between them automatically. |
| Intermittent 502/503 under load | Look at instance count, health check failures and dependency latency together — route to `appinsights-telemetry-and-triage` before scaling up. Remember both environments share one plan, so staging load can affect production. |
| Cannot reproduce locally | Compare configuration, not code: dump the effective app settings and the deployed build id first. |

## Live retrieval required

Do **not** state from memory: App Service plan SKUs, their limits, or which
features (including deployment slots) each tier includes; supported runtime
stack versions and their end-of-support dates; or current app-setting and
configuration key names. Retrieve live per the live-doc policy in
`../../../AGENTS.md`, using the App Service entries in
`../../../references/links.md`.

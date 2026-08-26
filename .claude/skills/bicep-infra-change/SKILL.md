---
name: bicep-infra-change
description: Add or change Azure infrastructure declaratively in Bicep - resources, modules, parameters, outputs and role assignments - then preview it with what-if and deploy it per environment without introducing secrets or portal drift. Use when the task mentions Bicep, an ARM template, provisioning or reconfiguring an Azure resource, a resource group deployment, infrastructure parameters, or an RBAC role assignment in infrastructure code.
license: MIT
compatibility: >-
  Guidance only - this skill ships no code. Assumes the Bicep CLI and Azure
  CLI are available for verification. Bicep CLI 0.44.1 compiled and linted
  examples/bicep-managed-identity on 2026-08-26; the latest release that day
  was 0.46.1, so that toolchain is behind. No deployment or what-if has been
  run. api versions, SKUs and role ids are not asserted - retrieve them live
  per the AGENTS.md live-doc policy.
metadata:
  pack: josh-stewart-cloud-context-pack
  owner: Joshua Stewart
  layer: infrastructure
  authored: "2026-08-26"
  checked-against: "Agent Skills specification, read 2026-08-26"
  target-stack: "Bicep on Azure Resource Manager, verified with Bicep CLI 0.44.1 (latest release on 2026-08-26 was 0.46.1, so this toolchain is behind)"
  behaviour-verified: "examples/bicep-managed-identity builds and lints clean; no deployment or what-if has been run against a subscription"
  volatile-facts: "api versions, SKUs, role definition ids and linter rule names are not asserted here, retrieve live"
---

# Bicep infrastructure change

Infrastructure is code. If it was not deployed from a file in the
repository, it is drift and it will be lost.

## Before you start

Confirm from the consuming repository:

- The entry template (commonly `infra/main.bicep`), the module layout, and
  the per-environment parameter files.
- The deployment scope (resource group vs subscription) — it determines
  what a module may declare.
- Which resources already exist and are *not* managed by this template.
  Deploying over an unmanaged resource can silently reset its settings.

## Procedure

1. **Work in modules.** One module per logical resource group of concerns
   (web app, database, monitoring, identity). The entry template wires
   modules together and owns naming.
2. **Parameterise environment, never behaviour.** Parameters carry
   environment name, location, sizing and existing-resource references.
   Branching logic that changes *what* is deployed between environments is
   a smell — prefer the same shape with different parameters.
3. **Derive names deterministically** from a prefix plus environment plus a
   uniqueness token, and emit them as outputs. Do not hardcode a name that
   must be globally unique.
4. **Declare no secrets.** No `@secure()` parameter carrying a password you
   invented, no keys in outputs, no connection strings. Identity-based
   access instead — see `entra-managed-identity-wiring`. If a secret is
   genuinely unavoidable, it lives in Key Vault and is referenced, never
   materialised into a parameter file.
5. **Express access as role assignments** on the narrowest scope that
   works, using a role definition id resolved at deploy time rather than a
   copied GUID literal where the template can look it up.
6. **Never output a secret.** Outputs are recorded in deployment history and
   are readable by anyone with reader access to the deployment.
7. **Preview before deploying.**
   ```bash
   az deployment group what-if -g <rg> -f infra/main.bicep -p @infra/<env>.bicepparam
   ```
   Read every `~` (modify) and `-` (delete) line. An unexpected delete is a
   stop-the-line event.
8. **Deploy lowest environment first**, confirm, then promote the same
   template with different parameters.

## Decision points

| Situation | Decision |
| --- | --- |
| Someone changed a setting in the portal | Reproduce it in Bicep and redeploy. Do not "leave it in the portal for now". |
| what-if shows a delete or replace | Stop. Understand why. A replaced database or App Service means data/config loss. |
| Resource already exists outside the template | Reference it with an `existing` declaration, or adopt it deliberately after checking what the template would overwrite. |
| A value is needed by the app at runtime | Pass it as an app setting from the template output. Do not have the app read infrastructure state. |
| Template is getting long | Extract a module. Aim for a template a reviewer can read in one sitting. |
| Change affects production only | Do not add a production-only branch. Add a parameter and set it per environment. |

## Verification

```bash
bicep build infra/main.bicep --stdout      # compiles; surfaces linter output
bicep lint  infra/main.bicep
az deployment group what-if -g <rg> -f infra/main.bicep -p @infra/<env>.bicepparam
```

A minimal, compilable, secret-free reference template lives at
`../../../examples/bicep-managed-identity/main.bicep`.

Then check by hand:

- `bicep build` output has no warnings you have not consciously accepted.
- No `output` returns a key, password, token or connection string.
- Role assignments name the least-privileged role that satisfies the need.
- Parameter files contain no credential and no tenant/subscription id that
  should not be in source control.
- what-if for the *production* parameter file shows only the intended
  changes.

## Failure handling

| Symptom | First action |
| --- | --- |
| Deployment fails on an `apiVersion` | Retrieve the currently supported api versions live; do not guess by incrementing a date. |
| `RoleAssignmentExists` / conflicting assignment | The assignment name must be deterministic per (scope, principal, role). Use a `guid()` over those three, not a random value. |
| Principal id is empty at deploy time | The identity resource has not been created yet in the dependency order, or the wrong output is referenced. Fix ordering, do not hardcode the id. |
| what-if shows churn on every run | Usually a property the service normalises. Confirm, then either match the normalised value or accept the noise explicitly in the PR. |
| Deployment succeeds but the app misbehaves | Compare deployed app settings against the template's intent; a manual portal setting may have been overwritten as designed. |
| Template deploys to the wrong scope | Check the `targetScope` and the CLI command used (`group` vs `sub`); do not "fix" it by widening permissions. |

## Live retrieval required

Do **not** state from memory: resource `apiVersion` values, available SKUs
and their limits, region availability, quota ceilings, built-in RBAC role
definition IDs, or current Bicep linter rule names. Retrieve live per the
live-doc policy in `../../../AGENTS.md`, using the Bicep and Azure RBAC
entries in `../../../references/links.md`. Skill-specific review items are
in [references/review-checklist.md](references/review-checklist.md).

---
name: entra-managed-identity-wiring
description: Wire an application or CI pipeline to Azure resources using Microsoft Entra ID identities instead of secrets - system- or user-assigned managed identity, least-privilege role assignments, database principals, and federated credentials for GitHub Actions OIDC. Use when the task mentions managed identity, DefaultAzureCredential, passwordless authentication, a role assignment, service principal, federated credential, OIDC login from CI, or an authentication or authorization failure against an Azure resource.
license: MIT
compatibility: >-
  Guidance only - this skill ships no code. Assumes Azure CLI access for
  verification. Written for Microsoft Entra ID managed identities and GitHub
  Actions OIDC federation. No identity, role assignment or federated
  credential was created or tested. No agent benchmark has been run. Role
  ids, credential chain order and subject claim formats are not asserted -
  retrieve them live per the AGENTS.md live-doc policy.
metadata:
  pack: josh-stewart-cloud-context-pack
  owner: Joshua Stewart
  layer: identity
  authored: "2026-08-26"
  checked-against: "Agent Skills specification, read 2026-08-26"
  target-stack: "Microsoft Entra ID managed identities and GitHub Actions OIDC federation"
  behaviour-verified: "none - no identity, role assignment or federated credential was created or tested"
  volatile-facts: "role definition ids, credential chain order and subject claim formats are not asserted here, retrieve live"
---

# Entra ID and managed identity wiring

The target posture is zero stored credentials: the application proves who
it is with a platform-issued identity, and CI proves who it is with a
federated token. Anything else is an exception that needs justification.

## Before you start

Establish, in order:

1. **Who** needs access — a staging or production App Service, a job, or CI.
2. **To what** — Azure SQL, Key Vault, Storage, Application Insights.
3. **For what operation** — read, write, manage. This selects the role.
4. **In which environment** — staging and production get separate
   identities and separate assignments.

Staging and production are **separate App Services**, so each has its own
principal. Never assume one assignment covers both. (If a consuming
repository uses deployment slots instead, a slot also presents its own
principal — inspect that repository and retrieve current slot identity
semantics live rather than assuming.)

## Procedure

1. **Choose the identity type.**
   - *System-assigned*: lifecycle tied to the resource; simplest; the
     default choice for a single app that only needs its own access.
   - *User-assigned*: shared across resources, survives resource
     recreation, and can be granted access *before* the consuming resource
     exists. Choose this when a database principal or role assignment must
     be created ahead of deployment.
2. **Declare it in Bicep**, not the portal. Route to `bicep-infra-change`.
3. **Assign the least-privileged role at the narrowest scope.** Prefer a
   data-plane role over a management-plane role; prefer resource scope over
   resource group over subscription. Make the reasoning explicit: list the
   operations the workload performs, verify the candidate role's current
   data actions live, explain why a narrower role cannot perform those
   operations, and explain why the next broader role is unnecessary. The
   deliverable must name the role, scope and this justification together.
   Use one authoritative verification (prefer a direct
   `az role definition list --name <role>` query when available); once the
   required data actions are established, stop rather than collecting
   redundant pages or role catalogues. In the final answer, keep four facts
   separate: the workload's required operations; the selected role's relevant
   permissions (including extras); the closest narrower role and the required
   operation it cannot perform; and the next broader role and the permission
   that makes it unnecessary. Never say a role's permissions match "exactly"
   unless the retrieved permission set actually equals the required set.
4. **Create the corresponding principal in the data store.** For Azure SQL,
   an Azure role assignment alone is not enough — the identity also needs a
   database user and role membership. Grant the minimum, and never `db_owner`
   for ordinary application access.
5. **Acquire tokens with the standard credential chain** in the
   application. Do not construct tokens by hand. In a multi-identity
   environment, pass the intended client id explicitly rather than relying
   on chain order.
6. **For CI, use workload identity federation (OIDC)** — a federated
   credential scoped to the specific repository, and to the specific branch
   or environment, with no client secret stored anywhere.
7. **Separate environments.** Staging credentials must not be able to reach
   production resources. Verify by attempting a staging-to-production call
   and confirming it fails.

## Decision points

| Situation | Decision |
| --- | --- |
| Role assignment must exist before the app is deployed | Use a user-assigned identity. |
| Multiple identities on one resource | Specify the client id explicitly in the credential configuration; ambiguous chains fail unpredictably. |
| A key or connection string is "just easier" | Not acceptable. Route to `secure-by-design-review` if you believe an exception is warranted. |
| Needed role does not exist as a built-in | Prefer composing built-ins; only define a custom role with a recorded justification. |
| Local development cannot use managed identity | Developers authenticate as themselves through the credential chain; grant a developer group the same least-privilege role. Do not add a shared secret for local use. |
| CI needs to run migrations | Give CI its own identity and its own database role — not the application's identity. |

## Verification

```bash
az webapp identity show -g <rg> -n <app>          # identity exists, note principalId
az role assignment list --assignee <principalId> -o table
az role assignment list --scope <resourceId> -o table
```

Then check by hand:

- No client secret or key exists for this scenario anywhere in the repo,
  app settings, or CI variables.
- Every assignment's role and scope is the narrowest that works; there is
  no leftover broad assignment from experimentation. The review evidence
  states the required operations and why the selected role is narrower than
  the rejected alternatives.
- The database has a principal for the identity with a minimal role.
- The CI federated credential is scoped to this repository *and* the
  intended branch/environment, not to a wildcard.
- Removing the identity's assignment causes the expected failure — proving
  the assignment is actually what grants access.

## Failure handling

| Symptom | First action |
| --- | --- |
| Token acquired but the resource returns 403 | Authentication succeeded, authorization did not. Check the role and the *scope*, not the identity. |
| Works after a delay, fails immediately after deployment | Role assignment and identity replication are eventually consistent. Retry with backoff; do not widen the role to "fix" it. |
| Credential chain picks the wrong identity | Specify the client id explicitly; do not remove other identities as a workaround. |
| Login failed for the app in Azure SQL | Azure role assignment exists but the database principal does not. Create the database user and role membership. |
| CI OIDC login fails with a subject mismatch | The federated credential's subject does not match the workflow's actual claim (branch vs environment vs pull request). Correct the credential; never fall back to a stored secret. |
| Access works in staging but not production | They are separate App Services with separate principals. Check the production app's own assignments rather than copying staging's. |

## Live retrieval required

Do **not** state from memory: built-in role definition IDs or their exact
permission sets, credential-chain ordering and environment variable names,
federated credential subject claim formats, or token lifetime and caching
behaviour. Retrieve live per the live-doc policy in `../../../AGENTS.md`,
using the Entra, managed identity and Azure SQL authentication entries in
`../../../references/links.md`.

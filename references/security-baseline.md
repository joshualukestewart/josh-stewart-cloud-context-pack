# Security baseline

Original synthesis for the Joshua Stewart Cloud Context Pack. These are the
*stable* security positions this pack assumes. They are deliberately
opinionated and deliberately version-free.

**Not recorded here, because volatile:** current advisory status for any
package, service security defaults, TLS/cipher policy specifics, built-in
role permission sets, compliance control mappings, and any limit or
threshold Microsoft may change. Retrieve those live — see
[`links.md`](links.md) and the live-doc policy in `../AGENTS.md`.

The reviewing procedure lives in the `secure-by-design-review` skill; this
file is the standard that procedure measures against.

## Non-negotiables

1. **No stored credentials for Azure access.** The application uses a
   managed identity; CI uses workload identity federation (OIDC). A
   password, key, connection string with credentials, publish profile, or
   client secret in this system is a defect, not a configuration choice.
2. **Least privilege, narrowest scope.** Prefer a data-plane role over a
   management-plane role, resource scope over resource group, resource group
   over subscription. Database identities never get ownership-level roles.
3. **Default deny.** Every endpoint is authenticated unless anonymity is a
   written, reviewed decision. Every anonymous endpoint has reduced response
   detail and a rate limit.
4. **Authorize the object, not just the session.** "Is this caller logged
   in" is not authorization. "May this caller act on this record" is.
5. **Untrusted input is validated server-side at entry** for type, range,
   length and allowed values. Client-side validation is a usability
   feature, never a control.
6. **Never leak internals.** No stack traces, SQL text, internal hostnames,
   resource ids or upstream error bodies in a response. Return a correlation
   id; keep the detail in telemetry.
7. **No secrets or personal data in logs, telemetry, examples, tests,
   fixtures, or this pack's own prose.**
8. **Anything shipped to the browser is public.** Every `VITE_`-prefixed
   value, every bundled string, every client-side flag.
9. **Encryption in transit and at rest is on and not weakened.** HTTPS-only,
   no downgrade to satisfy a client.
10. **Environments are isolated.** Staging credentials cannot reach
    production. Production data does not flow downward without an approved,
    minimised process.

## Identity model

| Actor | Credential | Granted |
| --- | --- | --- |
| Web client (browser) | The end user's token, obtained via the API's auth flow | Nothing directly in Azure |
| API | Managed identity (system- or user-assigned) | Least-privilege data-plane roles on the resources it uses |
| CI/CD | Federated credential scoped to repo + branch/environment | Deployment rights for that environment only |
| Developer (local) | Their own identity via the standard credential chain | Same least-privilege role, via a group |
| Schema change runner | CI's own database identity | Schema rights, separate from the application's identity |

The application's runtime identity should not be able to change its own
schema, and CI's identity should not be needed to serve a request.

## Data handling

- Classify before controlling: know what the data is before choosing
  protections.
- Minimise: do not collect, return, log or retain more than the operation
  needs.
- Project to DTOs; never return an entity, which leaks schema and invites
  over-posting.
- Bound every list, search and export.
- Personal data is excluded from telemetry and from error messages.

## Secret incidents

If a secret reaches source control, CI logs, telemetry, or a shared
transcript:

1. **Rotate it first.** Deleting the file does not un-expose it.
2. Assess what it could reach and for how long.
3. Remove it from the working tree and from history if feasible.
4. Replace the pattern with an identity-based approach so the same secret
   cannot recur.
5. Record the incident and the rotation date.

## CI/CD posture

- No long-lived cloud credential in repository or organisation secrets.
- Federated credential subject is scoped to a specific branch or
  environment — never a wildcard.
- Workflow permissions are least-privilege, not default-write.
- Deployments to shared environments come from CI, never a developer
  machine.
- Lockfiles committed; installs deterministic.

## Dependency posture

- Every new dependency is justified against what is already installed.
- Publisher and maintenance status checked at the time of addition.
- Advisories assessed for exploitability *in this architecture*, not just
  by severity score.
- An accepted, unfixable advisory gets a compensating control and a review
  date — never silence.

## What "verified" means here

A control is verified only when there is a reproducible check and a date.
Absence of a finding is not evidence of a control. This pack does not claim
a security posture for any deployed system — it states the standard the
consuming repository is expected to meet.

## Related

[`architecture.md`](architecture.md) · [`environments.md`](environments.md) ·
[`conventions.md`](conventions.md) · [`glossary.md`](glossary.md)

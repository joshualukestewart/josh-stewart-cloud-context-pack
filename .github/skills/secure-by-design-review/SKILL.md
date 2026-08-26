---
name: secure-by-design-review
description: Run a structured security review over a proposed or completed change across the React client, ASP.NET Core API, EF Core and Azure SQL data layer, Bicep infrastructure and CI, covering authentication, authorization, input handling, data exposure, secrets, dependencies and logging, and produce ranked, evidence-based findings. Use when asked for a security review or threat assessment, when a change touches authentication, authorization, secrets or data classification, or before merging anything that widens the attack surface.
license: MIT
compatibility: >-
  Guidance only - this skill ships no code and runs no scanner. It produces
  ranked, evidenced findings; it never scans, exploits, or proves the absence
  of a vulnerability. It has not been exercised against a real change set and
  no agent benchmark has been run. Advisory status, service security
  defaults and role permission sets are not asserted - retrieve them live per
  the AGENTS.md live-doc policy.
metadata:
  pack: josh-stewart-cloud-context-pack
  owner: Joshua Stewart
  layer: cross-cutting
  authored: "2026-08-26"
  checked-against: "Agent Skills specification, read 2026-08-26"
  target-stack: "review procedure spanning the React client, ASP.NET Core API, EF Core and Azure SQL, Bicep and CI"
  behaviour-verified: "none - not exercised against a real change set or by any security tool"
  volatile-facts: "advisory status, service security defaults and role permission sets are not asserted here, retrieve live"
---

# Secure-by-design review

Review the change as an attacker would read it, then report what you can
actually evidence. Speculation dressed as a finding wastes the reviewer's
time and hides the real issues.

## Scope first

Write down, in one or two lines each:

- **What changed** — files, endpoints, resources, permissions.
- **What crosses a trust boundary** — browser → API, API → database,
  API → other Azure service, CI → Azure.
- **What data is involved** and its sensitivity.
- **Who can reach it** — anonymous, authenticated, a specific role.

If the change touches none of these, say so and stop; a review with no
boundary crossing should be short.

## Procedure

Work the boundaries in this order. Detailed prompts per area are in
[references/review-checklist.md](references/review-checklist.md).

1. **Authentication.** Is every new path authenticated by default? Is any
   anonymous access deliberate and recorded? Are tokens validated for
   issuer, audience, expiry and signature — by the framework, not by hand?
2. **Authorization.** Is there a check that the caller may act on *this
   specific record*, not merely that they are logged in? Object-level
   authorization is the most commonly missed control.
3. **Input handling.** Is untrusted input validated at entry for type,
   range, length and allowed values? Are queries parameterised (EF Core
   does this by default — check any raw SQL or dynamic query building)?
4. **Output and data exposure.** Does the response return only fields the
   caller needs? Are entities projected to DTOs? Do error responses leak
   stack traces, SQL, internal hostnames or identifiers?
5. **Secrets.** Is there any credential in code, config, Bicep, parameter
   file, CI variable, example or test fixture? Is access identity-based?
   Any `VITE_`-prefixed value is public by definition.
6. **Infrastructure and access.** Least-privilege roles at narrow scopes,
   HTTPS-only, no public network exposure that is not required, no secret
   in a deployment output.
7. **Dependencies.** New packages justified, from expected publishers, and
   free of known advisories at review time.
8. **Logging and telemetry.** Enough to investigate, never containing
   secrets or personal data. Errors return a correlation id, not detail.
9. **Abuse and limits.** What happens under repetition, oversized input, or
   concurrent conflicting writes?

## Decision points

| Situation | Decision |
| --- | --- |
| A finding is theoretical | Say "unverified hypothesis" and state the test that would confirm it. Do not rank it as if confirmed. |
| A secret already exists in history | Rotate first, remove second. Removing the file does not undo the exposure. |
| The change needs anonymous access | Require an explicit written justification, plus rate limiting and reduced response detail. |
| A dependency has an advisory with no fix | Record the exposure, decide compensating controls, set a review date. Do not silently accept. |
| Fix is larger than the change under review | File it separately with a severity; do not block an unrelated change, and do not quietly drop it. |
| Reviewing your own change | Say so in the finding. Self-review is a data point, not an approval. |

## Reporting format

Rank each finding and keep it evidenced:

| Field | Content |
| --- | --- |
| Severity | Critical / High / Medium / Low, with the reason for that rank |
| Location | File and line, or resource and property |
| Evidence | What you observed — not what you assume |
| Impact | What an attacker gains |
| Fix | The smallest change that closes it |
| Confidence | Confirmed, or hypothesis + the test to confirm |

Lead with Critical and High. If there are none, say that plainly rather
than padding the report with style observations.

## Verification

- Every Critical/High finding names a file/resource and a concrete impact.
- No finding is stated as confirmed without evidence.
- The secret scan covers code, config, Bicep, parameter files, CI
  definitions, examples and tests.
- Authorization findings distinguish "not authenticated" from "authenticated
  but not permitted for this object".
- The review's own output contains no secret, token, personal data or
  internal identifier — including in quoted evidence. Redact.

## Failure handling

| Symptom | First action |
| --- | --- |
| Cannot determine who can reach an endpoint | Do not guess. Report it as an unresolved question blocking sign-off. |
| Tooling flags many low-value issues | Triage by exploitability in this architecture; report the ranked few, list the rest as noise. |
| Change is too large to review | Ask for it to be split. A review you cannot complete honestly is not a review. |
| Team pressure to approve | Record the residual risk, name the accepting decision-maker, and let the record stand. |

## Live retrieval required

Do **not** state from memory: current advisory status for any package,
Azure service security defaults, TLS/cipher policy specifics, built-in role
permission sets, or compliance control mappings. Retrieve live per the
live-doc policy in `../../../AGENTS.md`, using the security entries in
`../../../references/links.md`, and read
`../../../references/security-baseline.md` for this project's stable
non-negotiables.

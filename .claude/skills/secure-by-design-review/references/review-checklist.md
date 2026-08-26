# Security review prompts by boundary

Supporting file for the `secure-by-design-review` skill. Original content,
MIT licensed. These are review *prompts* — questions to answer with
evidence from the change under review, not a compliance checklist to tick.

## Browser → API

- [ ] Does every new route require authentication unless anonymity is a
      recorded decision?
- [ ] Is authorization checked against the specific object, not just the
      session?
- [ ] Are `403` and `404` used consistently so the API does not disclose the
      existence of records the caller may not see?
- [ ] Is CORS limited to known origins per environment, with no combination
      of any-origin and credentials?
- [ ] Is every `VITE_`-prefixed value safe to publish? (It is published.)
- [ ] Is any authorization decision made only in the client? (If yes, it is
      not an authorization decision.)

## API → data

- [ ] Is all raw or dynamically built SQL parameterised?
- [ ] Are request DTOs distinct from entities, so extra posted fields cannot
      bind to columns the caller should not set?
- [ ] Do responses project only required fields?
- [ ] Is the database identity's role the minimum needed, and not an
      ownership-level role?
- [ ] Do queries scope to the caller's tenant/owner in the query itself,
      rather than filtering after retrieval?

## API → other services

- [ ] Is every call authenticated with a managed identity?
- [ ] Is the assigned role the narrowest that works, at the narrowest scope?
- [ ] Are outbound failures handled without leaking the target's address or
      error detail to the caller?

## CI → Azure

- [ ] Is CI authenticated by federated credential (OIDC), with no stored
      client secret or publish profile?
- [ ] Is the federated credential scoped to this repository *and* a specific
      branch or environment, not a wildcard?
- [ ] Can a staging pipeline reach production resources? It should not.
- [ ] Are workflow permissions least-privilege rather than default-write?

## Secrets

- [ ] Scanned: source, config files, Bicep and parameter files, CI
      definitions, tests, fixtures, examples, and this pack's own content.
- [ ] No secret in a deployment output or a log line.
- [ ] If a secret was ever committed: rotated first, then removed.

## Data handling

- [ ] Is the data's sensitivity classified before deciding controls?
- [ ] Is personal data minimised, and excluded from logs and telemetry?
- [ ] Are exports, bulk endpoints and search results bounded?
- [ ] Is data at rest and in transit encrypted by platform default, with no
      change that weakens it?

## Dependencies

- [ ] Is each new dependency necessary, actively maintained, and from the
      expected publisher?
- [ ] Any known advisories at review time, and what is the exposure in this
      architecture specifically?
- [ ] Are lockfiles committed and installs deterministic in CI?

## Abuse and resilience

- [ ] What happens on repeated calls — is there rate limiting where it
      matters?
- [ ] What happens on oversized payloads?
- [ ] What happens on concurrent conflicting writes — is there a
      concurrency control, or a silent last-write-wins?
- [ ] Do error paths fail closed?

## Evidence discipline

- [ ] Every finding cites a file/line or resource/property.
- [ ] Confirmed findings are separated from hypotheses.
- [ ] Quoted evidence is redacted of secrets, tokens, personal data and
      internal identifiers.

---
name: aspnetcore-endpoint-slice
description: Add or change an HTTP endpoint in the ASP.NET Core (.NET 9) API - route, request/response contract, validation, authorization, error shape, OpenAPI description and tests - as one reviewable vertical slice. Use when the task mentions an API endpoint, controller or minimal API route, DTO, model validation, HTTP status codes, CORS, OpenAPI/Swagger, or an API contract change requested by the web client.
license: MIT
compatibility: >-
  Guidance only - this skill ships no code and requires no packages. Written
  for the consuming repository's real API, which targets net9.0 on runtime
  9.0.19 while its builds currently run under SDK 10.0.400. Confirmed
  2026-08-26; not built or tested here. The 9.0 channel was reported in
  maintenance with EOL 2026-11-10. No agent benchmark has been run. Volatile
  facts are not asserted - retrieve them live per the AGENTS.md live-doc
  policy.
metadata:
  pack: josh-stewart-cloud-context-pack
  owner: Joshua Stewart
  layer: api
  authored: "2026-08-26"
  checked-against: "Agent Skills specification, read 2026-08-26"
  target-stack: "ASP.NET Core targeting net9.0, installed runtime 9.0.19, builds currently executing under SDK 10.0.400 (confirmed in the consuming repository on 2026-08-26; the 9.0 channel is in maintenance with EOL 2026-11-10)"
  behaviour-verified: "none - no agent benchmark has been run (see COMPATIBILITY.md)"
  volatile-facts: "not asserted here, retrieve live per the AGENTS.md live-doc policy"
---

# ASP.NET Core endpoint slice

One endpoint, one slice: contract, handler, authorization, errors, tests.
The endpoint is a boundary — treat everything arriving at it as hostile.

## Before you start

Confirm from the consuming repository:

- Minimal APIs or controllers? Match the existing style; do not mix.
- The existing validation approach, error/`ProblemDetails` shape, and API
  versioning scheme.
- The authentication scheme already configured (see
  `entra-managed-identity-wiring` for the identity side).
- Whether the web client already assumes a shape — coordinate, do not
  unilaterally rename fields.

## Procedure

1. **Write the contract as explicit DTOs.** Never expose an EF Core entity
   directly as a request or response type: it leaks schema, invites
   over-posting, and couples the wire format to the database.
2. **Place the slice** beside its siblings, e.g.
   `Features/<Feature>/` holding the endpoint registration, request/response
   records, validator, and handler.
3. **Validate on entry.** Reject invalid input with `400` and a consistent
   `ProblemDetails` body before any I/O. Validate lengths, ranges,
   enumerations and required fields — not just nullability.
4. **Authorize explicitly.** Every endpoint states its policy. Default-deny:
   an endpoint with no authorization attribute must be a deliberate,
   commented decision, not an omission.
5. **Keep the handler thin.** Parse → authorize → call the domain/data
   layer → map to response. Query composition belongs behind the data
   layer; route to `efcore-azuresql-change` for anything touching entities.
6. **Return honest status codes.** `200`/`201` with a body, `204` with
   none, `400` for shape, `401` unauthenticated, `403` unauthorized, `404`
   for both missing and not-visible-to-caller, `409` for conflict. Never
   return `200` with an error payload.
7. **Never leak internals.** Exception details, stack traces, SQL text and
   connection information stay in logs. Return a correlation id instead —
   see `appinsights-telemetry-and-triage`.
8. **Describe it for OpenAPI**, including every non-success status the
   client must handle.
9. **Set CORS at the app level**, allow-listing the known web origins per
   environment. Never `AllowAnyOrigin` together with credentials.
10. **Test**: happy path, one validation failure, one authorization failure,
    one not-found. Integration-level tests through the pipeline beat unit
    tests of the handler alone.

## Decision points

| Situation | Decision |
| --- | --- |
| Change breaks an existing client field | Additive first: add the new field, keep the old one, migrate the client, then remove. Never rename in place in one release. |
| Endpoint needs a new database column | Route to `efcore-azuresql-change` first; the migration must ship before or with the endpoint, and be tolerated by the running previous version. |
| Endpoint must call another Azure service | Use managed identity via the repo's credential wiring. Route to `entra-managed-identity-wiring`. No keys in configuration. |
| Long-running work | Return `202` plus a status resource. Do not hold the request open. |
| Endpoint returns a list | Paginate from the first version. Retrofitting pagination is a breaking change. |
| Anonymous access requested | Route to `secure-by-design-review` before implementing. |

## Verification

```bash
dotnet restore
dotnet build   -warnaserror
dotnet test
dotnet format --verify-no-changes   # if the repo uses it
```

Then check by hand:

- The OpenAPI document reflects the new route and all documented statuses.
- A request missing a required field returns `400` with the repo's standard
  error shape, not a framework default.
- An unauthenticated request returns `401`, not `500` and not `200`.
- No entity type appears in the public contract.
- No secret, connection string or environment-specific URL is in
  `appsettings*.json` — see `../../../references/security-baseline.md`.

## Failure handling

| Symptom | First action |
| --- | --- |
| `500` where `400` expected | Validation is running after I/O, or an exception filter is missing. Move validation to entry. |
| CORS preflight fails | Confirm the exact origin (scheme + host + port) is allow-listed for that environment, and that the CORS middleware is registered before the endpoint. |
| Works locally, `401` when deployed | Local development is bypassing authentication. Compare the deployed app's configured authority/audience — do not weaken the deployed configuration to match local. |
| Intermittent timeouts under load | Do not raise the timeout first. Route to `appinsights-telemetry-and-triage` and find the dependency actually blocking. |
| Response shape drifted from the client's expectation | Fix the contract in one place and regenerate/update the client types; do not patch both sides independently. |

## Live retrieval required

Do **not** state from memory: current ASP.NET Core / .NET API signatures,
OpenAPI package names and options, rate-limiting or output-caching option
names, or supported .NET release dates. Retrieve live per the live-doc
policy in `../../../AGENTS.md`, using the ASP.NET Core entries in
`../../../references/links.md`.

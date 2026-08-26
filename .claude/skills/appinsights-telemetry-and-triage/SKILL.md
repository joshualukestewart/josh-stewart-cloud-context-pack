---
name: appinsights-telemetry-and-triage
description: Instrument the ASP.NET Core API and React client with Application Insights and use that telemetry to triage a production or staging incident - correlation across tiers, custom events and metrics, sampling, alerts, and evidence-first root-cause analysis. Use when the task mentions Application Insights, Azure Monitor, logging, tracing, correlation or operation ids, sampling, an alert, or a report that something is slow, failing, erroring or degraded in a deployed environment.
license: MIT
compatibility: >-
  Guidance only - this skill ships no code. Written for Application Insights
  and Azure Monitor covering an ASP.NET Core API and a React client. The
  query shapes under references/ were never run against a workspace and are
  shapes, not verified syntax. No agent benchmark has been run. SDK names,
  table and column names, sampling defaults and retention are not asserted -
  retrieve them live per the AGENTS.md live-doc policy.
metadata:
  pack: josh-stewart-cloud-context-pack
  owner: Joshua Stewart
  layer: observability
  authored: "2026-08-26"
  checked-against: "Agent Skills specification, read 2026-08-26"
  target-stack: "Application Insights and Azure Monitor for an ASP.NET Core API and a React client"
  behaviour-verified: "none - the query shapes in references/ were not run against any workspace"
  volatile-facts: "SDK package names, table and column names, sampling defaults and retention are not asserted here, retrieve live"
---

# Application Insights telemetry and triage

Two jobs: make the system explain itself, and read that explanation before
changing anything.

## Part A — instrumenting

1. **Connect by connection string supplied from infrastructure**, never a
   hardcoded value. Route to `bicep-infra-change`.
2. **Set a distinct role name per component and per environment** (for
   example `api` and `web`, in `staging` and `production`). Without this,
   the application map merges tiers and staging noise pollutes production
   analysis.
3. **Propagate correlation end to end.** The client's request, the API's
   handling of it, and the resulting database call must share one operation
   id. If a background job continues the work, carry the correlation with
   it explicitly.
4. **Log structured properties, never interpolated strings.** Use named
   fields so telemetry is queryable; a formatted sentence is not data.
5. **Never log secrets or personal data** — no tokens, connection strings,
   passwords, full request bodies, or identifiers that are personal data
   under the project's classification. See
   `../../../references/security-baseline.md`.
6. **Emit a small number of deliberate custom events/metrics** for the
   business outcomes that matter. Do not instrument everything; volume
   costs money and forces sampling that hides the rare failure.
7. **Return a correlation id to the client on failure** so a user report
   maps directly to a trace, while the error message itself stays generic.
8. **Decide sampling consciously.** Sampling is what keeps cost bounded and
   what makes an individual failure disappear. Record the choice.
9. **Alert on symptoms, not causes** — availability, error rate, and
   latency at a percentile, with a threshold someone will actually act on.

## Part B — triaging

Follow this order. Do not skip to a fix.

1. **Establish the facts:** which environment, from when, which component,
   what proportion of requests, and what changed recently (deploy,
   migration, infrastructure change, dependency).
2. **Confirm the blast radius** from the failure and performance views
   before opening any code.
3. **Follow one failing operation end to end** using its operation id
   across client, API and dependency. One complete trace beats ten
   aggregates.
4. **Attribute the time.** Is it the request itself, an outbound dependency,
   or the database? Fix where the time actually is.
5. **Correlate with the deployment timeline.** If the onset matches a
   release, the release is the primary hypothesis — route to
   `release-staging-to-production` for rollback options.
6. **Write the finding down before fixing**: symptom, evidence, hypothesis,
   test. Then act.

Concrete starting queries are in
[references/triage-queries.md](references/triage-queries.md).

## Decision points

| Situation | Decision |
| --- | --- |
| Telemetry volume/cost is high | Reduce what you emit before increasing sampling — sampling loses exactly the rare events you need. |
| A failure appears only in aggregate | Sampling is likely hiding individual traces. Check the sampling configuration before concluding the trace does not exist. |
| Client and API traces will not correlate | Verify the client is instrumented and that correlation headers survive the network path. Do not conclude "it is not correlated" from one example. |
| An alert fires constantly | It is measuring a cause, not a symptom, or its threshold is wrong. A permanently firing alert is equivalent to no alert. |
| Incident is live | Restore service first (redeploy the last known-good artifact), gather evidence in parallel, root-cause afterwards. |
| Root cause is unclear after evidence | Say so. An unsupported root cause stated confidently is worse than an open question. |

## Verification

After an instrumentation change:

- A request from the client produces a single correlated trace spanning
  client → API → dependency.
- Role names distinguish component and environment in the application map.
- A deliberately failed request appears with the returned correlation id.
- No telemetry record contains a secret or personal identifier.
- Alert rules have an action group that reaches someone.

After a triage:

- The stated root cause is supported by a specific trace or query result
  you can point to.
- The fix's expected effect is stated *before* deployment, and confirmed by
  the same query afterwards.

## Failure handling

| Symptom | First action |
| --- | --- |
| No telemetry at all | Check the connection string reached the app (app settings), then that the SDK/exporter is registered, then network egress — in that order. |
| Telemetry arrives but is uncorrelated | Missing propagation at one hop; find the hop that starts a new operation id. |
| Data lags | Ingestion is not instantaneous. Wait and re-query before declaring instrumentation broken. |
| Query returns nothing | Confirm the time range, the environment/role filter, and the table name before assuming the data is absent. |
| Everything looks healthy but users report failure | The failure is outside instrumented paths — client-side, network, or authentication. Widen instrumentation rather than dismissing the report. |

## Live retrieval required

Do **not** state from memory: current SDK/exporter package names and
configuration APIs, table and column names in the query language, sampling
defaults, retention periods, ingestion limits, or pricing. Retrieve live per
the live-doc policy in `../../../AGENTS.md`, using the Application Insights
and Azure Monitor entries in `../../../references/links.md`.

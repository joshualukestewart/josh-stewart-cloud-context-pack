# Triage query starting points

Supporting file for the `appinsights-telemetry-and-triage` skill. Original
content, MIT licensed.

**These are shapes, not verified syntax.** Table names, column names and
operators in Azure Monitor's query language change and vary by workspace
configuration. Confirm the current schema live (see the parent `SKILL.md`)
before relying on any query below. Substitute `<...>` placeholders.

The classic `requests`, `dependencies`, `exceptions` and `traces` shapes below
assume the query is scoped to the Application Insights resource. A query run
directly against its Log Analytics workspace can expose different workspace
table names and columns; inspect the active schema before translating them.

## Order of investigation

1. Scope — which environment and component, over what window.
2. Blast radius — how many requests/users are affected.
3. One end-to-end trace of a single failing operation.
4. Time attribution — request vs dependency vs database.
5. Change correlation — did this start at a deployment?

## 1. Error rate by operation

Group failed requests by operation to find where failure concentrates,
filtered to one component and environment by role name.

```
requests
| where timestamp > ago(<window>)
| where cloud_RoleName == "<component>-<environment>"
| summarize total = count(), failed = countif(success == false) by operation_Name
| extend failureRate = todouble(failed) / total
| order by failed desc
```

## 2. Latency distribution, not the average

An average hides the tail that users actually notice. Look at high
percentiles alongside the median.

```
requests
| where timestamp > ago(<window>)
| where cloud_RoleName == "<component>-<environment>"
| summarize percentiles(duration, 50, 95, 99) by bin(timestamp, <interval>)
```

## 3. One operation, end to end

Take an operation id from a failed request (or from the correlation id
returned to a user) and pull every telemetry type for it.

```
union requests, dependencies, exceptions, traces
| where operation_Id == "<operationId>"
| project timestamp, itemType, name, target, resultCode, duration, message
| order by timestamp asc
```

## 4. Dependency attribution

If the request is slow but the handler is not, the time is downstream.

```
dependencies
| where timestamp > ago(<window>)
| where cloud_RoleName == "<component>-<environment>"
| summarize calls = count(), failures = countif(success == false),
            p95 = percentile(duration, 95) by type, target, name
| order by p95 desc
```

## 5. Change correlation

Compare the failure onset against the deployment timeline. If onset aligns
with a release, treat the release as the primary hypothesis and consider
rollback before further analysis.

```
requests
| where timestamp > ago(<window>)
| where cloud_RoleName == "<component>-<environment>"
| summarize failed = countif(success == false) by bin(timestamp, <interval>)
| order by timestamp asc
```

## Hygiene

- Always filter by role name, or staging will contaminate the result.
- Always state the time window in the finding; a rate without a window is
  meaningless.
- Never paste raw telemetry rows containing personal data, tokens or
  connection details into an issue, PR or chat transcript.
- If a query returns nothing, question the filters before questioning the
  instrumentation.

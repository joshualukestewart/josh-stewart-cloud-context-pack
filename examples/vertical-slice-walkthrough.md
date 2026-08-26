# Example: a vertical slice, end to end

Illustrative walkthrough for the Joshua Stewart Cloud Context Pack. Original
content, MIT licensed. Snippets are **shape, not compilable code** — they
omit imports, namespaces and registration for readability, and they are not
derived from any private codebase.

Skills exercised, in order: `efcore-azuresql-change` →
`aspnetcore-endpoint-slice` → `react-vite-feature-slice`, with
`secure-by-design-review` before merge.

**Scenario.** An approver needs to see invoices awaiting approval and
approve one. Nothing exists yet.

---

## Step 0 — decide the order before writing anything

The slice needs a new column (`ApprovedAtUtc`), a new list endpoint, a new
approve endpoint, and a new page. Because the previous version keeps running
during release, the order is fixed:

```
additive schema change  →  API  →  client
```

The column is added **nullable**. Making it non-nullable, or renaming
anything, is a separate later release. This single decision is what makes
the release rollback-safe.

## Step 1 — data (`efcore-azuresql-change`)

> **This example illustrates Branch A (EF migrations).** The repository this
> pack was written for uses **Branch B** — explicit idempotent
> dual-provider bootstrap DDL, not migrations. Establish which mechanism the
> consuming repository actually uses before copying anything below; the
> *ordering and the additive rule* are what transfer, not the commands.

Model the change explicitly rather than by convention:

```csharp
// Entities/Invoice.cs
public sealed class Invoice
{
    public Guid Id { get; init; }
    public string Reference { get; init; } = default!;
    public decimal Amount { get; init; }
    public Guid OwnerId { get; init; }
    public DateTime? ApprovedAtUtc { get; set; }   // additive: nullable
}

// Configurations/InvoiceConfiguration.cs
builder.Property(i => i.Reference).HasMaxLength(64).IsRequired();
builder.Property(i => i.Amount).HasPrecision(18, 2);
builder.HasIndex(i => new { i.OwnerId, i.ApprovedAtUtc });
```

Generate, then **read the generated migration before committing it**:

```bash
dotnet ef migrations add AddInvoiceApprovedAtUtc -p src/Data -s src/Api
dotnet ef migrations script --idempotent -o artifacts/migration.sql -p src/Data -s src/Api
```

Check the script for: no `DROP`, no table rebuild, no unguarded `UPDATE`
over a large table. Confirm the **previous** application version still runs
against the new schema.

## Step 2 — API (`aspnetcore-endpoint-slice`)

DTOs, not entities, on the wire:

```csharp
// Features/Invoices/Contracts.cs
public sealed record PendingInvoiceResponse(Guid Id, string Reference, decimal Amount);
public sealed record ApproveInvoiceRequest(string Note);
```

Thin handler; authorize the **object**, not just the session:

```csharp
// Features/Invoices/ApproveInvoice.cs
var invoice = await db.Invoices
    .SingleOrDefaultAsync(i => i.Id == id && i.OwnerId == caller.OwnerId, ct);

if (invoice is null)
    return TypedResults.NotFound();            // also covers "not yours"

if (invoice.ApprovedAtUtc is not null)
    return TypedResults.Conflict();            // 409, not 200-with-an-error

invoice.ApprovedAtUtc = timeProvider.GetUtcNow().UtcDateTime;
await db.SaveChangesAsync(ct);
return TypedResults.NoContent();
```

Note three deliberate choices:

- `404` is returned both for missing and for not-visible-to-this-caller, so
  the API does not disclose the existence of other owners' records.
- The owner filter is **in the query**, not applied after retrieval.
- Already-approved is `409`, because it is a state conflict, not bad input.

Register with an explicit policy and a projected list query:

```csharp
group.MapGet("/invoices/pending", GetPending).RequireAuthorization("ApproveInvoices");
group.MapPost("/invoices/{id:guid}/approve", ApproveInvoice).RequireAuthorization("ApproveInvoices");

// projection, server-side filtering, no tracking, bounded page
var page = await db.Invoices.AsNoTracking()
    .Where(i => i.OwnerId == caller.OwnerId && i.ApprovedAtUtc == null)
    .OrderBy(i => i.Reference)
    .Take(pageSize)
    .Select(i => new PendingInvoiceResponse(i.Id, i.Reference, i.Amount))
    .ToListAsync(ct);
```

Tests: happy path, validation failure, unauthorized, not-found, and the
`409` conflict.

## Step 3 — client (`react-vite-feature-slice`)

One folder, `web/src/features/invoice-approval/`:

```
invoice-approval/
  api/pendingInvoices.ts     one function per endpoint
  model/types.ts             types + runtime validator
  components/PendingInvoiceList.tsx
  hooks/usePendingInvoices.ts
  __tests__/
```

Validate the server's response at runtime — a compile-time type is not
validation:

```ts
// model/types.ts
export type PendingInvoice = { id: string; reference: string; amount: number };

export function parsePendingInvoices(input: unknown): PendingInvoice[] {
  if (!Array.isArray(input)) throw new ApiShapeError('expected an array');
  return input.map(parseOne);
}
```

Handle all three non-success states before the success path:

```tsx
export function PendingInvoiceList() {
  const { data, status, error } = usePendingInvoices();

  if (status === 'loading') return <Spinner label="Loading invoices" />;
  if (status === 'error')   return <ErrorPanel correlationId={error.correlationId} />;
  if (data.length === 0)    return <EmptyState message="Nothing awaiting approval" />;

  return <ul>{data.map((i) => <InvoiceRow key={i.id} invoice={i} />)}</ul>;
}
```

The error panel shows the correlation id returned by the API — enough for
support to find the trace, and nothing that leaks internals.

## Step 4 — review before merge (`secure-by-design-review`)

The questions this slice must answer:

- Is the owner filter in the query, so another owner's invoice cannot be
  fetched or approved? *Yes — step 2.*
- Does the response return only what the caller needs? *Yes — projection to
  a DTO.*
- Could a client-side check be the only authorization? *No — the client
  never decides.*
- Are there any secrets, including in `VITE_`-prefixed values? *None.*
- Does the error path leak internals? *No — correlation id only.*
- Is the list bounded? *Yes — paged from the first version.*

## Step 5 — release (`release-staging-to-production`)

```
merge to develop → staging deploy → verify
   → promote the same artifact
      → apply migration (CI's database identity, idempotent script)
      → deploy the API to the production App Service → verify health
      → verify one real journey, error rate, p95 latency
```

Rollback: redeploy the previous known-good artifact to the production app —
there is no slot to swap back to, so its id was recorded before the release.
The migration stays; it is additive, so the previous version tolerates it.
That was decided in step 0, not discovered here.

## What this example is not

It is not compilable, not complete, and not a template to copy verbatim.
Its value is the *ordering and the decisions*, which are stable, rather than
the API surface, which is not — retrieve current framework specifics live
(see `../references/links.md`).

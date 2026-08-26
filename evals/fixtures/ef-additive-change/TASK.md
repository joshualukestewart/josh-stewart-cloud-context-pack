# Work order schema change (fixture)

The `WorkOrders` table in this fixture stands in for a table with tens of
millions of rows in production. The application version currently deployed
reads and writes every column defined in
`api/Migrations/20260101000000_InitialCreate.cs` and knows nothing about any
column added after it.

## What exists

- `api/Models/WorkOrder.cs` — the entity as currently deployed.
- `api/Data/AppDbContext.cs` — mapping and existing indexes.
- `api/Migrations/20260101000000_InitialCreate.cs` — **already applied in
  every environment, including production.**
- `db/schema-baseline.sql` — a record of what production currently looks
  like. It is a record, not a working file.

## What does not exist

Any notion of when a work order was closed, and any index supporting a
query over open work orders by creation date.

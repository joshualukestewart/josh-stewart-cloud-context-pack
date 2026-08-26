# Dashboard (fixture)

The operations dashboard: one page, one endpoint per panel.

## What exists

- `web/src/pages/Dashboard.tsx` — the page.
- `api/Endpoints/DashboardEndpoints.cs` — the endpoints it calls.
- `api/Data/AppDbContext.cs` — the data model behind them.

## What does not exist

Any measurement. There is no profiler output, no trace, no timing, no
database plan, no browser performance recording, and no statement of which
part feels slow, for whom, on what device, or at what data volume.

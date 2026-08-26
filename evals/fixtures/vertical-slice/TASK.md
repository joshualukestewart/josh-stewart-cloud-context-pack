# Work order tracker (fixture)

A trimmed-down slice of an internal work-order tracker: a React list view, a
minimal ASP.NET Core API, and EF Core persistence.

## What exists

- `web/` — the list view and a tiny fetch helper.
- `api/` — one GET endpoint, the `WorkOrder` entity and the DbContext.

## What does not exist

There is no way to archive a work order anywhere in this workspace. The
list renders a row per work order and stops there.

## Constraints that apply to any change here

- The dependency sets in `web/package.json` and `api/Api.csproj` are fixed.
- There is no build, restore or test step available in this workspace; work
  from the source as written.

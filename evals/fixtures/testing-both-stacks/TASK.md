# Pricing rules (fixture)

The same discount rule is implemented on both sides of this application:
in the React summary component the customer sees, and in the server-side
calculator that the order total is actually built from.

## What exists

- `web/src/features/pricing/PriceSummary.tsx`
- `api/Services/DiscountCalculator.cs`
- `web/package.json` — a test runner is already declared.
- `api.tests/Api.Tests.csproj` — a test project is already declared.

## What does not exist

No tests. Neither rule is pinned by anything.

## Notes

- The two implementations are not identical in every detail. Read both
  before assuming they agree.
- Neither runner can be executed in this workspace; there is no restore and
  no `node_modules`. Tests are judged as written source.

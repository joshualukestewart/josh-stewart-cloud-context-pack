# Checkout telemetry (fixture)

The checkout flow in this fixture has three steps and can be abandoned at
any of them.

## What exists

- `api/Services/CheckoutService.cs` — starts, completes and abandons a
  checkout. `AbandonAsync` is called by the session-timeout worker and by
  the explicit "leave checkout" action.
- `queries/` — empty. Saved analytics queries live here.

## What does not exist

The service emits no telemetry at all, and there is no saved query for
abandonment.

## Notes

- Telemetry from this service is ingested into a workspace where custom
  events are queryable.
- Cart contents include customer-entered delivery notes. Think about what
  belongs in telemetry and what does not.

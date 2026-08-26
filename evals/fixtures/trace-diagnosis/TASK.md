# Checkout latency (fixture)

Evidence captured from one slow checkout request.

## What exists

- `traces/checkout-trace.json` — a single distributed trace, one JSON object
  per span, in the order the spans started. Durations are milliseconds.
- `logs/api-excerpt.log` — the application log lines emitted during that
  same request, correlated by `traceId`.

## Notes

- Both files are evidence. Treat them as read-only.
- The customer-facing timeout for checkout is 5,000 ms; this request
  finished just under it, and slower carts do not.
- No profiler, no database plan and no metrics dashboard are available in
  this workspace. Everything you can know is in these two files.

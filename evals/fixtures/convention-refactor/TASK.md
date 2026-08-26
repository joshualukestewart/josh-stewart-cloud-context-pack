# Billing services (fixture)

## What exists

- `CONVENTIONS.md` — how this codebase is written.
- `api/Common/Result.cs` — the shared result type.
- `api/Services/CustomerService.cs` — a service that follows the
  conventions.
- `api/Services/InvoiceService.cs` — a service that predates them.

## Notes

- `InvoiceService` is called from an HTTP endpoint that today catches
  exceptions and maps them to status codes. That endpoint is not in this
  workspace, but it exists.
- Nothing here can be compiled or run.

# Conventions

These are not preferences. New and modified code in this repository follows
all four.

1. **File-scoped namespaces.** One namespace per file, declared with a
   semicolon, no braces.
2. **Expected failures are returned, not thrown.** Anything a caller can
   reasonably expect — a missing record, a validation failure, a
   business-rule refusal — is returned as `Result<T>` (see
   `api/Common/Result.cs`). Exceptions are reserved for genuinely
   exceptional conditions such as a lost database connection.
3. **Private fields are `_camelCase`.** No `this.` prefix, no bare
   `camelCase` fields.
4. **Asynchronous methods end in `Async` and accept a
   `CancellationToken`.** The token is threaded through to every call that
   accepts one; it is never dropped or defaulted at the call site.

`api/Services/CustomerService.cs` is the reference implementation of all
four.

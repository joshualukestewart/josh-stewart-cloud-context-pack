# Public search API (fixture)

A minimal API with two endpoint groups.

## What exists

- `api/Program.cs` — service registration and the request pipeline.
- `api/Endpoints/PublicSearchEndpoints.cs` — anonymous, publicly reachable
  search endpoints under `/api/public`.
- Internal endpoints are represented by the `/api/internal` group in
  `Program.cs`; they are authenticated and must keep behaving exactly as
  they do now.

## Notes

- `api/Api.csproj` is fixed. Anything needed here is expected to be
  available without adding a package.
- Traffic reaches this API through a reverse proxy. That is a fact about
  the deployment, not a hint about the answer.

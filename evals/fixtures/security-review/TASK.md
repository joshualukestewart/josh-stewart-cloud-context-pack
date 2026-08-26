# Partner search API (fixture)

Part of an internal API that exposes work-order search and pulls pricing
from a partner feed.

## What exists

- `api/Controllers/SearchController.cs` — the search endpoint.
- `api/Services/PartnerFeedClient.cs` — the partner feed client.
- `api/appsettings.json` — application settings.

## Notes

- This code is representative of what is deployed; assume anything here is
  reachable in production unless you can show otherwise.
- The partner feed is a third-party HTTP service reached over the public
  internet.
- Nothing in this workspace can be built or run. Review the source as
  written.

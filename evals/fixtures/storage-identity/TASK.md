# Attachment storage (fixture)

A service that reads and writes work-order attachments in blob storage.

## What exists

- `api/Services/AttachmentStorageService.cs` — constructs its storage client
  from a configuration value.
- `api/appsettings.json` — holds the placeholder that value is read from.

## Notes

- The placeholder in `appsettings.json` is not a credential and has never
  been valid anywhere. It stands in for the connection string a deployment
  would inject.
- The deployed application runs as an app service with no identity
  configured yet; assume nothing about what has already been granted.
- There is no infrastructure code in this workspace. If a change requires
  something to be granted or configured outside the repository, say so
  explicitly rather than assuming it exists.

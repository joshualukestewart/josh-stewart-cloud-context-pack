# Web app infrastructure (fixture)

Declarative infrastructure for one web application and the storage account
it uses.

## What exists

- `infra/main.bicep` — a plan, a site and a storage account.
- `infra/main.parameters.json` — deployment parameters.

## What does not exist

- The site has no identity.
- The site has no app settings referring to the storage account.
- Nothing grants the site any access to the storage account.

## Notes

- This template is redeployed on every release, so anything it declares
  must be safe to declare repeatedly.
- There is no deployment step available in this workspace and no
  subscription to validate against; work from the template as written.

# Deployment (fixture)

## What exists

- `.github/workflows/deploy.yml` — builds and packages the application when
  something lands on `develop`. It stops there.
- `docs/environments.md` — the environments this application has, and the
  rules that apply to each.

## What does not exist

Any deployment at all. The workflow builds an artifact and discards it.

## Notes

- Environment protection rules, reviewers and secrets are configured in the
  repository settings, not in this workspace. If something must be
  configured there for the workflow to behave as intended, say so.
- `docs/environments.md` is the requirement, not a suggestion.

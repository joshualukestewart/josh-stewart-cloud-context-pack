# Environments

Three environments, in this order.

| Environment | Trigger | Approval | Notes |
| --- | --- | --- | --- |
| `development` | every push to `develop` | none | Not deployed by this workflow; developers run locally. |
| `staging` | a successful build on `develop` | none | Must deploy automatically. Smoke checks run here. |
| `production` | a successful staging deployment | one human approver who is not the person who triggered the run | Must never deploy without that approval. |

## Rules

1. The application is built exactly once. Staging and production receive the
   same build output. A rebuild between environments is not acceptable,
   because it means production runs a binary that nothing tested.
2. No credential may be written into a workflow file. Deployment
   credentials are provided by the repository's configured secrets or by
   federated identity.
3. Production deployment must be blocked by an environment protection rule.
   A comment, a naming convention, or a condition the triggering actor can
   satisfy alone does not count as an approval.
4. If the staging deployment fails, production must not run.

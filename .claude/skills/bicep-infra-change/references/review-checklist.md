# Bicep change review checklist

Supporting file for the `bicep-infra-change` skill. Original content, MIT
licensed. Use as a pre-merge pass on any `.bicep` diff. Nothing here is a
substitute for live documentation — see the parent `SKILL.md`.

## Secrets and outputs

- [ ] No `output` returns a key, password, SAS token, connection string, or
      anything derived from a `list*` secret-returning function.
- [ ] No `@secure()` parameter has a default value.
- [ ] No parameter file (`*.bicepparam`, `*.parameters.json`) contains a
      credential.
- [ ] Any genuinely required secret is a Key Vault reference resolved at
      runtime, not a value materialised in the template.

## Identity and access

- [ ] Every service-to-service call is authorised by a managed identity, not
      a key.
- [ ] Each role assignment uses the narrowest scope that works (resource >
      resource group > subscription).
- [ ] The role chosen is the least privileged that satisfies the operation;
      no broad management-plane role where a data-plane role would do.
- [ ] Role assignment names are deterministic over (scope, principalId,
      roleDefinitionId), so re-deployment is idempotent.
- [ ] `principalType` is set where the platform requires it, to avoid
      replication races on newly created identities.

## Determinism and naming

- [ ] Globally unique names are derived, not hardcoded.
- [ ] The same template deploys to every environment; environments differ
      only by parameter values.
- [ ] No resource name embeds a person's name, ticket number, or date.

## Change safety

- [ ] `what-if` was run against the target parameter file and the output was
      read line by line.
- [ ] No unexpected delete or replace operations.
- [ ] Resources not managed by this template are declared `existing` rather
      than redeclared.
- [ ] Data-bearing resources (databases, storage) have delete/purge
      protection appropriate to the environment.

## Observability and operability

- [ ] Diagnostic settings route logs and metrics somewhere queryable.
- [ ] The application's Application Insights connection is provided by the
      template, not configured by hand.
- [ ] Health check paths and probes match what the application actually
      serves.

## Reviewability

- [ ] The diff is scoped to one concern.
- [ ] `bicep build` produces no unexplained warnings.
- [ ] Any accepted linter warning has a one-line justification in the PR.

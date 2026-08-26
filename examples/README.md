# `examples/`

Public-safe, **illustrative** examples for the Joshua Stewart Cloud Context
Pack. Original content, MIT licensed.

## Read this first

- Nothing here is copied from a private codebase, and nothing is copied from
  vendor documentation.
- Nothing here is production-ready. Examples are deliberately small and omit
  networking, backup, diagnostics, and most hardening.
- Names, ids and hostnames are placeholders. GUID placeholders are all-zero
  on purpose.
- Examples are the **second-lowest** authority in this pack's trust order
  (above model memory, below the skills and references). See `../AGENTS.md`.
- Any api version, SKU, role definition id or configuration key shown here
  will age. Retrieve current values live before adapting — see
  `../references/links.md`.

## Contents

| Example | Demonstrates | Mechanically checkable |
| --- | --- | --- |
| [vertical-slice-walkthrough.md](vertical-slice-walkthrough.md) | `react-vite-feature-slice`, `aspnetcore-endpoint-slice`, `efcore-azuresql-change` working as one slice | No — narrative with illustrative snippets |
| [bicep-managed-identity/](bicep-managed-identity/) | `bicep-infra-change`, `entra-managed-identity-wiring` — no secrets anywhere, two apps on one shared plan, no slots | **Yes** — `bicep build`, `bicep lint`, `bicep build-params` |
| [deployment-develop-to-production/](deployment-develop-to-production/) | `azure-appservice-deploy`, `release-staging-to-production` — `develop`→the staging app, `main`→the production app | Partly — YAML parses; never executed |

## Verifying the checkable parts

From the repository root:

```bash
bicep build        examples/bicep-managed-identity/main.bicep --stdout
bicep lint         examples/bicep-managed-identity/main.bicep
bicep build-params examples/bicep-managed-identity/staging.bicepparam --stdout
bicep build-params examples/bicep-managed-identity/production.bicepparam --stdout
python -c "import yaml,sys; yaml.safe_load(open('examples/deployment-develop-to-production/deploy.example.yml'))"
```

Verified on 2026-08-26 with Bicep CLI 0.44.1 and Python 3.12.10: `build`,
`build-params` and the YAML parse all succeeded, and `lint` reported no
findings.

**The verifying toolchain is behind.** The latest published Bicep CLI on
that date was 0.46.1; 0.44.1 is what actually ran here. `sources.json`
carries a `versionProbe` on `bicep-overview` that tracks this, and
`../FRESHNESS.md` records it as an open review item. Re-run the commands
above on a current CLI before trusting the clean result.

That verifies **syntax and linter rules only**. It does not verify that the
template deploys, that the api versions are current, that the role id is
correct, or that the workflow would run.

The workflow example is named `deploy.example.yml` and lives outside
`.github/workflows/`, so it can never be picked up as an active workflow.

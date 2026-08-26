# Links

Curated index of the primary sources this pack relies on. **Link-only:** no
prose, code, or logos are reproduced from any of these. Each entry below has
a matching record in [`../sources.json`](../sources.json), which carries the
authority, licence treatment, volatility tier, owner and review cadence that
[`../FRESHNESS.md`](../FRESHNESS.md) governs. The `id` column is that
record's id.

**Read this before using the list.** Nothing here is quoted or summarised as
current fact in this pack. When a task depends on a version, limit, SKU,
price, API shape, role definition id or configuration key name, retrieve it
live at that moment — preferably through the Microsoft Learn MCP server —
per the live-doc policy in [`../AGENTS.md`](../AGENTS.md). Use of Microsoft
Learn content, including via that MCP server, is governed by the Microsoft
Learn Terms of Use listed below; treat retrieved content as read-only
reference.

Volatility legend: **V** volatile (re-check ~monthly) · **R** versioned
(re-check ~half-yearly) · **S** stable (~yearly).

**⚙ marks an entry that also carries a `versionProbe`** — a bounded,
machine-readable check of that dependency's primary registry, alongside (not
instead of) the human-readable page linked here. Probes only open review
work; they never re-pin anything. See
[`../FRESHNESS.md`](../FRESHNESS.md#version-probes) for the anchors, how each
was established, and the open review items.

## Agent conventions and skill format

| Source | id | |
| --- | --- | --- |
| [AGENTS.md convention](https://agents.md/) | `agents-md-convention` | R |
| [Agent Skills specification](https://agentskills.io/specification) | `agent-skills-spec` | V |
| [Agent Skills overview (Anthropic)](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) | `agent-skills-overview-anthropic` | V |
| [Model Context Protocol](https://modelcontextprotocol.io/) | `model-context-protocol-spec` | V |

## Agent tooling this pack targets

| Source | id | |
| --- | --- | --- |
| [GitHub Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions) | `github-copilot-repository-instructions-docs` | V |
| [VS Code agent customization](https://code.visualstudio.com/docs/agent-customization/custom-instructions) | `vscode-agent-customization-docs` | V |
| [VS Code Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills) | `vscode-agent-skills-docs` | V |
| [VS Code MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers) | `vscode-mcp-server-docs` | V |
| [Claude Code memory files](https://code.claude.com/docs/en/memory) | `claude-code-memory-docs` | V |
| [Claude Code skills](https://code.claude.com/docs/en/skills) | `claude-code-skills-docs` | V |
| [OpenAI Codex documentation: AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | `openai-codex-docs` | V |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `gemini-cli-repo` | V |
| [Gemini CLI context files](https://geminicli.com/docs/cli/gemini-md/) | `gemini-cli-context-file-docs` | V |
| [Gemini CLI Agent Skills](https://geminicli.com/docs/cli/skills/) | `gemini-cli-skills-docs` | V |

## Microsoft Learn MCP and terms

| Source | id | |
| --- | --- | --- |
| [Microsoft Learn MCP server](https://learn.microsoft.com/en-us/training/support/mcp) | `microsoft-learn-mcp-docs` | V |
| [Microsoft Learn MCP developer reference](https://learn.microsoft.com/en-us/training/support/mcp-developer-reference) | `microsoft-learn-mcp-developer-reference` | V |
| [Microsoft Learn MCP repository](https://github.com/MicrosoftDocs/mcp) | `microsoft-docs-mcp-repo` | V |
| [Microsoft Learn Terms of Use](https://learn.microsoft.com/en-us/legal/termsofuse) | `microsoft-learn-terms-of-use` | R |

## Web client — `react-vite-feature-slice`

| Source | id | |
| --- | --- | --- |
| [React 19 release announcement](https://react.dev/blog/2024/12/05/react-19) | `react-19-release-notes` ⚙ | R |
| [React API reference](https://react.dev/reference/react) | `react-api-reference` | V |
| [TypeScript release notes](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html) | `typescript-release-notes` ⚙ | R |
| [TSConfig reference](https://www.typescriptlang.org/tsconfig/) | `typescript-tsconfig-reference` | V |
| [Vite build guide](https://vite.dev/guide/build) | `vite-build-guide` ⚙ | V |
| [Vite env and modes](https://vite.dev/guide/env-and-mode) | `vite-env-and-mode-guide` | V |

## API — `aspnetcore-endpoint-slice`

| Source | id | |
| --- | --- | --- |
| [Minimal APIs overview](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/overview) | `aspnetcore-minimal-apis-overview` | V |
| [OpenAPI in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/aspnetcore-openapi) | `aspnetcore-openapi-docs` | V |
| [CORS in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/security/cors) | `aspnetcore-cors-docs` | V |
| [JWT bearer authentication](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication) | `aspnetcore-jwt-bearer-docs` | V |
| [Configuration in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/) | `aspnetcore-configuration-docs` | V |
| [.NET releases and support](https://learn.microsoft.com/en-us/dotnet/core/releases-and-support) | `dotnet-releases-and-support` ⚙ | V |
| [`dotnet publish`](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-publish) | `dotnet-publish-cli` | V |

## Data — `efcore-azuresql-change`

| Source | id | |
| --- | --- | --- |
| [EF Core documentation](https://learn.microsoft.com/en-us/ef/core/) | `ef-core-docs` | V |
| [What's new in EF Core 9](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-9.0/whatsnew) | `ef-core-9-whats-new` ⚙ | R |
| [EF Core .NET CLI reference](https://learn.microsoft.com/en-us/ef/core/cli/dotnet) | `ef-core-dotnet-cli-reference` | V |
| [Azure SQL Entra authentication](https://learn.microsoft.com/en-us/azure/azure-sql/database/authentication-aad-overview) | `azure-sql-entra-authentication` | V |
| [SqlClient Entra authentication](https://learn.microsoft.com/en-us/sql/connect/ado-net/sql/azure-active-directory-authentication) | `sqlclient-entra-authentication` | V |
| [Azure SQL security best practices](https://learn.microsoft.com/en-us/azure/azure-sql/database/security-best-practice) | `azure-sql-security-best-practices` | V |

## Infrastructure — `bicep-infra-change`

| Source | id | |
| --- | --- | --- |
| [Bicep overview](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/overview) | `bicep-overview` ⚙ | V |
| [Bicep best practices](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/best-practices) | `bicep-best-practices` | V |
| [Bicep modules](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/modules) | `bicep-modules` | V |
| [Bicep linter](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/linter) | `bicep-linter` | V |
| [Deploy Bicep with the Azure CLI](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/deploy-cli) | `bicep-deploy-cli` | V |
| [Deployment what-if](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-what-if) | `arm-deployment-what-if` | V |

## Identity — `entra-managed-identity-wiring`

| Source | id | |
| --- | --- | --- |
| [Managed identities overview](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview) | `managed-identities-overview` | V |
| [Manage user-assigned managed identities](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/how-manage-user-assigned-managed-identities) | `user-assigned-managed-identities-howto` | V |
| [Azure Identity client library for .NET](https://learn.microsoft.com/en-us/dotnet/api/overview/azure/identity-readme) | `azure-identity-dotnet-readme` | V |
| [Azure built-in roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles) | `azure-rbac-built-in-roles` | V |
| [GitHub Actions to Azure with OIDC](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect) | `github-actions-azure-oidc` | V |
| [Protected web API scenario](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-protected-web-api-overview) | `entra-protected-web-api-scenario` | V |

## Hosting and release — `azure-appservice-deploy`, `release-staging-to-production`

| Source | id | |
| --- | --- | --- |
| [App Service managed identity](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity) | `app-service-managed-identity` | V |
| [Deployment slots](https://learn.microsoft.com/en-us/azure/app-service/deploy-staging-slots) | `app-service-deployment-slots` | V |

> The deployment-slots entry backs a **conditional note only**. The topology
> this pack describes uses two separate App Services on one shared plan and
> does **not** use slots. It is kept so that, if a consuming repository turns
> out to use them, current slot and swap semantics can be retrieved rather
> than assumed.
| [Configure App Service apps](https://learn.microsoft.com/en-us/azure/app-service/configure-common) | `app-service-configure-common` | V |
| [Key Vault references](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references) | `app-service-key-vault-references` | V |
| [Configure a .NET app for App Service](https://learn.microsoft.com/en-us/azure/app-service/configure-language-dotnetcore) | `app-service-dotnet-configuration` | V |
| [Deploy to App Service with GitHub Actions](https://learn.microsoft.com/en-us/azure/app-service/deploy-github-actions) | `app-service-deploy-github-actions` | V |
| [`Azure/login` action](https://github.com/Azure/login) | `azure-login-action` | V |
| [`Azure/webapps-deploy` action](https://github.com/Azure/webapps-deploy) | `azure-webapps-deploy-action` | V |
| [GitHub Actions `GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) | `github-actions-token-auth-docs` | V |

## Observability — `appinsights-telemetry-and-triage`

| Source | id | |
| --- | --- | --- |
| [Application Insights OpenTelemetry observability overview](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview) | `application-insights-overview` | V |
| [Application Insights for ASP.NET Core](https://learn.microsoft.com/en-us/azure/azure-monitor/app/asp-net-core) | `application-insights-aspnetcore` | V |
| [Enable Azure Monitor OpenTelemetry](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable) | `azure-monitor-opentelemetry-enable` | V |
| [Distributed tracing and telemetry correlation](https://learn.microsoft.com/en-us/azure/azure-monitor/app/distributed-trace-data) | `application-insights-distributed-tracing` | V |
| [Log queries in Azure Monitor](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/log-query-overview) | `azure-monitor-log-query-overview` | V |
| [Telemetry sampling](https://learn.microsoft.com/en-us/azure/azure-monitor/app/sampling-classic-api) | `application-insights-sampling` | V |
| [Custom events and metrics](https://learn.microsoft.com/en-us/azure/azure-monitor/app/api-custom-events-metrics) | `application-insights-custom-events-metrics` | V |

## Security — `secure-by-design-review`

| Source | id | |
| --- | --- | --- |
| [Well-Architected Framework: Security](https://learn.microsoft.com/en-us/azure/well-architected/security/) | `azure-well-architected-security` | V |
| [Azure SQL security best practices](https://learn.microsoft.com/en-us/azure/azure-sql/database/security-best-practice) | `azure-sql-security-best-practices` | V |
| [Managed identities overview](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview) | `managed-identities-overview` | V |

## Pack tooling and licensing

| Source | id | |
| --- | --- | --- |
| [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) | `keep-a-changelog-format` | R |
| [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) | `semantic-versioning-spec` | S |
| [MIT licence canonical text (SPDX)](https://github.com/spdx/license-list-data/blob/main/text/MIT.txt) | `mit-license-reference` | S |
| [`gh issue create`](https://cli.github.com/manual/gh_issue_create) | `gh-cli-issue-manual` | V |

## Maintaining this list

1. Add the source to `../sources.json` first — that file is machine-checked.
2. Add the row here with the same id, so a reader can trace a link to its
   review record.
3. If the dependency publishes a primary machine-readable registry, add a
   `versionProbe` to the same entry and mark the row ⚙. Set `testedVersion`
   to the exact version the pack's content is coordinated to — never to
   "whatever is newest" as a way of silencing an alert.
4. Run `npm run freshness:check` (and `npm run freshness:check:network`
   when online).
5. Never paste a source's content into this repository. A probe's registry
   response is the one bounded exception, and only a version string survives
   it.

// examples/bicep-managed-identity/main.bicep
//
// Joshua Stewart Cloud Context Pack - illustrative example. MIT licensed,
// original content. NOT copied from vendor documentation and NOT derived
// from any private codebase.
//
// What this shows: an App Service that reaches Azure SQL and Application
// Insights using a user-assigned managed identity, with no password, key,
// connection secret, or secret output anywhere.
//
// TOPOLOGY: staging and production are TWO SEPARATE App Services that SHARE
// ONE App Service plan. There are NO deployment slots here - the plan tier
// this was written for does not include them, so promotion is a deploy to
// the second app, not a swap. The plan resource is intentionally named from
// the workload alone (no environment suffix) so that deploying this template
// once per environment converges on a single shared plan.
//
// If a consuming repository really does use slots, do not copy this shape:
// inspect that repository's plan tier and slot configuration and retrieve
// current slot semantics live. Never assume slots exist.
//
// What this is NOT: a production-ready template. It is deliberately small,
// omits networking/private endpoints/backup/diagnostic settings, and pins
// api versions that WILL age. Before adapting it, retrieve current api
// versions, SKUs and role definition ids live - see references/links.md
// and the live-doc policy in AGENTS.md.
//
// Mechanically checkable with:
//   bicep build examples/bicep-managed-identity/main.bicep --stdout
//   bicep lint  examples/bicep-managed-identity/main.bicep

targetScope = 'resourceGroup'

@description('Short workload prefix used to derive resource names.')
@minLength(2)
@maxLength(10)
param workload string

@description('Environment name. Drives naming only - never behaviour.')
@allowed([
  'staging'
  'production'
])
param environmentName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('SKU of the App Service plan shared by the staging and production apps. Must be identical in every environment parameter file, because both apps share one plan.')
param appServicePlanSku string = 'B1'

@description('Entra object id of the group administering the SQL server.')
param sqlAdminObjectId string

@description('Display name for the SQL Entra administrator principal.')
param sqlAdminLogin string

// Deterministic, globally-unique-safe names. Never hardcode these.
var suffix = uniqueString(resourceGroup().id, workload, environmentName)
var namePrefix = toLower('${workload}-${environmentName}')

// No environment segment: both environments deploy the SAME plan resource,
// so the second deployment is a no-op against the shared plan.
var planName = toLower('${workload}-plan')

var identityName = '${namePrefix}-id'
var siteName = '${namePrefix}-web-${suffix}'
var sqlServerName = '${namePrefix}-sql-${suffix}'
var sqlDatabaseName = '${workload}db'
var insightsName = '${namePrefix}-ai'

// ---------------------------------------------------------------------
// Identity
//
// User-assigned, so it can be granted access BEFORE the app exists and
// survives recreation of the app. One identity per environment: staging
// must never hold credentials that reach production.
// ---------------------------------------------------------------------

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
}

// ---------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: insightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ---------------------------------------------------------------------
// Data
//
// The SQL server has NO administratorLogin / administratorLoginPassword.
// Entra-only authentication removes the password from existence rather
// than hiding it.
// ---------------------------------------------------------------------

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    primaryUserAssignedIdentityId: identity.id
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: 'Group'
      login: sqlAdminLogin
      sid: sqlAdminObjectId
      tenantId: subscription().tenantId
      azureADOnlyAuthentication: true
    }
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 1
  }
  properties: {
    zoneRedundant: false
  }
}

// ---------------------------------------------------------------------
// Hosting
//
// One plan, shared by both environments' apps. Sizing is a parameter, not
// an environment branch, precisely because the plan is shared - a
// per-environment SKU here would make the two deployments fight.
// ---------------------------------------------------------------------

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: {
    name: appServicePlanSku
  }
  properties: {
    reserved: false
  }
}

// One App Service per environment. Deploying this template with
// environmentName 'staging' and again with 'production' yields two separate
// apps on the single plan above. No slot resource is declared, deliberately.
resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: siteName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/healthz'
      netFrameworkVersion: 'v9.0'
      appSettings: [
        // Not a secret: a connection string with no credential in it. The
        // token comes from the managed identity at runtime.
        {
          name: 'ConnectionStrings__AppDb'
          value: 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Database=${sqlDatabaseName};Authentication=Active Directory Default;User Id=${identity.properties.clientId};Encrypt=True;'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: insights.properties.ConnectionString
        }
        // Makes the credential chain unambiguous when more than one
        // identity is attached.
        {
          name: 'AZURE_CLIENT_ID'
          value: identity.properties.clientId
        }
        {
          name: 'ASPNETCORE_ENVIRONMENT'
          value: environmentName
        }
      ]
    }
  }
}

// ---------------------------------------------------------------------
// Access
//
// Deterministic assignment name over (scope, principal, role) so a
// re-deployment is idempotent instead of conflicting. The role id is a
// parameter-free reference to a built-in role: VERIFY THE CURRENT ID LIVE
// rather than trusting this literal.
// ---------------------------------------------------------------------

@description('Built-in role definition id granting read access to monitoring data.')
var monitoringReaderRoleId = '43d0d8ad-25c7-4714-9337-8ba259a9fe05'

resource monitoringReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: insights
  name: guid(insights.id, identity.id, monitoringReaderRoleId)
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringReaderRoleId)
  }
}

// ---------------------------------------------------------------------
// Outputs
//
// Names and hostnames only. NEVER a key, password, token or the
// Application Insights connection string - deployment outputs are readable
// by anyone with reader access to the deployment history.
// ---------------------------------------------------------------------

output siteName string = site.name
output siteHostName string = site.properties.defaultHostName
output appServicePlanName string = plan.name
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output managedIdentityClientId string = identity.properties.clientId
output managedIdentityPrincipalId string = identity.properties.principalId
output applicationInsightsName string = insights.name

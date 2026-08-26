// examples/bicep-managed-identity/staging.bicepparam
//
// Illustrative parameter file. Environments differ by VALUES only - the
// same main.bicep deploys to every environment. Contains no credential.
// The object id below is a deliberate all-zero placeholder, not a real
// directory object.
//
// appServicePlanSku MUST match the production parameter file: staging and
// production are separate App Services sharing ONE plan, so a differing SKU
// here would make the two deployments fight over the same resource.

using './main.bicep'

param workload = 'contosoapp'
param environmentName = 'staging'
param appServicePlanSku = 'B1'
param sqlAdminObjectId = '00000000-0000-0000-0000-000000000000'
param sqlAdminLogin = 'sql-admins-staging'

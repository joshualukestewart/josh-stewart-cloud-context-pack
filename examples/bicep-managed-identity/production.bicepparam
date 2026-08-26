// examples/bicep-managed-identity/production.bicepparam
//
// Same template, different values. Note that nothing here changes the
// SHAPE of the deployment - only naming-relevant inputs. The object id
// below is a deliberate all-zero placeholder, not a real directory object.
//
// appServicePlanSku MUST match the staging parameter file: staging and
// production are separate App Services sharing ONE plan. That plan tier
// does not include deployment slots, which is why promotion is a deploy to
// this app rather than a swap.

using './main.bicep'

param workload = 'contosoapp'
param environmentName = 'production'
param appServicePlanSku = 'B1'
param sqlAdminObjectId = '00000000-0000-0000-0000-000000000000'
param sqlAdminLogin = 'sql-admins-production'

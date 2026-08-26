@description('Environment short name, e.g. dev, stg, prd.')
param environmentName string

@description('Deployment location for all resources.')
param location string = resourceGroup().location

@description('Base name used to derive resource names.')
param baseName string

var planName = '${baseName}-${environmentName}-plan'
var siteName = '${baseName}-${environmentName}-web'
var storageName = toLower(replace('${baseName}${environmentName}sa', '-', ''))

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: {
    name: 'P0v3'
    tier: 'Premium0V3'
  }
  properties: {
    reserved: true
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    allowSharedKeyAccess: false
  }
}

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: siteName
  location: location
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|8.0'
      appSettings: [
        {
          name: 'ASPNETCORE_ENVIRONMENT'
          value: environmentName
        }
      ]
    }
  }
}

output siteDefaultHostName string = site.properties.defaultHostName
output storageAccountName string = storage.name

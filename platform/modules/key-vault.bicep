// [HNI-CRED-04] Key Vault is the credential store. This module creates no secrets.
// [HNI-NET-03] dev-public waiver W-002: default deny, listed IPs only, bypass none.
// [HNI-INFRA-03] Callers use managed identity. Access policies are not used.

param location string
param name string
param tenantId string
param allowedIps array
param publicAccess bool
param logAnalyticsId string
param tags object

var ipRules = [for ip in allowedIps: {
  value: '${ip}/32'
}]

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: publicAccess ? 'Enabled' : 'Disabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'None'
      ipRules: ipRules
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: vault
  properties: {
    workspaceId: logAnalyticsId
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

output id string = vault.id
output name string = vault.name
output uri string = vault.properties.vaultUri

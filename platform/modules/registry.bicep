// [HNI-CICD-02] Images for this platform stay in this registry.
// [HNI-CICD-10] Workloads pull from this registry, not from a public registry.
// [HNI-NET-03] dev-public waiver W-002: specific IPs, default deny, no Allow Azure services.
// [HNI-CRED-01] Admin user is off. No registry password exists.

param location string
param name string
param allowedIps array
param publicAccess bool
param logAnalyticsId string
param tags object

var ipRules = [for ip in allowedIps: {
  action: 'Allow'
  value: '${ip}/32'
}]

// 2025-11-01 is the stable contract that includes anonymousPullEnabled and roleAssignmentMode.
resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Premium'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: publicAccess ? 'Enabled' : 'Disabled'
    anonymousPullEnabled: false
    // Entra repository ABAC. deploy-dev.ps1 also sets this if a registry is found without it.
    roleAssignmentMode: 'AbacRepositoryPermissions'
    networkRuleSet: {
      defaultAction: 'Deny'
      ipRules: ipRules
    }
    policies: {
      // [HNI-CRED-01] Do not leave an export path that bypasses Entra.
      exportPolicy: {
        status: 'disabled'
      }
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: registry
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

output id string = registry.id
output name string = registry.name
output loginServer string = registry.properties.loginServer

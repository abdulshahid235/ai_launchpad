// [HNI-DB-01] PostgreSQL Flexible Server. No password is created.
// [HNI-DB-04] Applications will use DATABASE_URL later. It is not set in this module.
// [HNI-NET-03] dev-public waiver W-002: one firewall rule per IP, start equals end.
// [HNI-NET-08] Azure Flexible Server enforces TLS. sslmode=disable is not configured.

param location string
param name string
param tenantId string
param adminObjectId string
param adminPrincipalName string
@allowed([
  'User'
  'Group'
  'ServicePrincipal'
])
param adminPrincipalType string
param allowedIps array
param publicAccess bool
param backupRetentionDays int
param highAvailabilityEnabled bool
param logAnalyticsId string
param tags object

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenantId
    }
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: highAvailabilityEnabled ? 'ZoneRedundant' : 'Disabled'
    }
    network: {
      publicNetworkAccess: publicAccess ? 'Enabled' : 'Disabled'
    }
    maintenanceWindow: {
      customWindow: 'Disabled'
    }
  }
}

resource admin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: server
  name: adminObjectId
  properties: {
    principalName: adminPrincipalName
    principalType: adminPrincipalType
    tenantId: tenantId
  }
}

resource firewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = [for (ip, i) in allowedIps: if (publicAccess) {
  parent: server
  name: 'ip-${i}'
  properties: {
    startIpAddress: ip
    endIpAddress: ip
  }
}]

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: server
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

output id string = server.id
output name string = server.name
output fqdn string = server.properties.fullyQualifiedDomainName

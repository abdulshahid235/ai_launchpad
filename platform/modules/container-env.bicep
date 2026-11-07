// [HNI-INFRA-01] Container Apps is the compute platform.
// [HNI-AUDIT-04] Console logs go to Log Analytics through diagnostics, not a workspace key.
// [HNI-CRED-01] The Log Analytics shared key is not a parameter and is not written here.
// [HNI-NET-02] VNet injection is a second resource, used only when a subnet id is supplied.

param location string
param name string
param logAnalyticsId string
param infrastructureSubnetId string
param tags object

var logs = {
  appLogsConfiguration: {
    destination: 'azure-monitor'
  }
  zoneRedundant: false
}

resource environmentPublic 'Microsoft.App/managedEnvironments@2024-03-01' = if (empty(infrastructureSubnetId)) {
  name: name
  location: location
  tags: tags
  properties: logs
}

resource environmentPrivate 'Microsoft.App/managedEnvironments@2024-03-01' = if (!empty(infrastructureSubnetId)) {
  name: name
  location: location
  tags: tags
  properties: union(logs, {
    vnetConfiguration: {
      infrastructureSubnetId: infrastructureSubnetId
    }
  })
}

resource diagnosticsPublic 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (empty(infrastructureSubnetId)) {
  name: 'to-log-analytics'
  scope: environmentPublic
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

resource diagnosticsPrivate 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (!empty(infrastructureSubnetId)) {
  name: 'to-log-analytics'
  scope: environmentPrivate
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

output id string = empty(infrastructureSubnetId) ? environmentPublic.id : environmentPrivate.id
output name string = name
output defaultDomain string = empty(infrastructureSubnetId) ? environmentPublic!.properties.defaultDomain : environmentPrivate!.properties.defaultDomain
output staticIp string = empty(infrastructureSubnetId) ? environmentPublic!.properties.staticIp : environmentPrivate!.properties.staticIp

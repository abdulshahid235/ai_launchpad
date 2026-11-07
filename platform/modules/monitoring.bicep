// [HNI-AUDIT-03] Retention is a parameter set at design time, not an open-ended workspace.
// [HNI-AUDIT-04] Platform logs go to this workspace.

param location string
param name string
param retentionInDays int
param tags object

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

output id string = workspace.id
output name string = workspace.name
output customerId string = workspace.properties.customerId

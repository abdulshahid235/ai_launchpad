// [HNI-INFRA-03] Contributor is limited to the tenant resource group. Not the platform group.

targetScope = 'resourceGroup'

param pipelinePrincipalId string

resource contributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, pipelinePrincipalId, 'contributor')
  properties: {
    // Built-in Contributor, scoped to this resource group only.
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')
    principalId: pipelinePrincipalId
    principalType: 'ServicePrincipal'
    description: 'Tenant pipeline deploys only inside this resource group'
  }
}

output contributorAssignmentId string = contributor.id

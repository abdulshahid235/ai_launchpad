// [HNI-INFRA-01] Waiver W-004: role assignments in the dev subscription.
// onboard-tenant.ps1 creates the tenant resource group. This file does not.
// [HNI-CRED-05] The pipeline principal is supplied. This file does not create a secret.
// [HNI-INFRA-03] Contributor is limited to the tenant resource group. Not the platform group.

targetScope = 'subscription'

// The script creates the group and applies location and tags. These parameters
// stay so that script's parameter file still matches.
#disable-next-line no-unused-params
param location string
param tenantResourceGroupName string
param platformResourceGroupName string
param acrName string
param pipelinePrincipalId string
param repositoryName string
param appIdentityPrincipalId string
param containerEnvironmentName string
param environmentJoinRoleName string
#disable-next-line no-unused-params
param tags object

// The script creates this group before this deployment, because the app identity
// has to exist in it before the registry grant.
resource tenantRg 'Microsoft.Resources/resourceGroups@2024-03-01' existing = {
  name: tenantResourceGroupName
}

module contributor 'tenant-contributor.bicep' = {
  name: 'tenant-contributor'
  scope: tenantRg
  params: {
    pipelinePrincipalId: pipelinePrincipalId
  }
}

// [HNI-INFRA-03] No built-in role has join without write on the environment or its apps.
// One custom role per platform resource group, shared by every tenant.
// az containerapp update GETs the environment, then patches the app. The GET is
// Microsoft.App/managedEnvironments/read. join/action is the separate linked check.
resource environmentJoinRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(subscription().id, platformResourceGroupName, 'aca-environment-join')
  properties: {
    roleName: environmentJoinRoleName
    description: 'Read this managed environment and attach a container app to it. Nothing else.'
    type: 'CustomRole'
    permissions: [
      {
        actions: [
          'Microsoft.App/managedEnvironments/read'
          'Microsoft.App/managedEnvironments/join/action'
        ]
        notActions: []
      }
    ]
    assignableScopes: [
      '${subscription().id}/resourceGroups/${platformResourceGroupName}'
    ]
  }
}

module repositoryRole 'acr-repo-role.bicep' = {
  name: 'repository-role'
  scope: resourceGroup(platformResourceGroupName)
  params: {
    acrName: acrName
    principalId: pipelinePrincipalId
    repositoryName: repositoryName
    appIdentityPrincipalId: appIdentityPrincipalId
    containerEnvironmentName: containerEnvironmentName
    environmentJoinRoleId: environmentJoinRole.id
  }
}

output tenantResourceGroupName string = tenantRg.name
output contributorAssignmentId string = contributor.outputs.contributorAssignmentId
output environmentJoinRoleId string = environmentJoinRole.id
output repositoryRoleAssignmentId string = repositoryRole.outputs.roleAssignmentId
output repositoryReaderAssignmentId string = repositoryRole.outputs.readerAssignmentId
output environmentJoinAssignmentId string = repositoryRole.outputs.environmentJoinAssignmentId

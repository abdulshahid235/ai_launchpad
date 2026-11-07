// [HNI-CRED-08] Push rights cover one repository name, not the registry.
// [HNI-CICD-02] The pipeline still pushes only to this ACR.
// Roles: Container Registry Repository Writer (pipeline) and Reader (app identity).
// Entra ABAC, GA since 2025-11-06. Each condition lists every data action of its
// role (Writer: content and metadata read and write. Reader: content and metadata
// read), so no action of either role is left registry-wide.
// This module also holds the tenant's one grant on the shared Container Apps
// environment, because that environment lives in this resource group.

param acrName string
param principalId string
param repositoryName string
param appIdentityPrincipalId string
param containerEnvironmentName string
param environmentJoinRoleId string

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: containerEnvironmentName
}

resource writer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, principalId, repositoryName, 'repository-writer')
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2a1e307c-b015-4ebd-883e-5b7698a07328')
    principalId: principalId
    principalType: 'ServicePrincipal'
    conditionVersion: '2.0'
    description: 'Push and pull one repository only'
    condition: '((!(ActionMatches{\'Microsoft.ContainerRegistry/registries/repositories/content/read\'}) AND !(ActionMatches{\'Microsoft.ContainerRegistry/registries/repositories/content/write\'}) AND !(ActionMatches{\'Microsoft.ContainerRegistry/registries/repositories/metadata/read\'}) AND !(ActionMatches{\'Microsoft.ContainerRegistry/registries/repositories/metadata/write\'})) OR (@Request[Microsoft.ContainerRegistry/registries/repositories:name] StringEqualsIgnoreCase \'${repositoryName}\'))'
  }
}

// [HNI-CRED-08] The running app pulls only its own repository, with its managed identity.
resource reader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, appIdentityPrincipalId, repositoryName, 'repository-reader')
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b93aa761-3e63-49ed-ac28-beffa264f7ac')
    principalId: appIdentityPrincipalId
    principalType: 'ServicePrincipal'
    conditionVersion: '2.0'
    description: 'App identity pulls one repository only'
    condition: '((!(ActionMatches{\'Microsoft.ContainerRegistry/registries/repositories/content/read\'}) AND !(ActionMatches{\'Microsoft.ContainerRegistry/registries/repositories/metadata/read\'})) OR (@Request[Microsoft.ContainerRegistry/registries/repositories:name] StringEqualsIgnoreCase \'${repositoryName}\'))'
  }
}

// [HNI-INFRA-03] Read and join on this environment. No Contributor and no write.
resource environmentJoin 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(environment.id, principalId, 'environment-join')
  scope: environment
  properties: {
    roleDefinitionId: environmentJoinRoleId
    principalId: principalId
    principalType: 'ServicePrincipal'
    description: 'Tenant pipeline attaches its container app to the shared environment'
  }
}

output roleAssignmentId string = writer.id
output readerAssignmentId string = reader.id
output environmentJoinAssignmentId string = environmentJoin.id

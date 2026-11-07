// [HNI-INFRA-02] Platform resources are defined here. Nothing in this file is created in the portal.
// [HNI-INFRA-04] Waiver W-001: dev-public omits private endpoints. Production cannot select it.
// [HNI-FIN-01] Tags are applied from parameters, including GLAccount.
// [HNI-FIN-02] GLAccount has no default. A placeholder value fails the deployment.
// [HNI-CRED-02] Subscription id, region, and names come from parameters or the deployment context.

targetScope = 'resourceGroup'

@allowed([
  'dev'
  'qa'
  'prod'
])
param environment string

@allowed([
  'dev-public'
  'private'
])
param networkProfile string

param location string

@minLength(3)
@maxLength(12)
@description('Lowercase letters and digits. Used in globally unique resource names.')
param namePrefix string

param application string
param owner string
param costCenter string
param glAccount string
param repository string
param managedBy string = 'bicep'

@description('Single IPv4 addresses allowed to reach Postgres, Key Vault, and the registry. No CIDR, no 0.0.0.0.')
param allowedDataPlaneIps string[]

@description('Single IPv4 addresses allowed to open container app ingress.')
param allowedIngressIps string[]

@minValue(1)
param logRetentionDays int

@minValue(7)
@maxValue(35)
param backupRetentionDays int

param monthlyBudgetAmount int
param budgetStartDate string
param budgetAlertEmails string[]

param entraTenantId string
param easyAuthClientId string

param postgresAdminObjectId string
param postgresAdminPrincipalName string
@allowed([
  'User'
  'Group'
  'ServicePrincipal'
])
param postgresAdminPrincipalType string

param highAvailabilityEnabled bool = false

@description('Cloud-team subnet for the Container Apps environment. Required when networkProfile is private.')
param acaSubnetId string = ''

@description('Cloud-team subnet for private endpoints. Required when networkProfile is private.')
param privateEndpointSubnetId string = ''

param registryDnsZoneId string = ''
param keyVaultDnsZoneId string = ''
param postgresDnsZoneId string = ''

@description('Deploy the catalog container app. False until apps/catalog:<tag> is in the registry.')
param deployCatalog bool = false

@description('Tag for apps/catalog in the platform registry. Required when deployCatalog is true.')
param catalogImageTag string = ''

@description('Catalog CPU limit. json() in the app module turns 0.5 into a number.')
param catalogCpu string = '0.5'

@description('Catalog memory limit.')
param catalogMemory string = '1Gi'

@description('Catalog token issuer. Empty uses this cloud\'s login endpoint and entraTenantId.')
param entraIssuer string = ''

@description('Catalog token audience. Empty uses easyAuthClientId.')
param entraAudience string = ''

var publicAccess = networkProfile == 'dev-public'
var openDataPlaneIps = filter(allowedDataPlaneIps, ip => ip == '0.0.0.0' || ip == '0.0.0.0/0' || toLower(ip) == 'azureservices')

// [HNI-NET-03] Reject the Allow Azure services firewall and any open address.
// assert compiles only as experimental languageVersion 2.1, which warns on every build.
// Passing checks are empty strings, so the names that append parameterGuards stay the same.
var allowedDataPlaneIpsRejectOpenRules = length(openDataPlaneIps) == 0 ? '' : fail('allowedDataPlaneIps rejects 0.0.0.0, 0.0.0.0/0, and AzureServices.')
var allowedDataPlaneIpsPresent = (!publicAccess || length(allowedDataPlaneIps) > 0) ? '' : fail('allowedDataPlaneIps must contain at least one address when networkProfile is dev-public.')
var allowedIngressIpsPresent = length(allowedIngressIps) > 0 ? '' : fail('allowedIngressIps must contain at least one address.')
var glAccountPresent = (length(trim(glAccount)) >= 4 && toLower(glAccount) != 'changeme' && glAccount != '000000') ? '' : fail('glAccount must be the Finance value. Placeholders are rejected.')
var devPublicIsNotQaOrProd = !(networkProfile == 'dev-public' && (environment == 'qa' || environment == 'prod')) ? '' : fail('networkProfile dev-public cannot be used for qa or prod.')
var privateHasSubnetIds = (networkProfile != 'private' || (length(acaSubnetId) > 0 && length(privateEndpointSubnetId) > 0 && length(registryDnsZoneId) > 0 && length(keyVaultDnsZoneId) > 0 && length(postgresDnsZoneId) > 0)) ? '' : fail('networkProfile private requires subnet and private DNS zone ids.')
var productionHasHighAvailability = (environment != 'prod' || highAvailabilityEnabled) ? '' : fail('prod requires highAvailabilityEnabled.')
var budgetHasARecipient = length(budgetAlertEmails) > 0 ? '' : fail('budgetAlertEmails must contain at least one address.')
var catalogTagPresent = (!deployCatalog || length(trim(catalogImageTag)) > 0) ? '' : fail('catalogImageTag is required when deployCatalog is true.')
var parameterGuards = '${allowedDataPlaneIpsRejectOpenRules}${allowedDataPlaneIpsPresent}${allowedIngressIpsPresent}${glAccountPresent}${devPublicIsNotQaOrProd}${privateHasSubnetIds}${productionHasHighAvailability}${budgetHasARecipient}${catalogTagPresent}'
var catalogAppName = '${namePrefix}-${environment}-catalog'
var catalogRepositoryName = 'apps/catalog'
var catalogIssuer = length(trim(entraIssuer)) > 0 ? entraIssuer : '${az.environment().authentication.loginEndpoint}${entraTenantId}/v2.0'
var catalogAudience = length(trim(entraAudience)) > 0 ? entraAudience : easyAuthClientId

var tags = {
  Application: application
  Environment: environment
  Owner: owner
  CostCenter: costCenter
  GLAccount: glAccount
  ManagedBy: managedBy
  Repository: repository
}

var lawName = '${namePrefix}-${environment}-law'
var acrName = '${namePrefix}${environment}acr'
var vaultName = '${namePrefix}${environment}kv'
var postgresName = '${namePrefix}-${environment}-pg'
var environmentName = '${namePrefix}-${environment}-cae'

resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  // [HNI-FIN-03] Budget and forecast alerts exist before the first deploy spends.
  name: '${namePrefix}-${environment}-monthly${parameterGuards}'
  properties: {
    category: 'Cost'
    amount: monthlyBudgetAmount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      Forecast50: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 50
        thresholdType: 'Forecasted'
        contactEmails: budgetAlertEmails
      }
      Actual80: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: budgetAlertEmails
      }
      Actual100: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: budgetAlertEmails
      }
    }
  }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring${parameterGuards}'
  params: {
    location: location
    name: lawName
    retentionInDays: logRetentionDays
    tags: tags
  }
}

module registry 'modules/registry.bicep' = {
  name: 'registry${parameterGuards}'
  params: {
    location: location
    name: acrName
    allowedIps: publicAccess ? allowedDataPlaneIps : []
    publicAccess: publicAccess
    logAnalyticsId: monitoring.outputs.id
    tags: tags
  }
}

module containerEnv 'modules/container-env.bicep' = {
  name: 'container-env${parameterGuards}'
  params: {
    location: location
    name: environmentName
    logAnalyticsId: monitoring.outputs.id
    infrastructureSubnetId: networkProfile == 'private' ? acaSubnetId : ''
    tags: tags
  }
}

module keyVault 'modules/key-vault.bicep' = {
  name: 'key-vault${parameterGuards}'
  params: {
    location: location
    name: vaultName
    tenantId: entraTenantId
    allowedIps: publicAccess ? allowedDataPlaneIps : []
    publicAccess: publicAccess
    logAnalyticsId: monitoring.outputs.id
    tags: tags
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres${parameterGuards}'
  params: {
    location: location
    name: postgresName
    tenantId: entraTenantId
    adminObjectId: postgresAdminObjectId
    adminPrincipalName: postgresAdminPrincipalName
    adminPrincipalType: postgresAdminPrincipalType
    allowedIps: publicAccess ? allowedDataPlaneIps : []
    publicAccess: publicAccess
    backupRetentionDays: backupRetentionDays
    highAvailabilityEnabled: highAvailabilityEnabled
    logAnalyticsId: monitoring.outputs.id
    tags: tags
  }
}

module privateEndpoints 'modules/private-endpoints.bicep' = if (networkProfile == 'private') {
  name: 'private-endpoints${parameterGuards}'
  params: {
    location: location
    registryId: registry.outputs.id
    keyVaultId: keyVault.outputs.id
    postgresId: postgres.outputs.id
    privateEndpointSubnetId: privateEndpointSubnetId
    registryDnsZoneId: registryDnsZoneId
    keyVaultDnsZoneId: keyVaultDnsZoneId
    postgresDnsZoneId: postgresDnsZoneId
    tags: tags
  }
}

// [HNI-FIN-01] The resource group itself is tagged by deploy-dev.ps1 before this deployment.

// [HNI-CRED-05] Platform-owned catalog identity. Tenants still get theirs from onboard-tenant.ps1.
resource catalogIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (deployCatalog) {
  name: '${catalogAppName}-id'
  location: location
  tags: tags
}

resource catalogRegistry 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = {
  name: acrName
}

resource catalogVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: vaultName
}

// [HNI-CRED-08] Pull one repository. Legacy AcrPull is not honored once repository ABAC is on.
resource catalogRegistryReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployCatalog) {
  name: guid(acrName, catalogAppName, catalogRepositoryName, 'repository-reader')
  scope: catalogRegistry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b93aa761-3e63-49ed-ac28-beffa264f7ac')
    principalId: catalogIdentity!.properties.principalId
    principalType: 'ServicePrincipal'
    conditionVersion: '2.0'
    description: 'Catalog identity pulls ${catalogRepositoryName} from ${registry.outputs.id}'
    condition: '((!(ActionMatches{\'Microsoft.ContainerRegistry/registries/repositories/content/read\'}) AND !(ActionMatches{\'Microsoft.ContainerRegistry/registries/repositories/metadata/read\'})) OR (@Request[Microsoft.ContainerRegistry/registries/repositories:name] StringEqualsIgnoreCase \'${catalogRepositoryName}\'))'
  }
}

// [HNI-CRED-04] Read secrets. The vault uses RBAC, not access policies.
resource catalogSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployCatalog) {
  name: guid(vaultName, catalogAppName, 'secrets-user')
  scope: catalogVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: catalogIdentity!.properties.principalId
    principalType: 'ServicePrincipal'
    description: 'Catalog identity reads secrets in ${keyVault.outputs.id}'
  }
}

module catalog 'modules/container-app.bicep' = if (deployCatalog) {
  name: 'catalog${parameterGuards}'
  params: {
    location: location
    name: catalogAppName
    environmentId: containerEnv.outputs.id
    containerImage: '${registry.outputs.loginServer}/${catalogRepositoryName}:${catalogImageTag}'
    registryLoginServer: registry.outputs.loginServer
    cpu: catalogCpu
    memory: catalogMemory
    allowedIngressIps: allowedIngressIps
    entraTenantId: entraTenantId
    easyAuthClientId: easyAuthClientId
    easyAuthSecretUri: '${keyVault.outputs.uri}secrets/easy-auth-client-secret'
    databaseUrlSecretUri: '${keyVault.outputs.uri}secrets/database-url'
    entraIssuer: catalogIssuer
    entraAudience: catalogAudience
    appEnv: environment
    identityResourceId: catalogIdentity!.id
    grantsReady: '${catalogRegistryReader!.id}${catalogSecretsUser!.id}'
    tags: tags
  }
}

output acrName string = registry.outputs.name
output acrLoginServer string = registry.outputs.loginServer
output acaEnvironmentName string = containerEnv.outputs.name
output acaDefaultDomain string = containerEnv.outputs.defaultDomain
output acaStaticIp string = containerEnv.outputs.staticIp
output keyVaultName string = keyVault.outputs.name
output postgresName string = postgres.outputs.name
output postgresFqdn string = postgres.outputs.fqdn
output logAnalyticsName string = monitoring.outputs.name
output allowedIngressIps array = allowedIngressIps
output easyAuthClientId string = easyAuthClientId
output networkProfile string = networkProfile
output budgetName string = budget.name
output catalog_url string = deployCatalog ? 'https://${catalog!.outputs.fqdn}' : ''

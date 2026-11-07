// [HNI-NET-11] Waiver W-003: public ingress is allowed only with Easy Auth and an IP allow list.
// [HNI-AUTH-01] Entra ID at the edge. The application must still validate tokens itself.
// [HNI-CRED-04] The Easy Auth client secret is a Key Vault reference, never a template value.
// [HNI-INFRA-03] The app identity reads that secret. No client secret for Key Vault.
// [HNI-INFRA-05] Scale-to-zero. The app is stateless.
// [HNI-DB-04] DATABASE_URL is a Key Vault reference. The secret value is not a parameter.

param location string
param name string
param environmentId string
param containerImage string
param registryLoginServer string
param cpu string
param memory string
param allowedIngressIps array
param entraTenantId string
param easyAuthClientId string
param easyAuthSecretUri string
param databaseUrlSecretUri string
param entraIssuer string
param entraAudience string
@description('Resource id of the <name>-id identity the caller created. Orders this module after that identity.')
param identityResourceId string
@description('Role assignment ids. Referenced so the app waits until those grants exist. The app name does not change.')
param grantsReady string
param tags object

@description('Runtime APP_ENV. Callers set local, dev, qa, or prod. There is no default.')
@allowed([
  'local'
  'dev'
  'qa'
  'prod'
])
param appEnv string

// [HNI-CRED-05] The identity onboard-tenant.ps1 creates. Name is '<container app name>-id'.
resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: '${name}-id'
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${name}${length(grantsReady) >= 0 ? '' : ''}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityResourceId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        // [HNI-NET-11] Allow rules only. Unlisted addresses are denied.
        ipSecurityRestrictions: [for (ip, i) in allowedIngressIps: {
          name: 'allow-${i}'
          action: 'Allow'
          ipAddressRange: '${ip}/32'
        }]
      }
      secrets: [
        {
          name: 'easy-auth-client-secret'
          keyVaultUrl: easyAuthSecretUri
          identity: identityResourceId
        }
        {
          name: 'database-url'
          keyVaultUrl: databaseUrlSecretUri
          identity: identityResourceId
        }
      ]
      // [HNI-CRED-05] Pull with this app's user-assigned identity. No registry password.
      registries: [
        {
          server: registryLoginServer
          identity: identityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: name
          image: containerImage
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: [
            {
              name: 'APP_ENV'
              value: appEnv
            }
            {
              name: 'DATABASE_URL'
              secretRef: 'database-url'
            }
            {
              name: 'AZURE_TENANT_ID'
              value: entraTenantId
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: entraAudience
            }
            {
              name: 'AZURE_ISSUER'
              value: entraIssuer
            }
            {
              name: 'AZURE_AUDIENCE'
              value: entraAudience
            }
            {
              // Browser client id. Read at request time. A NEXT_PUBLIC_* value would be baked into the image.
              name: 'AZURE_SPA_CLIENT_ID'
              value: easyAuthClientId
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

resource auth 'Microsoft.App/containerApps/authConfigs@2024-03-01' = {
  parent: app
  name: 'current'
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
      // The browser reads tenant and client ids here before Easy Auth. The route returns no secrets.
      excludedPaths: [
        '/api/config'
      ]
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          openIdIssuer: '${environment().authentication.loginEndpoint}${entraTenantId}/v2.0'
          clientId: easyAuthClientId
          clientSecretSettingName: 'easy-auth-client-secret'
        }
        validation: {
          allowedAudiences: [
            easyAuthClientId
          ]
        }
      }
    }
  }
}

output id string = app.id
output name string = app.name
output identityPrincipalId string = appIdentity.properties.principalId
output fqdn string = app.properties.configuration.ingress.fqdn

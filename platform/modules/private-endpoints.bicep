// [HNI-NET-03] Used only when networkProfile is private. Not deployed by dev-public.
// [HNI-NET-01] Subnet ids are inputs. This module does not create a VNet.
// [HNI-NET-04] Private DNS zone ids are inputs from the Cloud team.

param location string
param registryId string
param keyVaultId string
param postgresId string
param privateEndpointSubnetId string
param registryDnsZoneId string
param keyVaultDnsZoneId string
param postgresDnsZoneId string
param tags object

resource registryEndpoint 'Microsoft.Network/privateEndpoints@2024-01-01' = {
  name: 'pe-registry'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'registry'
        properties: {
          privateLinkServiceId: registryId
          groupIds: [
            'registry'
          ]
        }
      }
    ]
  }
}

resource registryDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: registryEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'registry'
        properties: {
          privateDnsZoneId: registryDnsZoneId
        }
      }
    ]
  }
}

resource keyVaultEndpoint 'Microsoft.Network/privateEndpoints@2024-01-01' = {
  name: 'pe-keyvault'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'vault'
        properties: {
          privateLinkServiceId: keyVaultId
          groupIds: [
            'vault'
          ]
        }
      }
    ]
  }
}

resource keyVaultDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: keyVaultEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'vault'
        properties: {
          privateDnsZoneId: keyVaultDnsZoneId
        }
      }
    ]
  }
}

resource postgresEndpoint 'Microsoft.Network/privateEndpoints@2024-01-01' = {
  name: 'pe-postgres'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'postgres'
        properties: {
          privateLinkServiceId: postgresId
          groupIds: [
            'postgresqlServer'
          ]
        }
      }
    ]
  }
}

resource postgresDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: postgresEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'postgres'
        properties: {
          privateDnsZoneId: postgresDnsZoneId
        }
      }
    ]
  }
}

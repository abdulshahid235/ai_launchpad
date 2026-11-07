using '../main.bicep'

// Not deployed in this pass. Requires Cloud-team subnet and private DNS zone ids.
// [HNI-NET-01] Those ids are parameters. This file does not name a VNet to create.

param environment = 'prod'
param networkProfile = 'private'
param managedBy = 'bicep'
param highAvailabilityEnabled = true
param deployCatalog = false
param catalogImageTag = ''

using '../main.bicep'

// [HNI-INFRA-04] Waiver W-001. Do not copy this profile into qa or prod.
// GLAccount, IP lists, budget, owner, and Entra ids are intentionally absent.
// Pass them on the command line. See platform/README.md.

param environment = 'dev'
param networkProfile = 'dev-public'
param managedBy = 'bicep'
param highAvailabilityEnabled = false

// Leave false for the first deploy. Set true and set catalogImageTag after
// apps/catalog:<tag> is in the registry. Secret values do not go in this file.
param deployCatalog = false
param catalogImageTag = ''

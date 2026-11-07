<!-- [HNI-FIN-02] GLAccount is required and is not stored in this file -->
<!-- [HNI-NET-03] Dev firewalls are specific IPs. Dev data is synthetic only -->

# Platform

Admin-owned infrastructure for App Launchpad. Tenant pipelines do not deploy this
folder. Decisions and waiver expiry are in `docs/adr/0001-app-launchpad.md`.

**Dev data is synthetic only.** Do not load production backups, production
databases, or real employee records into this subscription. HNI-PRIV-08 forbids
real personal data in sample data.

## Request a GLAccount

HNI-FIN-02: Finance issues the General Ledger account to the team that pays.
The business owner supplies it. The developer passes it at deploy time. Do not
guess, and do not copy an account from another project.

The standards file `15-finops.md` says Finance has not published the string
format yet, and it does not name a mailbox. Ask Finance through the team's
existing chargeback contact for the account that should pay for App Launchpad
in this environment. If Finance designates a central IT account for this shared
platform, use that value. Until they do, use the account they issued for this team.

The parameter has no default. `deploy-dev.ps1` rejects `changeme`, `000000`,
`todo`, and `tbd`.

## What the dev script creates

Resource group tags, Log Analytics, Premium registry, Container Apps environment,
Key Vault (no secrets), PostgreSQL with Entra sign-in and no password, and a
monthly budget. `modules/registry.bicep` sets the registry role-assignment mode
to `AbacRepositoryPermissions`. The script still sets that mode if a registry
is found without it.

Entra repository ABAC is generally available (announced 2025-11-06), on Basic,
Standard, and Premium. This registry is Premium because IP firewalls and private
endpoints require Premium. Legacy `AcrPush` is not honored once that mode is on.
Tenant push uses Container Registry Repository Writer
(`2a1e307c-b015-4ebd-883e-5b7698a07328`) with a condition on one repository name.

The script is safe to run again. It appends a log under the user temp directory
and does not accept a secret.

## Deploy

Waiver W-004 expires 2027-04-30. After that, do not use this script unless the
waiver is renewed by someone other than the author.

```powershell
cd platform\scripts
.\deploy-dev.ps1 `
  -ResourceGroupName '<rg>' `
  -Location '<region>' `
  -NamePrefix '<3-12 lowercase letters or digits>' `
  -Application 'app-launchpad' `
  -Owner '<owner>' `
  -CostCenter '<cost center>' `
  -GlAccount '<value Finance issued>' `
  -Repository '<git remote url>' `
  -AllowedDataPlaneIps @('<operator ipv4>') `
  -AllowedIngressIps @('<operator ipv4>') `
  -LogRetentionDays 90 `
  -BackupRetentionDays 7 `
  -MonthlyBudgetAmount <whole dollars the business owner approved> `
  -BudgetStartDate '2026-11-01' `
  -BudgetAlertEmails @('<owner email>') `
  -EntraTenantId '<tenant guid>' `
  -EasyAuthClientId '<app registration client id>' `
  -PostgresAdminObjectId '<group or user object id>' `
  -PostgresAdminPrincipalName '<upn or group name>' `
  -PostgresAdminPrincipalType Group `
  -DataClassification synthetic-only
```

`BudgetStartDate` must be the first day of a month and cannot be in the past.
The Easy Auth client secret is not a parameter. Neither is `DATABASE_URL`.
Create Key Vault secrets named `easy-auth-client-secret` and `database-url`
before the catalog app is deployed. The container-app module references them
by URI. Do not put either value in a parameter file.

`appEnv` is the `environment` parameter. `params/dev-public.bicepparam` sets
`dev`.

## Catalog deploy order

The first deploy cannot pull an image that is not in the registry yet.
`deployCatalog` defaults to false, and both parameter files set it to false.

1. Deploy the platform with `deployCatalog=false`.
2. Note the Container Apps static IP from the log. Add that IP to
   `-AllowedDataPlaneIps` and deploy again before any app pulls an image.
   Do not turn on Allow Azure services.
3. Push `apps/catalog:<tag>` to the platform registry.
4. Create the two Key Vault secrets named above. Leave the values out of git.
5. Set `deployCatalog` to `true` and `catalogImageTag` to `<tag>` in the
   parameter file, then deploy again.

That second catalog deploy creates the catalog identity, grants it repository
reader on `apps/catalog` and Key Vault Secrets User, and deploys the app.
The deployment outputs `catalog_url`. CPU defaults to `0.5`, memory to `1Gi`,
and the app may scale to zero.

`params/private.bicepparam` is not deployed in this pass.

## Onboard a tenant

See `scripts/onboard-tenant.md` and `docs/onboarding.md`.

## Checks you can run

These do not create resources.

```powershell
az bicep build --file platform/main.bicep
az bicep build --file platform/modules/tenant-onboarding.bicep
az bicep build --file platform/modules/container-app.bicep
```

After a deploy:

```powershell
az deployment group show -g <rg> -n launchpad-dev --query properties.outputs
az acr show -n <acrName> -g <rg> --query "{sku:sku.name,admin:adminUserEnabled,public:publicNetworkAccess,mode:roleAssignmentMode,defaultAction:networkRuleSet.defaultAction}"
az postgres flexible-server firewall-rule list -g <rg> -n <postgresName> -o table
az keyvault show -n <vaultName> -g <rg> --query "{public:properties.publicNetworkAccess,default:properties.networkAcls.defaultAction,bypass:properties.networkAcls.bypass}"
az containerapp env show -g <rg> -n <acaEnvironmentName> --query "{domain:properties.defaultDomain,staticIp:properties.staticIp}"
```

Confirm the firewall list contains only the IPs you passed, Key Vault bypass is
`None`, the registry admin user is false, and the role-assignment mode is
`AbacRepositoryPermissions`.

Easy Auth and the ingress IP list are defined in `modules/container-app.bicep`.
The catalog app is deployed only when `deployCatalog` is true.

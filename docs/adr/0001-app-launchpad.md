<!-- [HNI-ARCH-02] Decision record written before platform implementation -->
<!-- [HNI-CRED-05] Bitbucket subject changes every run; POC secret is time-boxed -->
<!-- [HNI-AUTH-01] Tenant apps share one sign-in registration -->

# ADR 0001 — App Launchpad platform

**Status:** Accepted for the dev proof of concept
**Date:** 2026-10-27
**Expiry of the four waivers below:** 2027-04-30

## Context

App Launchpad lets an employee deploy an experiment onto a shared Azure Container Apps
environment without rights to change the shared platform. The catalog (a later folder)
is the only writer of the app registry. The platform folder owns the resource group,
Log Analytics, the registry, the Container Apps environment, Key Vault, and PostgreSQL.

The standards library has no proof-of-concept tier. A dev subscription can be deployed
before the Cloud team provides a subnet only by the time-boxed waivers in this record.
Each waiver still needs an approver who is not the author. `GOVERNANCE-WAIVERS.md`
lists them as pending. They are not active approvals.

## Decision

- Host on Azure. Define the platform in Bicep. Parameters carry environment, region,
  names, the Finance-issued `GLAccount`, and IP allow lists. No subscription id and no
  secret is stored in the repository.
- Bitbucket Pipelines is the CI host for the proof of concept. Bitbucket's OIDC
  subject changes every run, so an Azure federated credential cannot be used for
  pipeline login to Azure.
- That login uses one client secret per tenant pipeline app, stored in the secured
  CI variable `AZURE_CLIENT_SECRET`, with a 90-day expiry.
  `platform/scripts/onboard-tenant.ps1` prints the secret once. The repository, the
  onboarding log, and parameter files do not receive it. `deploy-dev.ps1` writes no
  secrets. This is a time-boxed deviation from storing no secrets. It ends when
  pipeline login moves to GitHub Actions with a federated credential, Azure DevOps
  pipelines with workload identity federation, or self-hosted runners with managed
  identity, and each tenant's old secret is deleted.
- A pipeline registers with the catalog by presenting the CI host's OIDC token.
  The catalog binds the app to `(ci_provider, repo_id)`. For Bitbucket, `repo_id`
  is the `repositoryUuid` claim.
- Pipeline files stay thin: they enable the host token, pass CI values through,
  and call scripts. The catalog has one token validator per provider. Onboarding
  takes `-CiProvider`. The steps to leave Bitbucket are in `docs/onboarding.md`.
- PostgreSQL Flexible Server is the store for the platform and the catalog.
  A tenant app may choose MongoDB Atlas only under HNI-DB-01, in that app's own ADR.
- The registry is Premium with role-assignment mode `AbacRepositoryPermissions`
  (Microsoft Entra repository ABAC, generally available since 2025-11-06, all SKUs).
  A tenant pipeline receives Container Registry Repository Writer on one repository
  name, not registry-wide `AcrPush`.
- The dev profile is `networkProfile=dev-public`. The private-endpoint modules stay
  in this repository and are not deployed in this pass. Production parameters cannot
  select `dev-public`.
- Dev data-plane firewalls allow specific IPs only. `0.0.0.0` and Allow Azure
  services are rejected. Data placed in the dev subscription is synthetic only.
- Every container app enables Entra Easy Auth and ingress IP restrictions from a
  parameter. Tenant apps share one sign-in registration and have no user-specific
  access control: any signed-in employee can open any tenant app. The app still
  validates the caller itself when the catalog and template are built. Each tenant
  pipeline keeps its own registration, separate from that shared sign-in
  registration. This pass does not deploy a container app, because there is no
  image yet.
- Recovery for this non-critical dev profile: RTO one business day by redeploying
  Bicep, RPO the PostgreSQL backup retention chosen at deploy time. Zone-redundant
  Postgres and Imperva are deferred to the private profile.

## Alternatives considered

| Alternative | Why it was not chosen |
|---|---|
| Pulumi | HNI-INFRA-02 requires infrastructure as code. It does not require Pulumi. Bicep matches the platform deliverable. |
| Azure Table Storage | Not a supported database platform (HNI-DB-01). |
| Registry-wide `AcrPush` | Lets one tenant push to another tenant's repository. |
| ACR scope-map tokens | Those tokens are stored passwords. Pipeline push uses the tenant pipeline identity and a repository-scoped Writer role. |
| Azure federated credential for a Bitbucket pipeline | The OIDC subject changes every run, so Azure cannot pin a federated credential to it. |
| Client secret in git, a parameter file, or the onboarding log | The value is shown once and kept only in a secured CI variable, for 90 days. |
| Direct Azure OpenAI | Forbidden. Model calls go through the Portkey gateway when the sample app is built. |
| Skip the ADR and rely on the chat | HNI-ARCH-02 requires the record in the repository before implementation. |

## Waivers and the ADR

All four are **a waiver and this ADR**. They are temporary. The ADR is the decision.
The waiver is the time box. Preferred rules do not need a waiver. A NEVER rule cannot
be waived; none of these four is a NEVER rule.

| ID | Standard | Instrument | Expires | What ends the exception |
|---|---|---|---|---|
| W-001 | HNI-INFRA-04 | Waiver and this ADR | 2027-04-30 | Dev is redeployed with `networkProfile=private`, or the waiver is renewed by someone other than the author |
| W-002 | HNI-NET-03 | Waiver and this ADR | 2027-04-30 | Private endpoints replace the public IP firewalls |
| W-003 | HNI-NET-11 | Waiver and this ADR | 2027-04-30 | Imperva is the only public entry and the Container Apps hostname is not a bypass |
| W-004 | HNI-INFRA-01 | Waiver and this ADR | 2027-04-30 | Cloud team owns resource creation, including production |

On 2027-04-30 the dev-public script must stop being used unless those rows are active
waivers with a new expiry. Production is out of scope for all four.

### Conditions that are part of the decision

- **HNI-NET-03.** Firewall rules are single IP addresses. The templates reject
  `0.0.0.0` and any value that means Allow Azure services. Dev databases, Key Vault,
  and the registry hold synthetic data only.
- **HNI-NET-11.** Easy Auth is required on every container app. Ingress allow lists
  are a deployment parameter, not a hardcoded network.
- **HNI-INFRA-01.** `platform/scripts/deploy-dev.ps1` and
  `platform/scripts/onboard-tenant.ps1` are idempotent, append a log of what they
  created or reused, and have no parameter for a secret. `deploy-dev.ps1` writes
  no secrets. `onboard-tenant.ps1` creates the 90-day pipeline client secret and
  does not accept the secret value as a parameter.
- **HNI-CRED-05.** The Bitbucket proof of concept stores that secret only in the
  secured CI variable. The deviation is the secret itself. It is time-boxed by the
  90-day expiry and by the move to a federated credential or a managed identity.
  Replacing the host includes deleting each tenant's old secret.

## Consequences

- Employees cannot open the dev apps from the public internet at large. Their IP
  must be on both the data-plane list and the ingress list.
- Container Apps cannot pull images until the environment's outbound IPs are added
  to the registry allow list and the deployment is run again. The script prints those
  IPs. It does not open the registry to Azure services.
- The catalog and the sample app are not in this change.
- A Bitbucket pipeline cannot sign in to Azure with workload identity federation.
  Each tenant pipeline secret expires after 90 days.
- Catalog registration accepts the CI host token when `(ci_provider, repo_id)`
  matches the approved binding. One validator serves each provider.
- Tenant apps do not keep a per-user allow list. Sign-in is the one shared
  registration.
- Architecture Review Board review (HNI-ARCH-02) is still required before this is
  treated as a production application. That review is not done.

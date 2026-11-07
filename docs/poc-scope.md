<!-- [HNI-INFRA-04] Dev profile is a time-boxed topology difference -->
<!-- [HNI-REQ-06] Deferred work is listed, not silently dropped -->

# Proof-of-concept scope

**Profile:** `dev-public`
**Waiver expiry:** 2027-04-30
**Not a production deploy.**

## In this pass

- Bicep for the resource group contents: Log Analytics, Premium registry with
  Entra repository ABAC, Container Apps environment, Key Vault, PostgreSQL with
  Entra sign-in and no password, a monthly budget, and required tags.
- Public endpoints for Postgres, Key Vault, and the registry, each limited to
  the IP list passed at deploy time. `0.0.0.0` and Allow Azure services fail
  the deployment.
- Parameterized ingress IP list and an Easy Auth container-app module. No
  container app is deployed, because there is no image.
- Idempotent scripts that log created or reused resources and accept no secrets.
- Dev data is synthetic only. See `data-inventory.md`.

## Deferred

| Item | Standard | Who unblocks it |
|---|---|---|
| VNet, subnets, private endpoints, private DNS | HNI-NET-01, HNI-NET-02, HNI-NET-03, HNI-NET-04 | Cloud team and Networking |
| Imperva in front of the app, raw hostname closed | HNI-NET-11 | Networking and SecOps |
| Production identities separate from dev | HNI-CRED-08 | Cloud team, before any production deploy |
| Zone-redundant Postgres, PITR sized for production | HNI-BCDR-01 | Cloud team, with the private profile |
| Portkey Enterprise SSO and the in-VNet gateway | HNI-AIR-01, HNI-INFRA-01 | Gateway owner, before any personal data is sent |
| AI register entry before other people use a model feature | HNI-AILC-01 | Business owner and technical owner |
| Architecture Review Board | HNI-ARCH-02 | Board, before production |
| SecOps review | HNI-SEC-07, HNI-SEC-13 | SecOps, before production |
| Catalog, template, and pipelines | later folders | This repository, after platform review |
| `GLAccount` format check by Azure Policy | HNI-FIN-02 | Finance confirms the string format, then Cloud team policy |

The private profile is `platform/params/private.bicepparam`. Do not deploy it
until subnet ids exist. `deploy-dev.ps1` cannot select it.

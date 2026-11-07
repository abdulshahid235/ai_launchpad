<!-- [HNI-AUTH-08] The requester does not approve their own app -->
<!-- [HNI-AUTH-01] One shared sign-in registration; tenant apps have no user-specific control -->
<!-- [HNI-CRED-05] POC client secret in a secured CI variable; 90-day expiry; no secret in git -->
<!-- [HNI-GIT-01] Repository is created in the HNI Bitbucket workspace -->

# Tenant onboarding

After these steps, the tenant pipeline can update only its container app and push
only its image repository. It has no role on the platform resource group.

The dev-subscription owner runs the script in this pass (waiver W-004, expires
2027-04-30). Production onboarding stays with the Cloud team.

| Step | Who | What |
|---|---|---|
| 1. Request the app name, owner, description, data class, and tier | Tenant developer | Names must match `app.yaml` later. Dev data is synthetic only |
| 2. Approve the request | Platform owner, a different person | HNI-AUTH-08. The requester cannot approve it |
| 3. Create the Bitbucket repository | Tenant developer, confirmed with their team lead | HNI Bitbucket workspace. Branches `development`, `qa`, `main` |
| 4. Create the tenant resource group, the pipeline app, and the 90-day client secret | Dev-subscription owner, via `platform/scripts/onboard-tenant.ps1 -CiProvider bitbucket` | Idempotent. Prints the secret once for the secured variable `AZURE_CLIENT_SECRET`. Does not write it to the log, git, or a parameter file. Adds this app's Easy Auth callback on the shared sign-in registration. Does not grant the pipeline rights on that registration |
| 5. Grant repository Writer and Contributor on the tenant resource group | The same script, after step 2 has produced a principal id | Writer is conditioned to `apps/<name>` only. Contributor is on the tenant resource group only |
| 6. Bind `(ci_provider, repo_id)` to that app name | Platform owner | The pipeline presents the CI host OIDC token. For Bitbucket, `repo_id` is the repository UUID with braces. The onboarding script prints the binding and does not write the catalog database |
| 7. Put the Portkey service-account key in Key Vault | Gateway owner | Not a model-provider key. The dev scripts do not create this secret |
| 8. Issue `GLAccount` and approve the budget | Finance, then the business owner | See `platform/README.md` |
| 9. File the AI register entry before other people use the app | Business owner requests, technical owner fills | `docs/ai-register.md` |

## Bitbucket and Azure login

Bitbucket's OIDC subject changes every run, so it cannot be the subject of an
Azure federated credential. Do not create one for a Bitbucket pipeline.

The proof of concept uses a per-tenant client secret in the secured CI variable
`AZURE_CLIENT_SECRET`. The onboarding default lifetime is 90 days
(`-SecretLifetimeDays`). The operator pastes the value once, from the script's
console output. The repository, parameter files, and the onboarding log do not
hold it.

The same pipeline sends Bitbucket's OIDC token to the catalog. The catalog
validator for `ci_provider=bitbucket` reads `repositoryUuid` as `repo_id`.

## CI portability

- Pipeline files stay thin. They enable the host OIDC token, pass CI values
  through, and call `scripts/ci`.
- The catalog has one token validator per provider. The binding's `ci_provider`
  selects it. A new provider is a new validator. Routes and tables stay as they are.
- `platform/scripts/onboard-tenant.ps1` takes `-CiProvider`. Only `bitbucket` is
  implemented. Any other value stops before Azure changes.

## Switching to GitHub

GitHub Actions can use an Azure federated credential. That replaces the
Bitbucket client secret.

1. Add a GitHub token validator. The catalog binding stays `(ci_provider, repo_id)`.
2. Add a thin workflow that calls `scripts/ci` and passes the Actions OIDC token
   as `CI_OIDC_TOKEN`. Leave the client secret out of the workflow file.
3. Create a federated credential on the tenant pipeline app and sign in to Azure
   with that token.
4. Run onboarding with `-CiProvider github` and the GitHub repository id as
   `-RepoId`. Approve the new catalog binding.
5. Delete each tenant's old secret. Remove the Entra password credential and
   delete the secured CI variable `AZURE_CLIENT_SECRET`.
6. Run the workflow and confirm deploy and catalog registration succeed with the
   federated credential and the GitHub token.

## What the tenant never receives

- A role on the platform resource group, Log Analytics, Key Vault, or PostgreSQL
- Registry Writer without a repository condition
- Rights on the shared sign-in registration, a second sign-in registration, or a
  per-user access list. Any signed-in employee can open any tenant app
- The client secret in git, a parameter file, or the onboarding log
- An ACR admin password or a scope-map token

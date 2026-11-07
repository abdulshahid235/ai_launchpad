<!-- [HNI-PRIV-01] Classification before any stored data -->
<!-- [HNI-PRIV-02] Inventory before production; dev holds no personal data -->
<!-- [HNI-CRED-05] Pipeline secret stays in the secured CI variable -->
<!-- [HNI-AUTH-01] No per-user access rows; one shared sign-in registration -->

# Data inventory

Nothing in this pass stores application rows. The inventory below is what the
catalog may hold, what stays outside it, and the rule for the dev subscription now.

| Data | Class | Where it will live | Who can read it | This pass |
|---|---|---|---|---|
| App name, description | Internal | Catalog PostgreSQL, written only by the catalog | Signed-in employees | Not stored |
| Owner | Personal data (employee identity) | Catalog PostgreSQL. Store the Entra object id. Display name is optional and is the only extra personal field | Signed-in employees | Not stored |
| App URL | Internal | Catalog PostgreSQL | Signed-in employees | Not stored |
| Catalog binding `(ci_provider, repo_id)` | Internal | Catalog PostgreSQL. The pipeline presents the CI host OIDC token. For Bitbucket, `repo_id` is `repositoryUuid` | Platform owner and the catalog API | Not stored |
| Pipeline client secret | Credential | Secured CI variable `AZURE_CLIENT_SECRET` only. 90-day expiry. Absent from the catalog, the repository, the onboarding log, and parameter files | The tenant pipeline, at deploy time | Created for the Bitbucket proof of concept. Deleted when that tenant moves to a federated credential or a managed identity |
| Per-user access on a tenant app | Not collected | Tenant apps have no user-specific control. One shared sign-in registration | n/a | Not stored |
| Prompts and model output | Not collected in this pass | Gateway later, under HNI-AIR-01 | n/a | No model call is deployed |
| Dev database, Key Vault, registry contents | Synthetic only | Dev subscription | IPs on the allow list | Must not be copied from production or from real employee records |

## Rules for the dev subscription

- Do not load production data, production backups, or real employee records.
- Do not send personal data to Portkey. The vendor path is not approved for
  personal data on the public Production plan (HNI-PRIV-09, HNI-AIR-01).
- HNI-PRIV-08 forbids real personal data in test or sample data. Synthetic
  names and synthetic descriptions are the only fixtures.
- The pipeline client secret is not catalog data and is not committed. It lives
  in the secured CI variable until it expires (90 days) or is deleted.
- Tenant apps do not store per-user permissions. Sign-in is one shared
  registration, and any signed-in employee can open any tenant app.

The catalog's access log (who read which owner row) is a later requirement
(HNI-AUDIT-05) and is not implemented here.

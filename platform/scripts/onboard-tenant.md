# [HNI-CRED-05] Operator notes for onboarding. The script is the procedure.
# See docs/onboarding.md for who approves each step.

The script is `onboard-tenant.ps1` in this folder.

Before you run it:

1. A person other than the requester has approved the app (HNI-AUTH-08).
2. Finance has issued `GLAccount`. The script rejects placeholders.
3. You have the Bitbucket OIDC issuer and subject. Do not invent them, and do not
   create a client secret instead.

The script creates the app registration only if that display name is missing,
creates the service principal only if it is missing, and creates the federated
credential only if that subject is missing. It then deploys the tenant resource
group, Contributor on that group only, and Container Registry Repository Writer
on `apps/<app-name>` only.

It logs each create or reuse to a file under the user temp directory. It has no
secret parameter and it deletes the temporary federated-credential file after
the Azure CLI call.

Dev data for this app is synthetic only. Pass `-DataClassification synthetic-only`.

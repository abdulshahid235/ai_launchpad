<!-- [HNI-ARCH-09] System overview for the platform pass -->

# App Launchpad

Internal platform on Azure Container Apps. An employee deploys an experiment from a
template. The employee cannot change the shared platform resources.

This repository currently contains the decision record and the platform Bicep.
The template and the catalog are later folders.

## What exists now

| Piece | Role |
|---|---|
| `docs/adr/0001-app-launchpad.md` | Decisions, waiver expiry 2027-04-30, recovery targets |
| `platform/` | Resource group contents: Log Analytics, Premium registry, Container Apps environment, Key Vault, PostgreSQL, and the tenant onboarding deployment |
| Catalog and template | Not built in this pass |

## Identities

- The platform script runs as the dev-subscription owner (waiver W-004).
- Each tenant pipeline gets its own Entra app, a Bitbucket federated credential, Contributor on the tenant resource group only, and Container Registry Repository Writer on one repository name.
- Each container app, when it is created later, gets its own managed identity.
- No client secret is created by these scripts.

## Data

PostgreSQL is the catalog store. It is empty in this pass. Dev data is synthetic
only. See `data-inventory.md`.

## Language of tenant apps

The library does not allow a general non-Next.js web app.

- **HNI-FE-01** (required). HNI web applications use Next.js App Router and TypeScript.
  Another framework needs an ADR first, and only when Next.js cannot meet the
  requirement. The examples in the rule are a purely static site and a desktop app.
  Streamlit and a Python web UI are web applications. They are not listed as allowed.
- **HNI-ARCH-01** (preferred). A separate backend container is justified when the work
  needs another runtime, including Python for data-science libraries, ML inference,
  or OS tooling Node.js does not have. That backend sits beside the Next.js app.
  It does not replace it. A standalone API that replaces Next.js routes needs more
  than one client, or a real team boundary, and an ADR.
- **HNI-AIR-02** (required) when the workload is an agent harness. The rule does not
  pick a language. A Python agent backend is possible. If that backend also serves
  a web UI, HNI-FE-01 still applies to the UI. An agent also needs the evaluation
  suite in HNI-AILC-04, at every tier.

The catalog and the starter template, when built, are Next.js.

## AI register for an internal Tier 1 app

There is no path that skips the register once other people use the app.

- **HNI-AILC-01.** A register entry is required before real users or real data.
  Personal experimentation is exempt only when nobody else relies on it and no
  confidential or personal data is involved. An app listed for other employees
  does not qualify.
- **HNI-AILC-02.** Tier 1 (internal assistant, public or internal data, writes
  nothing) is the lighter control set: the register, pinned models, a basic
  evaluation, and the labels in HNI-AILC-07. Tier 2 and Tier 3 add more. The
  register entry itself stays.
- **HNI-AILC-04.** The full evaluation suite applies at Tier 2 and above, and to
  every agent. A Tier 1 system that is not an agent may use a smaller smoke suite.

See `ai-register.md`.

## Cost

`GLAccount` is a required deployment parameter. How to request it is in
`platform/README.md`. The value is not in the parameter file.

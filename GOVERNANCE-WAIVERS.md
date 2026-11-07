# Governance Waivers

Records active exceptions to `REQUIRED`-severity standards for this repository, checked
by the `/governance-check` skill before it blocks a protected-branch merge. A waiver
here does not mean the underlying issue is fixed — it means someone with the authority
to accept that risk has done so, for a bounded time, with a reason on record. This is
the same "documented accepted risk" concept already used elsewhere in the standards
library (see HNI-SEC-04, HNI-SEC-13) applied specifically to the merge gate.

**`NEVER`-severity standards cannot be waived, ever, regardless of what's recorded
here.** If `/governance-check` reports a NEVER-severity finding, the only paths forward
are: fix it, or get the standard itself reconsidered through the standards library's own
process (see `00-validation.md` — "Do not invent exceptions. If a use case genuinely
seems to require an exception to a REQUIRED or NEVER rule, tell the user and recommend
they get the standard updated rather than treating the exception as implicit").

## Rules for adding a waiver

- **The approver must not be the same person whose change triggered the finding.** A
  self-approved waiver is not a waiver — it's the gate not existing.
- **Every waiver has an expiry date.** No open-ended waivers. If the underlying issue is
  still not resolved when a waiver expires, either renew it explicitly (with a fresh
  approval, not an automatic rollover) or it becomes a BLOCKING finding again.
- **State the actual reason**, not just "approved" — a future reader (including the next
  `/governance-check` run, and whoever eventually has to fix the underlying issue) needs
  to understand why this was accepted, not just that it was.
- **One row per waiver.** If the same standard is waived for multiple unrelated reasons
  across the codebase, that's a sign the standard needs a broader conversation, not more
  rows quietly stacking up here.

## Requested waivers awaiting an approver

These rows are requests, not approvals. The directing user confirmed the deviation.
They move into Active Waivers only after a person other than the author approves them.
Until then, a protected-branch merge stays blocked for these findings. Details and the
expiry are in `docs/adr/0001-app-launchpad.md`. Scope for all four: the `dev-public`
profile in the dev subscription only.

| ID | Standard | Reason | Requested by | Expires | Status |
|----|----------|--------|--------------|---------|--------|
| W-001 | HNI-INFRA-04 | Dev deploys without the private-endpoint topology so a subnet is not required yet. Private modules stay in the same Bicep. Production parameters cannot select `dev-public`. | mohammeda | 2027-04-30 | Pending approval |
| W-002 | HNI-NET-03 | Dev Postgres, Key Vault, and ACR use public endpoints limited to specific IPs. `0.0.0.0` and Allow Azure services are rejected. Dev data is synthetic only. | mohammeda | 2027-04-30 | Pending approval |
| W-003 | HNI-NET-11 | Dev apps use Container Apps public ingress before Imperva is in place. Easy Auth is required, and ingress is limited to the IP list parameter. | mohammeda | 2027-04-30 | Pending approval |
| W-004 | HNI-INFRA-01 | The dev-subscription owner runs an idempotent script to create the dev resource group, data services, and the Bitbucket federated credential. The script writes no secrets. Production stays with the Cloud team. | mohammeda | 2027-04-30 | Pending approval |

## Active Waivers

| ID | Standard | Reason | Approved By | Approved Date | Expires | Status |
|----|----------|--------|-------------|----------------|---------|--------|
| _(none yet)_ | | | | | | |

## Expired / Resolved Waivers

Move a waiver here once it expires or the underlying finding is actually fixed — keep
the history rather than deleting the row, so there's a record of what was previously
accepted and for how long.

| ID | Standard | Reason | Approved By | Approved Date | Expired/Resolved | Outcome |
|----|----------|--------|-------------|----------------|-------------------|---------|
| _(none yet)_ | | | | | | |

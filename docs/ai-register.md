<!-- [HNI-AILC-01] Register entry before other people use an AI feature -->
<!-- [HNI-AILC-02] Tier 1 is a lighter control set, not an exemption -->

# AI register

An internal Tier 1 app that other employees can open still needs a register entry.
The personal-experimentation exception in HNI-AILC-01 does not cover it.

## Who files it

1. The business owner requests the entry before other people use the app.
2. The technical owner fills and maintains it.
3. The AI governance owner confirms Tier 3. A Tier 1 assistant does not need that
   confirmation. It still needs the entry.

The register lives in the Bastion console, not in this repository. This file is
the intake checklist to copy into that entry.

## Tier 1 minimum

Use Tier 1 only when the app suggests an answer to an HNI employee, reads public
or internal data, and writes nothing. Sharing it inside HNI does not raise the
tier by itself. Personal data, confidential data, or an audience outside HNI
raises it to Tier 2 (HNI-AILC-02).

Tier 1 controls that still apply:

- Register entry with a business owner and a technical owner (HNI-AILC-01)
- Model and prompt versions recorded (HNI-AILC-03)
- A smaller smoke evaluation, not the full Tier 2 suite, and only if it is not
  an agent (HNI-AILC-04)
- The user can see that the output is AI-generated (HNI-AILC-07)

An agent is not eligible for that smaller suite. HNI-AILC-04 requires the full
suite for every agent, at every tier.

## Fields to copy into the register

- Name and purpose
- Business owner and technical owner
- Type: built
- Models and providers, with versions, reached through the Portkey gateway
- Data classes: Internal only for the Tier 1 sample. Owner on the catalog is
  personal data and is not sent to the model
- Users: internal
- Autonomy: suggests to a person
- Systems it can write to: none
- Output does not feed a decision about a person, or financial reporting
- Risk tier: 1, date assigned
- Link to `docs/adr/0001-app-launchpad.md`

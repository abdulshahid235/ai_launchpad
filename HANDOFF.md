# Handoff — local App Launchpad POC

## Goal

A **local demo** of App Launchpad as a POC sandbox:

- Browse/register apps in the **catalog**
- **One-step deploy** of a tenant app onto the local proxy
- **Feedback** on apps
- **Graduation check** via a **PL/SQL reviewer** (planned)

**Out of scope for local mode:** Azure resources, real Entra ID, production networking.

**In scope and real:** **Portkey** as the model gateway (keys stay in `.env`, never git).

## Decisions so far

1. **Keep** `catalog/`, `template/`, and `platform/` in place. Do not delete or fork Azure paths.
2. **Local mode via env**, not a code fork:
   - `DB_DRIVER=pglite` | `pg` (same SQL migrations; adapter at the connection layer)
   - `AUTH_ISSUER` / `AUTH_AUDIENCE` / `JWKS_URI` point at auth-mock (swap to Entra later by changing env)
3. **OpenAPI is the source of truth:** `docs/api/catalog-openapi.yaml`. Changes are **additive only** (new optional fields / routes). Existing clients must not break.
4. **Local-only packages:** `auth-mock/`, `proxy/`, `deploy-agent/`.
5. **deploy-agent** uses a **`Runner` interface**. `ProcessRunner` copies/builds/starts on a free port and updates `proxy/routes.json`. `DockerRunner` exists but is stubbed until Docker-based deploy is implemented.

## Status

### Done

- npm workspaces root: `catalog`, `auth-mock`, `proxy`, `deploy-agent`
- `auth-mock`: oidc-provider on `:9100`, seed users `owner@` / `tester@` / `approver@hni.test` (password `password`)
- `proxy`: `:8080`, JWT via JWKS, routes from `proxy/routes.json`, `*.localhost` routing
- `catalog`: PGlite path (`DB_DRIVER=pglite`), `AUTH_*` validation, OIDC sign-in + `/auth/callback`, migrate on `npm run dev`
- Additive schema: `expires_at` on apps + `feedback` table (`migrations/003_expires_feedback.sql`) and matching OpenAPI entries
- `deploy-agent`: `Runner` + working-shaped `ProcessRunner`; `DockerRunner` class present
- Root `.env.example`, `npm run dev` (concurrently auth + catalog + proxy)

### Stubbed / not wired yet

- **`DockerRunner.deploy`** — throws `not implemented`
- **Feedback API routes** — OpenAPI + table exist; no `catalog/src/app/api/.../feedback` handlers yet
- **Graduation check / PL/SQL reviewer** — not started
- **Template app as one-step deploy target** — `template/` exists (Azure/Easy Auth oriented); not yet driven by deploy-agent in the local loop
- **Rich seed data** beyond bootstrap approver — `catalog/scripts/seed-demo.mjs` targets compose Postgres, not the default PGlite `npm run dev` path

### Known issues

- Host Node may be &lt; 22; use `.nvmrc` / `engines` (`>=22.21.0 <23`). auth-mock has a small `URL.parse` polyfill for Node 20 emergency use only — do not rely on it.
- Port **9000** was blocked on the original laptop (Zscaler); auth-mock defaults to **9100**.
- Proxy expects `catalog.localhost` (and later `<app>.localhost`). Ensure the OS resolves `*.localhost` to `127.0.0.1` (Windows usually does).
- Without `PORTKEY_*` keys, template model calls return **503** by design.
- Root `docker-compose.yml` is a separate image-based path; prefer `npm run dev` for this POC.

## Next steps (in order)

1. **`DockerRunner`** — implement against the `Runner` interface now that Docker is available on the handoff machine; keep `ProcessRunner` for no-Docker fallbacks.
2. **Template app** — make `template/` the default deployable sample under local auth + Portkey env from root `.env`.
3. **Reviewer integration** — wire the PL/SQL reviewer into the local flow (read contract / inputs first; additive API only).
4. **Feedback** — implement OpenAPI feedback list/create routes against the existing `feedback` table.
5. **Graduation check** — gate or report based on reviewer + feedback criteria (additive).
6. **Seed data** — local-friendly seed (apps/feedback) that runs under PGlite after migrate, aligned with mock user oids.

## Pointers

- Runbook: [README.md](./README.md) → **Run locally**
- Cursor constraints for this laptop: [.cursor/rules/project.mdc](./.cursor/rules/project.mdc)
- Contract: `docs/api/catalog-openapi.yaml`

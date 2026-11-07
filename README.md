# AI Launchpad

Local POC sandbox for App Launchpad: catalog, mock sign-in, one-step deploy path, and (planned) feedback / graduation via a PL/SQL reviewer. No Azure and no real Entra in local mode. Portkey is the real model gateway when keys are set.

See [HANDOFF.md](./HANDOFF.md) for decisions, status, and next steps.

## Run locally

### Prerequisites

- **Node.js 22.21.x** (see `.nvmrc`). `fnm`, `nvm`, or any installer that honors `.nvmrc` is fine.
- **npm** 10+ (ships with Node 22).
- **Docker** is optional for the Node-only demo; required later for `DockerRunner`.
- Free ports: **9100** (auth-mock), **3000** (catalog), **8080** (proxy), **54329** (PGlite socket).

### Setup

```powershell
git clone <repo-url> ai_launchpad
cd ai_launchpad
git checkout demo/local-mode

# Use Node from .nvmrc (example with fnm)
fnm use

copy .env.example .env
# Edit .env: set PORTKEY_* if you will call the gateway; leave blank otherwise.

npm ci
npm run dev
```

`npm run dev` starts auth-mock, catalog (PGlite + migrate + Next), and the proxy together.

### Seeded mock users

From `auth-mock` (password for each is `password`):

| Email | Role intent | Object id (`oid` / `sub`) |
|---|---|---|
| `owner@hni.test` | App owner / requester | `a1000000-0000-4000-8000-000000000001` |
| `tester@hni.test` | Reader / tester | `a1000000-0000-4000-8000-000000000002` |
| `approver@hni.test` | Platform approver (`Catalog.Approve` via bootstrap) | `a1000000-0000-4000-8000-000000000003` |

`CATALOG_BOOTSTRAP_APPROVER_OID` in `.env` seeds the approver as `Catalog.Approve` on first migrate.

### Ports and URLs

| Service | URL |
|---|---|
| Auth mock (OIDC) | http://127.0.0.1:9100 |
| Catalog (direct) | http://127.0.0.1:3000 |
| Proxy (Easy Auth stand-in) | http://catalog.localhost:8080 |
| Catalog health | http://127.0.0.1:3000/api/health |
| PGlite Postgres socket | `127.0.0.1:54329` (data under `.data/pglite`) |

Sign in through the proxy or the catalog UI; use a seed user above.

OpenAPI contract (source of truth): `docs/api/catalog-openapi.yaml`.

### Stop / reset

- **Stop:** `Ctrl+C` in the terminal running `npm run dev` (concurrently kills auth, catalog, and proxy).
- **Reset DB:** stop the stack, delete the PGlite data dir, start again (migrate + bootstrap re-run):

```powershell
Remove-Item -Recurse -Force .data
npm run dev
```

- **Clean install:** `Remove-Item -Recurse -Force node_modules; npm ci`

### Optional: full docker-compose stack

Root `docker-compose.yml` is the older Postgres + catalog image path (needs `POSTGRES_PASSWORD` and `BASE_IMAGE`). Prefer `npm run dev` for the local POC.

## Layout

| Path | Role |
|---|---|
| `catalog/` | Next.js catalog UI + API |
| `template/` | Sample tenant app (Portkey) |
| `platform/` | Azure Bicep (kept; not used in local mode) |
| `auth-mock/` | Local OIDC issuer |
| `proxy/` | Local Easy Auth stand-in |
| `deploy-agent/` | Deploy `Runner` (`ProcessRunner` + stub `DockerRunner`) |

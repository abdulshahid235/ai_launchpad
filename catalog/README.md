# Catalog

The catalog is the only writer of the experiment-app registry. Users list apps.
A pipeline registers the app named in its approved binding. A platform owner
approves requests and cannot approve their own. Dev data is synthetic only.

The contract is `docs/api/catalog-openapi.yaml`.

## Run locally

Copy `.env.example` to `.env` and set values there. Do not commit `.env`.

From the repository root:

```powershell
docker compose up --build
```

The root `docker-compose.yml` is the service definition for Postgres, the
catalog, and the local demo. Set `POSTGRES_PASSWORD` and
`BASE_IMAGE` in the environment first. `BASE_IMAGE` is the Node 22.21.0
bookworm image after it has been imported into your environment's Azure
Container Registry, for example
`<registry>.azurecr.io/node:22.21.0-bookworm-slim`. The Dockerfile does not
pull Node from Docker Hub. `NPM_STRICT_SSL` defaults to true. CI builds leave
it true. The local compose file sets it false for proxy inspection only.

`APP_ENV` is `local`, `dev`, `qa`, or `prod`. Unset means `prod`.
`LOCAL_AUTH_MODE=true` turns on the dev token field and a local JWKS override
only when `APP_ENV=local`. The process exits if `LOCAL_AUTH_MODE=true` with
any other `APP_ENV`.

Health, with no token:

```powershell
Invoke-WebRequest http://localhost:3000/api/health
```

Postgres listens on localhost port 5432 with the certificate in `certs/`.
That directory is gitignored.

## First platform owner

Migrations do not insert a person. After Postgres is up, set
`CATALOG_BOOTSTRAP_APPROVER_OID` to an Entra object id in your shell, point
`DATABASE_URL` at the local database, and set `DATABASE_SSL_CA_FILE` to
`certs/server.crt`. Then run:

```powershell
npm run bootstrap
```

The script inserts a `Catalog.Approve` user only when none exists. If that
object id is already a user, it stops and does not change the role. A normal
login creates `Catalog.Read` and never changes a role. Role changes go through
`POST /api/roles`, which a platform owner calls for someone else.

## Tests

JWT negative tests do not need Postgres. The app tests do.

```powershell
npm run typecheck
npx tsx --test tests/auth.jwt.test.ts
```

With the compose database running, set `DATABASE_URL` and
`DATABASE_SSL_CA_FILE=certs/server.crt`, then:

```powershell
npm test
```

Playwright skips unless `BASE_URL`, `AZURE_CLIENT_ID`, and `AZURE_TENANT_ID`
are set. It does not store a password or complete a login. When those are set
it only checks that the sign-in control is on the page.

## Pipeline

`bitbucket-pipelines.yml` in this folder runs typecheck, the Postgres tests,
`npm audit --audit-level=high`, and `npm run secret-scan` before build,
migrate, and deploy. `development` deploys to dev, `qa` to QA, and `main` to
production behind a manual step. The pipeline authenticates to Azure with OIDC.
Bitbucket reads a pipeline file from the repository root, so this file has to
be moved or copied there before a pipeline run.

## Notes

`q` on `GET /api/apps` matches the app name and description. It does not match
the owner, because that value is personal data and does not belong in the query
string. The in-memory rate limit is valid while `CATALOG_MAX_REPLICAS` is `1`.
Next.js 16 uses `src/proxy.ts` for the request boundary. That file does not
read Easy Auth headers.

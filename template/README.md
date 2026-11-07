# Sample

A minimal app. `/api/health` is open. `/api/sample` checks the shared sign-in
token, then calls the Portkey gateway. The gateway key is a service key from
the host environment. A model-provider key is not used.

## Deploy in 5 steps

1. Set `name`, `owner`, and `description` in `app.yaml`.
2. On the host, set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `PORTKEY_GATEWAY_URL`, `PORTKEY_SERVICE_KEY`, `PORTKEY_TEAM`, `PORTKEY_FEATURE`, `PORTKEY_ENVIRONMENT`, and `PORTKEY_MODEL`. Do not commit those values.
3. Run `npm run lint` and `npm run build`.
4. Build the image with `scripts/ci/build.sh`. Set `IMAGE`, `NEXT_PUBLIC_AZURE_CLIENT_ID`, and `NEXT_PUBLIC_AZURE_TENANT_ID`. `NPM_STRICT_SSL` defaults to true, and CI builds leave it true.
5. Run `scripts/ci/deploy.sh`, then `scripts/ci/register.sh`. Both read `name` from `app.yaml`. Deploy also needs `IMAGE` and `RESOURCE_GROUP`. Register also needs `CATALOG_URL`, `CI_OIDC_TOKEN`, `OWNER_OBJECT_ID`, `APP_DESCRIPTION`, `APP_URL`, and `REVISION`. Set `APP_ENV` to `dev`, `qa`, or `prod` on the container app.

`TEMPLATE_JWKS_URI` is used only when `LOCAL_AUTH_MODE=true` and `APP_ENV=local`.
The issuer stays `https://login.microsoftonline.com/<AZURE_TENANT_ID>/v2.0`.
The audience stays `AZURE_CLIENT_ID`.

<!-- [HNI-AUTH-05] Every data route validates the bearer token itself -->

# Authentication in a tenant app

Every tenant app signs in through one shared Entra app registration. That
registration is the Easy Auth client and the token audience for all tenant
apps. The catalog keeps its own registration and roles. Pipeline identities
stay one per tenant.

Any signed-in employee can open any tenant app. There is no per-user or
per-app access control in the template.

## Configuration

The platform sets these environment variables. Do not hardcode them.

| Variable | Value |
|---|---|
| `AZURE_TENANT_ID` | HNI Entra tenant id |
| `AZURE_CLIENT_ID` | Client id of the shared tenant-app registration |

## What the template checks

`src/lib/auth.ts` validates the token on every data request:

- Signature against the Entra JWKS for `AZURE_TENANT_ID` (RS256, keys cached 10 minutes). `TEMPLATE_JWKS_URI` replaces that URL only when `LOCAL_AUTH_MODE=true` and `APP_ENV=local`.
- `aud` equals `AZURE_CLIENT_ID`
- `iss` equals `https://login.microsoftonline.com/<tenant>/v2.0`
- `exp` is present and not passed (5 second clock tolerance)
- `oid` is a GUID and `sub` is present; app-only tokens are rejected

A missing or rejected token returns `401`. An app-only token returns `403`.

## Easy Auth

Easy Auth redirects unauthenticated browsers to sign-in. The app does not use
it as proof of identity. `auth.ts` never reads `X-MS-CLIENT-PRINCIPAL*` or
`X-MS-TOKEN-AAD-*` headers. Only `Authorization: Bearer <token>` is accepted.

## Writing a data route

Wrap the handler. Do not read headers or tokens yourself.

```ts
import { withUser } from "@/lib/auth";

export const GET = withUser(async (_request, user) => {
  return Response.json({ hello: user.name });
});
```

## Known limit: shared audience

All tenant apps accept the same audience, so a token issued for one tenant app
is also accepted by every other tenant app. This is accepted for now, because
any employee may open any app.

Restriction path when an app needs it: turn on **Assignment required** on the
shared registration's enterprise application and assign an Entra group. That
limits who can get a token at all; it still does not separate one tenant app
from another.

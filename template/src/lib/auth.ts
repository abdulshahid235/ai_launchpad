import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ApiError } from "./errors";
import { localJwksOverride } from "./local-auth";

export type VerifiedUser = {
  oid: string;
  subject: string;
  name: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ApiError(500, "internal_error", "The app is not configured.");
  }
  return value;
}

function unauthorized(): ApiError {
  return new ApiError(
    401,
    "invalid_token",
    "The bearer token is missing or was not accepted.",
  );
}

function jwksUrl(): string {
  const tenant = required("AZURE_TENANT_ID");
  // Local demo may point TEMPLATE_JWKS_URI at a token issuer. Other environments ignore it.
  const override = localJwksOverride("TEMPLATE_JWKS_URI");
  if (override) return override;
  return `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`;
}

function issuer(): string {
  const tenant = required("AZURE_TENANT_ID");
  return `https://login.microsoftonline.com/${tenant}/v2.0`;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksFor: string | undefined;

function keySet(): ReturnType<typeof createRemoteJWKSet> {
  const url = jwksUrl();
  if (!jwks || jwksFor !== url) {
    jwks = createRemoteJWKSet(new URL(url), {
      cacheMaxAge: 600_000,
      cooldownDuration: 30_000,
    });
    jwksFor = url;
  }
  return jwks;
}

// [HNI-AUTH-01] Only the Authorization header is read. Easy Auth headers
// (X-MS-CLIENT-PRINCIPAL*, X-MS-TOKEN-AAD-*) are never read or trusted.
function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (\S+)$/i.exec(header);
  if (!match) throw unauthorized();
  return match[1];
}

function claim(payload: JWTPayload, name: string): string {
  const value = payload[name];
  return typeof value === "string" ? value : "";
}

async function verify(request: Request): Promise<JWTPayload> {
  const token = bearer(request);
  try {
    // [HNI-AUTH-02] The shared tenant-app registration comes from the environment.
    const audience = required("AZURE_CLIENT_ID");
    // [HNI-AUTH-05] Signature, audience, issuer, and expiry are checked on every data request.
    const { payload } = await jwtVerify(token, keySet(), {
      audience,
      issuer: issuer(),
      algorithms: ["RS256"],
      clockTolerance: 5,
      requiredClaims: ["exp"],
    });
    return payload;
  } catch (err: unknown) {
    if (err instanceof ApiError) throw err;
    // [DEBUG] JWT rejected - check aud is the shared client id, iss tenant, exp, alg, kid, and Entra JWKS reachability
    throw unauthorized();
  }
}

export async function requireUser(request: Request): Promise<VerifiedUser> {
  const payload = await verify(request);
  // [HNI-AUTH-05] Any signed-in employee is accepted. App-only tokens are not users.
  if (payload.idtyp === "app") {
    throw new ApiError(
      403,
      "wrong_caller_type",
      "An application token cannot call this route.",
    );
  }
  const oid = claim(payload, "oid");
  const subject = typeof payload.sub === "string" ? payload.sub : "";
  if (!UUID.test(oid) || subject.length === 0) throw unauthorized();
  return { oid, subject, name: claim(payload, "name") };
}

type Handler<C> = (
  request: Request,
  user: VerifiedUser,
  context: C,
) => Response | Promise<Response>;

// [HNI-AUTH-05] Tenants wrap each data route handler. They write no auth code.
export function withUser<C>(handler: Handler<C>) {
  return async (request: Request, context: C): Promise<Response> => {
    try {
      const user = await requireUser(request);
      return await handler(request, user, context);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        return Response.json(
          { error: err.code, message: err.clientMessage },
          { status: err.status },
        );
      }
      // [DEBUG] Unhandled error inside a data route - check the handler, not the token
      return Response.json(
        { error: "internal_error", message: "Something went wrong." },
        { status: 500 },
      );
    }
  };
}

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ApiError } from "./errors";
import { localJwksOverride } from "./local-auth";
import { isUuid } from "./validate";

export type VerifiedUser = {
  kind: "user";
  oid: string;
  subject: string;
  azp: string;
};
const PIPELINE_ROLE = "Catalog.Register";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ApiError(500, "internal_error", "The catalog is not configured.");
  }
  return value;
}

function env(name: string): string {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

// AUTH_* lets the mock issuer swap in for Entra without a code fork.
export function authAudience(): string {
  return env("AUTH_AUDIENCE") || required("AZURE_CLIENT_ID");
}

export function authIssuer(): string {
  const explicit = env("AUTH_ISSUER");
  if (explicit) return explicit.replace(/\/$/, "");
  const tenant = required("AZURE_TENANT_ID");
  return `https://login.microsoftonline.com/${tenant}/v2.0`;
}

function jwksUrl(): string {
  const explicit = env("JWKS_URI");
  if (explicit) return explicit;
  // Local demo may point CATALOG_JWKS_URI at a token issuer. Other environments ignore it.
  const override = localJwksOverride("CATALOG_JWKS_URI");
  if (override) return override;
  const tenant = required("AZURE_TENANT_ID");
  return `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`;
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

export function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (\S+)$/i.exec(header);
  if (!match) {
    throw new ApiError(
      401,
      "invalid_token",
      "The bearer token is missing or was not accepted.",
    );
  }
  return match[1];
}

function rolesOf(payload: JWTPayload): string[] {
  const roles = payload.roles;
  if (typeof roles === "string") return [roles];
  if (!Array.isArray(roles)) return [];
  return roles.filter((role): role is string => typeof role === "string");
}

function kind(payload: JWTPayload): "user" | "pipeline" | "unknown" {
  if (payload.idtyp === "app") return "pipeline";
  if (
    payload.idtyp === "user" ||
    (typeof payload.scp === "string" && payload.scp.length > 0)
  )
    return "user";
  if (rolesOf(payload).includes(PIPELINE_ROLE)) return "pipeline";
  return "unknown";
}

function claim(payload: JWTPayload, name: string): string {
  const value = payload[name];
  return typeof value === "string" ? value : "";
}

export async function verifyEntraToken(token: string): Promise<JWTPayload> {
  try {
    const audience = authAudience();
    const issuer = authIssuer();
    // [HNI-AUTH-05] Signature, audience, issuer, and expiry are checked on every data request.
    const { payload } = await jwtVerify(token, keySet(), {
      audience,
      issuer,
      algorithms: ["RS256"],
      clockTolerance: 5,
    });
    return payload;
  } catch (err: unknown) {
    if (err instanceof ApiError) throw err;
    // [DEBUG] JWT rejected - check aud, iss, exp, alg, kid, and JWKS reachability
    throw new ApiError(
      401,
      "invalid_token",
      "The bearer token is missing or was not accepted.",
    );
  }
}

async function verify(request: Request): Promise<JWTPayload> {
  return verifyEntraToken(bearer(request));
}

export async function requireUser(request: Request): Promise<VerifiedUser> {
  const payload = await verify(request);
  const callerKind = kind(payload);
  if (callerKind === "pipeline") {
    throw new ApiError(
      403,
      "wrong_caller_type",
      "A pipeline token cannot call this route.",
    );
  }
  if (callerKind !== "user") {
    throw new ApiError(
      401,
      "invalid_token",
      "The bearer token is missing or was not accepted.",
    );
  }
  const oid = claim(payload, "oid");
  const subject = typeof payload.sub === "string" ? payload.sub : "";
  if (!isUuid(oid) || subject.length === 0) {
    throw new ApiError(
      401,
      "invalid_token",
      "The bearer token is missing or was not accepted.",
    );
  }
  return { kind: "user", oid, subject, azp: claim(payload, "azp") };
}

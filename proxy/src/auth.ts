import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from "jose";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the proxy`);
  return value;
}

function issuer(): string {
  return required("AUTH_ISSUER").replace(/\/$/, "");
}

function audience(): string {
  return required("AUTH_AUDIENCE");
}

function jwksUri(): string {
  return (
    process.env.JWKS_URI?.trim() || `${issuer()}/jwks`
  );
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksFor: string | undefined;

function keySet(): ReturnType<typeof createRemoteJWKSet> {
  const url = jwksUri();
  if (!jwks || jwksFor !== url) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksFor = url;
  }
  return jwks;
}

export async function verifyAccessToken(
  token: string,
): Promise<JWTPayload> {
  // Never trust proxy headers alone — validate signature, iss, aud, exp.
  const { payload } = await jwtVerify(token, keySet(), {
    audience: audience(),
    issuer: issuer(),
    algorithms: ["RS256"],
    clockTolerance: 5,
  });
  return payload;
}

export function bearerFromHeader(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^Bearer (\S+)$/i.exec(value);
  return match ? match[1] : null;
}

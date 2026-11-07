import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ApiError } from "./errors";
import { localJwksOverride } from "./local-auth";

export type CiIdentity = { provider: string; repoId: string };

type Provider = {
  parseRepoId: (value: string) => string | null;
  verify: (token: string) => Promise<string>;
};

const DISCOVERY_TTL_MS = 600_000;

function unauthorized(): ApiError {
  return new ApiError(
    401,
    "invalid_token",
    "The bearer token is missing or was not accepted.",
  );
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ApiError(500, "internal_error", "The catalog is not configured.");
  }
  return value;
}

function claim(payload: JWTPayload, name: string): string {
  const value = payload[name];
  return typeof value === "string" ? value : "";
}

// Bitbucket Pipelines. The sub claim ends in a per-run step UUID and is never read.
// repositoryUuid is the stable repository id, braces included.
const BITBUCKET_REPO_ID =
  /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/;

function bitbucketIssuer(): string {
  const workspace = required("CATALOG_BITBUCKET_WORKSPACE");
  if (!/^[A-Za-z0-9_-]+$/.test(workspace)) {
    throw new ApiError(500, "internal_error", "The catalog is not configured.");
  }
  return `https://api.bitbucket.org/2.0/workspaces/${workspace}/pipelines-config/identity/oidc`;
}

let bitbucketKeys:
  | {
      issuer: string;
      jwks: ReturnType<typeof createRemoteJWKSet>;
      loadedAt: number;
    }
  | undefined;

async function bitbucketJwksUri(issuer: string): Promise<string> {
  // Local demo may point CATALOG_BITBUCKET_JWKS_URI at a token issuer. Other environments ignore it.
  const override = localJwksOverride("CATALOG_BITBUCKET_JWKS_URI");
  if (override) return override;
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("bitbucket discovery failed");
  const doc = (await response.json()) as { issuer?: unknown; jwks_uri?: unknown };
  if (
    doc.issuer !== issuer ||
    typeof doc.jwks_uri !== "string" ||
    !doc.jwks_uri.startsWith(`${issuer}/`)
  ) {
    throw new Error("bitbucket discovery did not match the issuer");
  }
  return doc.jwks_uri;
}

async function bitbucketKeySet(
  issuer: string,
): Promise<ReturnType<typeof createRemoteJWKSet>> {
  const cached = bitbucketKeys?.issuer === issuer ? bitbucketKeys : undefined;
  if (cached && Date.now() - cached.loadedAt < DISCOVERY_TTL_MS) {
    return cached.jwks;
  }
  try {
    const jwks = createRemoteJWKSet(new URL(await bitbucketJwksUri(issuer)), {
      cacheMaxAge: 600_000,
      cooldownDuration: 30_000,
    });
    bitbucketKeys = { issuer, jwks, loadedAt: Date.now() };
    return jwks;
  } catch (err: unknown) {
    // [DEBUG] Bitbucket OIDC discovery failed - check egress to api.bitbucket.org and CATALOG_BITBUCKET_WORKSPACE
    if (cached) return cached.jwks;
    throw err;
  }
}

async function verifyBitbucket(token: string): Promise<string> {
  try {
    const issuer = bitbucketIssuer();
    const audience = required("CATALOG_BITBUCKET_AUDIENCE");
    // [HNI-AUTH-05] Signature against the issuer's JWKS, then iss, aud, and exp.
    const { payload } = await jwtVerify(token, await bitbucketKeySet(issuer), {
      issuer,
      audience,
      algorithms: ["RS256"],
      clockTolerance: 5,
      requiredClaims: ["exp"],
    });
    const repoId = claim(payload, "repositoryUuid").toLowerCase();
    if (!BITBUCKET_REPO_ID.test(repoId)) throw unauthorized();
    return repoId;
  } catch (err: unknown) {
    if (err instanceof ApiError) throw err;
    // [DEBUG] Bitbucket token rejected - check aud is CATALOG_BITBUCKET_AUDIENCE, iss workspace, exp, alg, kid, and repositoryUuid
    throw unauthorized();
  }
}

// One entry per CI provider. A new provider is a new entry here; routes and tables do not change.
const PROVIDERS: Readonly<Record<string, Provider>> = Object.freeze({
  bitbucket: {
    parseRepoId: (value: string) => {
      const repoId = value.toLowerCase();
      return BITBUCKET_REPO_ID.test(repoId) ? repoId : null;
    },
    verify: verifyBitbucket,
  },
});

function providerFor(name: string | null): Provider | undefined {
  if (name === null || !Object.hasOwn(PROVIDERS, name)) return undefined;
  return PROVIDERS[name];
}

export function isCiProvider(name: string): boolean {
  return providerFor(name) !== undefined;
}

export function parseRepoId(provider: string, value: string): string | null {
  return providerFor(provider)?.parseRepoId(value) ?? null;
}

export async function verifyCiToken(
  provider: string | null,
  token: string,
): Promise<CiIdentity> {
  const selected = providerFor(provider);
  if (!selected || provider === null) {
    throw new ApiError(
      403,
      "unknown_ci_provider",
      "This CI provider is not supported.",
    );
  }
  return { provider, repoId: await selected.verify(token) };
}

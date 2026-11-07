import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";

export const TENANT = "00000000-0000-4000-8000-000000000001";
export const CLIENT = "00000000-0000-4000-8000-000000000002";
export const issuer = `https://login.microsoftonline.com/${TENANT}/v2.0`;
export const BITBUCKET_WORKSPACE = "launchpad-test";
export const BITBUCKET_AUDIENCE = "api://launchpad-catalog-test";
export const bitbucketIssuer = `https://api.bitbucket.org/2.0/workspaces/${BITBUCKET_WORKSPACE}/pipelines-config/identity/oidc`;

let server: Server | undefined;
let privateKey: CryptoKey;
let otherKey: CryptoKey;

export async function startFixture(): Promise<void> {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256", { extractable: true })).privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  process.env.AZURE_TENANT_ID = TENANT;
  process.env.AZURE_CLIENT_ID = CLIENT;
  process.env.CATALOG_JWKS_URI = `http://127.0.0.1:${port}/keys`;
  process.env.CATALOG_BITBUCKET_WORKSPACE = BITBUCKET_WORKSPACE;
  process.env.CATALOG_BITBUCKET_AUDIENCE = BITBUCKET_AUDIENCE;
  process.env.CATALOG_BITBUCKET_JWKS_URI = `http://127.0.0.1:${port}/keys`;
  process.env.CATALOG_MAX_REPLICAS = "1";
  process.env.APP_ENV = "local";
  process.env.LOCAL_AUTH_MODE = "true";
  Reflect.set(process.env, "NODE_ENV", "test");
}

export async function stopFixture(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) =>
    server?.close((err) => (err ? reject(err) : resolve())),
  );
}

type Claims = Record<string, unknown>;

export async function signToken(
  claims: Claims,
  options?: {
    audience?: string;
    issuer?: string;
    expiresIn?: string | number;
    kid?: string;
    key?: CryptoKey;
  },
): Promise<string> {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: options?.kid ?? "test-key" })
    .setIssuer(options?.issuer ?? issuer)
    .setAudience(options?.audience ?? CLIENT)
    .setIssuedAt();
  const exp = options?.expiresIn ?? "5m";
  jwt.setExpirationTime(
    typeof exp === "number" ? Math.floor(Date.now() / 1000) + exp : exp,
  );
  return jwt.sign(options?.key ?? privateKey);
}

export function bitbucketToken(
  repositoryUuid: string,
  options?: {
    audience?: string;
    issuer?: string;
    expiresIn?: string | number;
    kid?: string;
    key?: CryptoKey;
  },
): Promise<string> {
  // sub ends in a per-run step UUID, as Bitbucket issues it. The catalog must not read it.
  return signToken(
    {
      sub: `${repositoryUuid}:{${crypto.randomUUID()}}`,
      repositoryUuid,
      workspaceUuid: "{00000000-0000-4000-8000-0000000000bb}",
      stepUuid: `{${crypto.randomUUID()}}`,
    },
    {
      audience: options?.audience ?? BITBUCKET_AUDIENCE,
      issuer: options?.issuer ?? bitbucketIssuer,
      expiresIn: options?.expiresIn,
      kid: options?.kid,
      key: options?.key,
    },
  );
}

export function otherPrivateKey(): CryptoKey {
  return otherKey;
}

export function noneToken(claims: Claims): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    iss: issuer,
    aud: CLIENT,
    exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  })}.`;
}

import { createServer } from "node:http";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";

const port = Number(process.env.ISSUER_PORT ?? "8080");
const tenant = required("AZURE_TENANT_ID");
const clientId = required("AZURE_CLIENT_ID");
const workspace = required("CATALOG_BITBUCKET_WORKSPACE");
const bitbucketAudience = required("CATALOG_BITBUCKET_AUDIENCE");
const entraIssuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
const bitbucketIssuer = `https://api.bitbucket.org/2.0/workspaces/${workspace}/pipelines-config/identity/oidc`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPO = /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i;

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "local";
jwk.alg = "RS256";
jwk.use = "sig";

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set.`);
    process.exit(1);
  }
  return value;
}

function b64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString("base64url");
}

function sign(claims, issuer, audience) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid: "local", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ ...claims, iss: issuer, aud: audience, iat: now, exp: now + 3600 }),
  );
  const data = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  return `${data}.${signer.sign(privateKey).toString("base64url")}`;
}

function text(response, status, body) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/keys") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys: [jwk] }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/user-token") {
    const oid = url.searchParams.get("oid") ?? "";
    if (!UUID.test(oid)) {
      text(response, 400, "oid must be a uuid\n");
      return;
    }
    text(
      response,
      200,
      sign(
        {
          oid,
          sub: `subject-${oid}`,
          name: "Local User",
          scp: "access_as_user",
          idtyp: "user",
          azp: clientId,
        },
        entraIssuer,
        clientId,
      ),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/pipeline-token") {
    const repo = url.searchParams.get("repo") ?? "";
    if (!REPO.test(repo)) {
      text(response, 400, "repo must be a braced uuid\n");
      return;
    }
    text(
      response,
      200,
      sign(
        {
          repositoryUuid: repo,
          workspaceUuid: "{00000000-0000-4000-8000-0000000000bb}",
          sub: `${repo}:{${randomUUID()}}`,
        },
        bitbucketIssuer,
        bitbucketAudience,
      ),
    );
    return;
  }
  text(response, 404, "not found\n");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`issuer listening on ${port}`);
});

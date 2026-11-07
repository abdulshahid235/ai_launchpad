import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  BITBUCKET_AUDIENCE,
  bitbucketIssuer,
  bitbucketToken,
  noneToken,
  otherPrivateKey,
  signToken,
  startFixture,
  stopFixture,
} from "./jwt-fixture";

type CiProviders = typeof import("../src/lib/ci-providers");
let ci: CiProviders;
const REPO = "{1de489be-ce6a-42a0-a8c8-eadbf1174ac7}";

type Apps = typeof import("../src/app/api/apps/route");
type Health = typeof import("../src/app/api/health/route");

let apps: Apps;
let health: Health;

const user = {
  oid: "00000000-0000-4000-8000-000000000011",
  sub: "user-subject",
  scp: "access_as_user",
  idtyp: "user",
};

before(async () => {
  await startFixture();
  apps = await import("../src/app/api/apps/route");
  health = await import("../src/app/api/health/route");
  ci = await import("../src/lib/ci-providers");
});

after(async () => {
  await stopFixture();
});

function call(
  handler: (request: Request) => Promise<Response> | Response,
  path: string,
  token?: string,
): Promise<Response> | Response {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return handler(new Request(`http://127.0.0.1${path}`, { headers }));
}

async function bodyOf(
  response: Response | Promise<Response>,
): Promise<{ status: number; code?: string }> {
  const resolved = await response;
  const body = (await resolved.json()) as { error?: { code?: string } };
  return { status: resolved.status, code: body.error?.code };
}

test("health is open and minimal", async () => {
  const response = await health.GET(new Request("http://127.0.0.1/api/health"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { status: string; data: unknown[] };
  assert.equal(body.status, "ok");
  assert.deepEqual(body.data, []);
  assert.equal(response.headers.get("x-powered-by"), null);
});

test("rejects the negative token cases", async () => {
  const userCases: { name: string; token: string }[] = [
    {
      name: "wrong aud",
      token: await signToken(user, {
        audience: "00000000-0000-4000-8000-000000000099",
      }),
    },
    {
      name: "wrong iss",
      token: await signToken(user, {
        issuer: "https://login.example.internal/v2.0",
      }),
    },
    {
      name: "wrong tenant",
      token: await signToken(user, {
        issuer:
          "https://login.microsoftonline.com/00000000-0000-4000-8000-000000000077/v2.0",
      }),
    },
    { name: "expired", token: await signToken(user, { expiresIn: -60 }) },
    {
      name: "unknown kid",
      token: await signToken(user, { kid: "unknown", key: otherPrivateKey() }),
    },
    { name: "alg none", token: noneToken(user) },
    {
      name: "missing oid",
      token: await signToken({
        sub: "user-subject",
        scp: "access_as_user",
        idtyp: "user",
      }),
    },
  ];
  const tampered = await signToken(user);
  const parts = tampered.split(".");
  parts[2] = `${parts[2].slice(0, -2)}aa`;
  userCases.push({ name: "tampered signature", token: parts.join(".") });

  for (const item of userCases) {
    const result = await bodyOf(call(apps.GET, "/api/apps", item.token));
    assert.equal(result.status, 401, item.name);
    assert.equal(result.code, "invalid_token", item.name);
  }

  const missingBearer = await bodyOf(
    apps.POST(
      new Request("http://127.0.0.1/api/apps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    ),
  );
  assert.equal(missingBearer.status, 401);
  assert.equal(missingBearer.code, "invalid_token");
});

test("an Entra app token on the user route is the wrong caller type", async () => {
  const pipelineToken = await signToken({
    oid: "00000000-0000-4000-8000-000000000021",
    azp: "00000000-0000-4000-8000-000000000022",
    sub: "pipeline-subject",
    idtyp: "app",
    roles: ["Catalog.Register"],
  });
  const asPipeline = await bodyOf(call(apps.GET, "/api/apps", pipelineToken));
  assert.equal(asPipeline.status, 403);
  assert.equal(asPipeline.code, "wrong_caller_type");
});

test("the Bitbucket validator returns repositoryUuid and ignores sub", async () => {
  const first = await ci.verifyCiToken("bitbucket", await bitbucketToken(REPO));
  const second = await ci.verifyCiToken("bitbucket", await bitbucketToken(REPO));
  assert.deepEqual(first, { provider: "bitbucket", repoId: REPO });
  assert.deepEqual(second, first);
});

test("the Bitbucket validator rejects the negative token cases", async () => {
  const cases: { name: string; token: string }[] = [
    {
      name: "wrong aud",
      token: await bitbucketToken(REPO, { audience: "api://other" }),
    },
    {
      name: "workspace default aud only",
      token: await bitbucketToken(REPO, {
        audience: "ari:cloud:bitbucket::workspace/00000000-0000-4000-8000-0000000000bb",
      }),
    },
    {
      name: "wrong iss",
      token: await bitbucketToken(REPO, {
        issuer: bitbucketIssuer.replace("launchpad-test", "other-workspace"),
      }),
    },
    { name: "expired", token: await bitbucketToken(REPO, { expiresIn: -60 }) },
    {
      name: "unknown kid",
      token: await bitbucketToken(REPO, { kid: "unknown", key: otherPrivateKey() }),
    },
    { name: "Entra token", token: await signToken(user) },
    {
      name: "missing repositoryUuid",
      token: await signToken(
        { sub: `${REPO}:{00000000-0000-4000-8000-000000000001}` },
        { issuer: bitbucketIssuer, audience: "api://launchpad-catalog-test" },
      ),
    },
    {
      name: "alg none",
      token: noneToken({
        iss: bitbucketIssuer,
        aud: BITBUCKET_AUDIENCE,
        repositoryUuid: REPO,
      }),
    },
  ];
  const tampered = await bitbucketToken(REPO);
  const parts = tampered.split(".");
  const last = parts[2].slice(-1) === "a" ? "b" : "a";
  parts[2] = `${parts[2].slice(0, -1)}${last}`;
  cases.push({ name: "tampered signature", token: parts.join(".") });
  for (const item of cases) {
    await assert.rejects(
      ci.verifyCiToken("bitbucket", item.token),
      (err: { status?: number; code?: string }) =>
        err.status === 401 && err.code === "invalid_token",
      item.name,
    );
  }
});

test("an unknown CI provider is 403", async () => {
  for (const provider of ["github", null]) {
    await assert.rejects(
      ci.verifyCiToken(provider, await bitbucketToken(REPO)),
      (err: { status?: number; code?: string }) =>
        err.status === 403 && err.code === "unknown_ci_provider",
    );
  }
});

test("does not treat an Easy Auth header as a credential", async () => {
  const response = await apps.GET(
    new Request("http://127.0.0.1/api/apps", {
      headers: { "x-ms-client-principal-name": "synthetic" },
    }),
  );
  assert.equal(response.status, 401);
});
test("returns 503 for a valid token when the database url is unset", async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const result = await bodyOf(
      call(apps.GET, "/api/apps", await signToken(user)),
    );
    assert.equal(result.status, 503);
    assert.equal(result.code, "database_unavailable");
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

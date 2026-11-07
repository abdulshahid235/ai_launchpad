import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  bitbucketToken,
  signToken,
  startFixture,
  stopFixture,
} from "./jwt-fixture";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. These tests need a real Postgres database.",
  );
}

type Apps = typeof import("../src/app/api/apps/route");
type Patch = typeof import("../src/app/api/apps/[name]/route");
type Approvals = typeof import("../src/app/api/approvals/route");
type Decision =
  typeof import("../src/app/api/approvals/[approvalId]/decision/route");
type Roles = typeof import("../src/app/api/roles/route");

let apps: Apps;
let patch: Patch;
let approvals: Approvals;
let decision: Decision;
let roles: Roles;
let sql: NonNullable<ReturnType<(typeof import("../src/lib/db"))["getSql"]>>;

before(async () => {
  await startFixture();
  const migrated = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: process.env,
    encoding: "utf8",
  });
  if (migrated.status !== 0) throw new Error("migration failed");
  const db = await import("../src/lib/db");
  const connected = db.getSql();
  if (!connected) throw new Error("DATABASE_URL is not set.");
  sql = connected;
  const { clearRateLimitForTests } = await import("../src/lib/rate-limit");
  clearRateLimitForTests();
  apps = await import("../src/app/api/apps/route");
  patch = await import("../src/app/api/apps/[name]/route");
  approvals = await import("../src/app/api/approvals/route");
  decision =
    await import("../src/app/api/approvals/[approvalId]/decision/route");
  roles = await import("../src/app/api/roles/route");
});

after(async () => {
  const db = await import("../src/lib/db");
  await db.closeSql();
  await stopFixture();
});

function userToken(oid: string, subject = `subject-${oid}`) {
  return signToken({
    oid,
    sub: subject,
    scp: "access_as_user",
    idtyp: "user",
    azp: "00000000-0000-4000-8000-0000000000aa",
  });
}

async function jsonOf(
  response: Promise<Response>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const resolved = await response;
  return {
    status: resolved.status,
    body: (await resolved.json()) as Record<string, unknown>,
  };
}

function request(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function promote(oid: string): Promise<void> {
  await apps.GET(request("GET", "/api/apps", await userToken(oid)));
  await sql`UPDATE users SET role = 'Catalog.Approve' WHERE object_id = ${oid}::uuid`;
}

function registerBody(name: string, owner: string) {
  return {
    name,
    owner_object_id: owner,
    owner_display_name: "Synthetic Owner",
    description: `violet ${name}`,
    url: "https://notes.example.internal",
    revision: "rev-1",
  };
}

async function approveBinding(
  requester: string,
  decider: string,
  appName: string,
  repoId: string,
): Promise<void> {
  const pending = await jsonOf(
    approvals.POST(
      request("POST", "/api/approvals", await userToken(requester), {
        app_name: appName,
        bitbucket_repo: "launchpad/experiment-notes",
        environment: "dev",
        pipeline_client_id: randomUUID(),
        federated_subject: `repository:launchpad/experiment-notes:environment:${appName}`,
        ci_provider: "bitbucket",
        repo_id: repoId,
      }),
    ),
  );
  assert.equal(pending.status, 201);
  const approvalId = (pending.body.data as { id: string }[])[0].id;
  const approved = await jsonOf(
    decision.POST(
      request(
        "POST",
        `/api/approvals/${approvalId}/decision`,
        await userToken(decider),
        { decision: "approved" },
      ),
      { params: Promise.resolve({ approvalId }) },
    ),
  );
  assert.equal(approved.status, 200);
}

test("first login creates Catalog.Read and a later role change is audited", async () => {
  const reader = randomUUID();
  const owner = randomUUID();
  await promote(owner);
  const created = await jsonOf(
    apps.GET(request("GET", "/api/apps", await userToken(reader))),
  );
  assert.equal(created.status, 200);
  const [row] = await sql<
    { role: string }[]
  >`SELECT role FROM users WHERE object_id = ${reader}::uuid`;
  assert.equal(row.role, "Catalog.Read");
  const changed = await jsonOf(
    roles.POST(
      request("POST", "/api/roles", await userToken(owner), {
        object_id: reader,
        role: "Catalog.Approve",
      }),
    ),
  );
  assert.equal(changed.status, 200);
  const self = await jsonOf(
    roles.POST(
      request("POST", "/api/roles", await userToken(owner), {
        object_id: owner,
        role: "Catalog.Read",
      }),
    ),
  );
  assert.equal(self.status, 403);
  const [audit] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM audit_events
    WHERE action = 'role_changed' AND record_id = ${reader}
  `;
  assert.equal(Number(audit.n), 1);
});

test("approval, self-approval, register, retire, search, and the open-request cap", async () => {
  const approver = randomUUID();
  const second = randomUUID();
  const repoId = `{${randomUUID()}}`;
  const otherRepo = `{${randomUUID()}}`;
  const clientId = randomUUID();
  const name = `n${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const description = `violet ${name}`;
  await promote(approver);
  await promote(second);
  const approval = {
    app_name: name,
    bitbucket_repo: "launchpad/experiment-notes",
    environment: "dev",
    pipeline_client_id: clientId,
    federated_subject: `repository:launchpad/experiment-notes:environment:${name}`,
    ci_provider: "bitbucket",
    repo_id: repoId,
  };
  const pending = await jsonOf(
    approvals.POST(
      request("POST", "/api/approvals", await userToken(approver), approval),
    ),
  );
  assert.equal(pending.status, 201);
  const approvalId = (pending.body.data as { id: string }[])[0].id;
  const self = await jsonOf(
    decision.POST(
      request(
        "POST",
        `/api/approvals/${approvalId}/decision`,
        await userToken(approver),
        { decision: "approved" },
      ),
      { params: Promise.resolve({ approvalId }) },
    ),
  );
  assert.equal(self.status, 403);
  assert.equal(
    (self.body.error as { code: string }).code,
    "self_approval_rejected",
  );
  const approved = await jsonOf(
    decision.POST(
      request(
        "POST",
        `/api/approvals/${approvalId}/decision`,
        await userToken(second),
        { decision: "approved" },
      ),
      { params: Promise.resolve({ approvalId }) },
    ),
  );
  assert.equal(approved.status, 200);
  const stored = (
    approved.body.data as {
      approver_subject: string;
      federated_subject: string;
    }[]
  )[0];
  assert.equal(stored.approver_subject, `subject-${second}`);
  assert.equal(stored.federated_subject, approval.federated_subject);

  const registerBody = {
    name,
    owner_object_id: second,
    owner_display_name: "Synthetic Owner",
    description: `violet ${name}`,
    url: "https://notes.example.internal",
    revision: "rev-1",
  };
  const created = await jsonOf(
    apps.POST(
      request("POST", "/api/apps", await bitbucketToken(repoId), registerBody),
    ),
  );
  assert.equal(created.status, 201);
  const mismatch = await jsonOf(
    apps.POST(
      request("POST", "/api/apps", await bitbucketToken(otherRepo), {
        ...registerBody,
        description: "nope",
      }),
    ),
  );
  assert.equal(mismatch.status, 403);
  assert.equal(
    (mismatch.body.error as { code: string }).code,
    "app_not_bound",
  );
  const updated = await jsonOf(
    apps.POST(
      request("POST", "/api/apps", await bitbucketToken(repoId), {
        ...registerBody,
        description: `${description} revised`,
        revision: "rev-2",
        url: "https://notes.example.internal/v2",
        owner_display_name: "Changed",
      }),
    ),
  );
  assert.equal(updated.status, 200);
  const app = (
    updated.body.data as {
      description: string;
      revision: string;
      owner_display_name: string;
      status: string;
    }[]
  )[0];
  assert.equal(app.description, `${description} revised`);
  assert.equal(app.revision, "rev-2");
  assert.equal(app.owner_display_name, "Synthetic Owner");
  assert.equal(app.status, "active");

  const retired = await jsonOf(
    patch.PATCH(
      request("PATCH", `/api/apps/${name}`, await userToken(approver), {
        status: "retired",
      }),
      {
        params: Promise.resolve({ name }),
      },
    ),
  );
  assert.equal(retired.status, 200);
  await apps.POST(
    request("POST", "/api/apps", await bitbucketToken(repoId), {
      ...registerBody,
      description: `${description} still`,
      revision: "rev-3",
    }),
  );
  const [row] = await sql<{ status: string; description: string }[]>`
    SELECT status, description FROM apps WHERE name = ${name}
  `;
  assert.equal(row.status, "retired");
  assert.equal(row.description, `${description} still`);
  const byDescription = await jsonOf(
    apps.GET(
      request(
        "GET",
        `/api/apps?q=${encodeURIComponent(`${description} still`)}&status=retired`,
        await userToken(second),
      ),
    ),
  );
  assert.equal(byDescription.status, 200);
  assert.equal((byDescription.body.data as unknown[]).length, 1);
  const byOwner = await jsonOf(
    apps.GET(request("GET", "/api/apps?q=Synthetic", await userToken(second))),
  );
  assert.equal(
    (byOwner.body.data as { name: string }[]).some(
      (item) => item.name === name,
    ),
    false,
  );

  const capped = randomUUID();
  for (let index = 0; index < 5; index += 1) {
    const result = await approvals.POST(
      request("POST", "/api/approvals", await userToken(capped), {
        ...approval,
        app_name: `n${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      }),
    );
    assert.equal(result.status, 201);
  }
  const sixth = await jsonOf(
    approvals.POST(
      request("POST", "/api/approvals", await userToken(capped), {
        ...approval,
        app_name: `n${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      }),
    ),
  );
  assert.equal(sixth.status, 409);
  assert.equal(
    (sixth.body.error as { code: string }).code,
    "approval_cap_reached",
  );
});

test("a pipeline token bound to one app cannot register another", async () => {
  const requester = randomUUID();
  const decider = randomUUID();
  const repoId = `{${randomUUID()}}`;
  const nameA = `n${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const nameB = `n${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await promote(requester);
  await promote(decider);
  await approveBinding(requester, decider, nameA, repoId);
  const created = await jsonOf(
    apps.POST(
      request(
        "POST",
        "/api/apps",
        await bitbucketToken(repoId),
        registerBody(nameA, decider),
      ),
    ),
  );
  assert.equal(created.status, 201);
  const cross = await jsonOf(
    apps.POST(
      request(
        "POST",
        "/api/apps",
        await bitbucketToken(repoId),
        registerBody(nameB, decider),
      ),
    ),
  );
  assert.equal(cross.status, 403);
  assert.equal((cross.body.error as { code: string }).code, "app_not_bound");
});

test("an Entra user token on the register route is the wrong caller type", async () => {
  const requester = randomUUID();
  const decider = randomUUID();
  const repoId = `{${randomUUID()}}`;
  const name = `n${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await promote(requester);
  await promote(decider);
  await approveBinding(requester, decider, name, repoId);
  const result = await jsonOf(
    apps.POST(
      request(
        "POST",
        "/api/apps",
        await userToken(decider),
        registerBody(name, decider),
      ),
    ),
  );
  assert.equal(result.status, 403);
  assert.equal(
    (result.body.error as { code: string }).code,
    "wrong_caller_type",
  );
});

test("a listed app includes updated_at", async () => {
  const requester = randomUUID();
  const approver = randomUUID();
  const repoId = `{${randomUUID()}}`;
  const name = `n${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await promote(requester);
  await promote(approver);
  await approveBinding(requester, approver, name, repoId);
  const created = await jsonOf(
    apps.POST(
      request(
        "POST",
        "/api/apps",
        await bitbucketToken(repoId),
        registerBody(name, approver),
      ),
    ),
  );
  assert.equal(created.status, 201);
  const listed = await jsonOf(
    apps.GET(
      request("GET", `/api/apps?q=${encodeURIComponent(name)}`, await userToken(approver)),
    ),
  );
  assert.equal(listed.status, 200);
  const app = (listed.body.data as { name: string; updated_at: string }[]).find(
    (item) => item.name === name,
  );
  assert.ok(app);
  assert.match(app.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("an inactive user is rejected", async () => {
  const oid = randomUUID();
  await apps.GET(request("GET", "/api/apps", await userToken(oid)));
  await sql`UPDATE users SET active = false WHERE object_id = ${oid}::uuid`;
  const response = await apps.GET(
    request("GET", "/api/apps", await userToken(oid)),
  );
  assert.equal(response.status, 403);
});

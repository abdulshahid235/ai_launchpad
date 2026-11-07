import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const NAMES = [
  "AZURE_TENANT_ID",
  "AZURE_SPA_CLIENT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_AUDIENCE",
  "DATABASE_URL",
] as const;

const previous = Object.fromEntries(
  NAMES.map((name) => [name, process.env[name]]),
) as Record<(typeof NAMES)[number], string | undefined>;

function restore(): void {
  for (const name of NAMES) {
    const value = previous[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("config route returns the runtime ids and no secrets", async () => {
  process.env.AZURE_TENANT_ID = "11111111-1111-4111-8111-111111111111";
  process.env.AZURE_SPA_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
  process.env.AZURE_CLIENT_ID = "33333333-3333-4333-8333-333333333333";
  process.env.AZURE_AUDIENCE = "api://catalog-dev";
  process.env.DATABASE_URL =
    "postgres://catalog:super-secret-token@db.example:5432/catalog";
  const { GET } = await import("../src/app/api/config/route");
  const first = (await (await GET()).json()) as Record<string, unknown>;
  assert.deepEqual(first, {
    tenantId: "11111111-1111-4111-8111-111111111111",
    clientId: "22222222-2222-4222-8222-222222222222",
    scope: "api://catalog-dev",
  });
  assert.equal(JSON.stringify(first).includes("super-secret-token"), false);

  process.env.AZURE_TENANT_ID = "44444444-4444-4444-8444-444444444444";
  process.env.AZURE_SPA_CLIENT_ID = "55555555-5555-4555-8555-555555555555";
  process.env.AZURE_AUDIENCE = "api://catalog-qa";
  const second = (await (await GET()).json()) as Record<string, unknown>;
  assert.deepEqual(second, {
    tenantId: "44444444-4444-4444-8444-444444444444",
    clientId: "55555555-5555-4555-8555-555555555555",
    scope: "api://catalog-qa",
  });

  delete process.env.AZURE_SPA_CLIENT_ID;
  delete process.env.AZURE_AUDIENCE;
  const fallback = (await (await GET()).json()) as Record<string, unknown>;
  assert.equal(fallback.clientId, "33333333-3333-4333-8333-333333333333");
  assert.equal(fallback.scope, "33333333-3333-4333-8333-333333333333");
  restore();
});

test("browser config source has no NEXT_PUBLIC build constant", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const relative of [
    "src/lib/public-config.ts",
    "src/app/layout.tsx",
    "src/app/api/config/route.ts",
  ]) {
    const source = readFileSync(join(root, relative), "utf8");
    assert.equal(source.includes("NEXT_PUBLIC_"), false, relative);
  }
});

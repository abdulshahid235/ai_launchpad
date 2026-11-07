import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const catalogRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(catalogRoot, "..");
loadEnv({ path: join(repoRoot, ".env") });

process.env.APP_ENV = process.env.APP_ENV || "local";
process.env.LOCAL_AUTH_MODE = process.env.LOCAL_AUTH_MODE || "true";
process.env.DB_DRIVER = process.env.DB_DRIVER || "pglite";
process.env.AUTH_ISSUER =
  process.env.AUTH_ISSUER || "http://127.0.0.1:9100";
process.env.AUTH_AUDIENCE =
  process.env.AUTH_AUDIENCE || "api://catalog-local";
process.env.JWKS_URI =
  process.env.JWKS_URI || `${process.env.AUTH_ISSUER}/jwks`;
process.env.AZURE_CLIENT_ID =
  process.env.AZURE_CLIENT_ID || process.env.AUTH_AUDIENCE;
process.env.AZURE_SPA_CLIENT_ID =
  process.env.AZURE_SPA_CLIENT_ID || "catalog-local";
process.env.AZURE_AUDIENCE =
  process.env.AZURE_AUDIENCE || process.env.AUTH_AUDIENCE;
process.env.AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || "local";

const port = Number(process.env.PGLITE_PORT || 54329);
const host = "127.0.0.1";
process.env.DATABASE_URL =
  process.env.DATABASE_URL?.trim() ||
  `postgres://postgres:postgres@${host}:${port}/postgres`;
process.env.PGLITE_DATA_DIR = resolve(
  repoRoot,
  process.env.PGLITE_DATA_DIR?.trim() || ".data/pglite",
);

const children = [];
const node = process.execPath;

function runNode(script, args = []) {
  const child = spawn(node, [script, ...args], {
    cwd: catalogRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  return child;
}

function runNext(args) {
  const nextBin = join(
    catalogRoot,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const child = spawn(node, [nextBin, ...args], {
    cwd: catalogRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const db = runNode("scripts/pglite-server.mjs");
db.on("exit", (code) => {
  if (code && code !== 0) shutdown(code);
});

async function waitForDb(attempts = 30) {
  const { default: postgres } = await import("postgres");
  for (let i = 0; i < attempts; i += 1) {
    const sql = postgres(process.env.DATABASE_URL, {
      max: 1,
      ssl: false,
      connect_timeout: 2,
    });
    try {
      await sql`select 1`;
      await sql.end({ timeout: 1 });
      return;
    } catch {
      await sql.end({ timeout: 1 }).catch(() => {});
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
  }
  throw new Error("pglite did not accept connections in time");
}

await waitForDb();

const migrate = spawn(node, ["scripts/migrate.mjs"], {
  cwd: catalogRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});
await new Promise((resolveMigrate, reject) => {
  migrate.on("exit", (code) => {
    if (code === 0) resolveMigrate();
    else reject(new Error(`migrate exited ${code}`));
  });
});

if (process.env.CATALOG_BOOTSTRAP_APPROVER_OID) {
  const boot = spawn(node, ["scripts/bootstrap-approver.mjs"], {
    cwd: catalogRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  await new Promise((resolveBoot) => boot.on("exit", () => resolveBoot()));
}

const nextDev = runNext(["dev", "-p", "3000"]);
nextDev.on("exit", (code) => shutdown(code ?? 0));

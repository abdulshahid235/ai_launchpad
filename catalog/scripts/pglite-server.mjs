import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = resolve(
  root,
  process.env.PGLITE_DATA_DIR?.trim() || ".data/pglite",
);
const port = Number(process.env.PGLITE_PORT || 54329);
const host = "127.0.0.1";

mkdirSync(dataDir, { recursive: true });

const db = await PGlite.create({ dataDir });
await db.waitReady;

const server = new PGLiteSocketServer({ db, host, port });
await server.start();

const url = `postgres://postgres:postgres@${host}:${port}/postgres`;
process.env.DATABASE_URL = process.env.DATABASE_URL?.trim() || url;
process.env.DB_DRIVER = "pglite";

console.log(`pglite listening on ${host}:${port}`);
console.log(`DATABASE_URL=${process.env.DATABASE_URL}`);

function shutdown() {
  void (async () => {
    try {
      await server.stop();
    } catch {
      // [DEBUG] pglite socket stop failed — process is exiting anyway
    }
    try {
      await db.close();
    } catch {
      // [DEBUG] pglite close failed — process is exiting anyway
    }
    process.exit(0);
  })();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep the event loop alive for concurrently.
await new Promise(() => {});

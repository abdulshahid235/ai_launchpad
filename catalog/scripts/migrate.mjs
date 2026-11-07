import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSql } from "./pg.mjs";

// [HNI-CICD-06] Run this from the pipeline before the container update. The app does not call it.
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const sql = openSql();

try {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  const applied = await sql`SELECT filename FROM schema_migrations`;
  const done = new Set(applied.map((row) => row.filename));
  for (const filename of files) {
    if (done.has(filename)) continue;
    const body = readFileSync(join(migrationsDir, filename), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (filename) VALUES (${filename})`;
    });
    console.log(`applied ${filename}`);
  }
} catch (error) {
  // [DEBUG] migration failed — open the SQL file named above and the database error on the server
  console.error("migration failed", error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

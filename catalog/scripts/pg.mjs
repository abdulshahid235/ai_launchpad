import { readFileSync } from "node:fs";
import postgres from "postgres";

function driver() {
  return (process.env.DB_DRIVER ?? "pg").trim().toLowerCase();
}

export function sslOption() {
  // [HNI-PRIV-04] Encrypt the connection. Trust an explicit CA file, or the public CA bundle.
  if (driver() === "pglite") return false;
  const file = process.env.DATABASE_SSL_CA_FILE;
  if (file) return { ca: readFileSync(file, "utf8"), rejectUnauthorized: true };
  return { rejectUnauthorized: true };
}

export function openSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  return postgres(url, {
    max: 1,
    ssl: sslOption(),
    connect_timeout: 15,
  });
}

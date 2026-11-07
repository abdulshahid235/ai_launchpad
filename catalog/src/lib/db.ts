import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";

function driver(): string {
  return (process.env.DB_DRIVER ?? "pg").trim().toLowerCase();
}

// [HNI-PRIV-04] Encrypt the connection. Trust an explicit CA file, or the public CA bundle.
export function sslOption():
  | { rejectUnauthorized: true; ca?: string }
  | false {
  // Local PGlite socket has no TLS. Real Azure Postgres always uses TLS.
  if (driver() === "pglite") return false;
  const file = process.env.DATABASE_SSL_CA_FILE;
  if (file) {
    return { ca: readFileSync(file, "utf8"), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: true };
}

let client: Sql | undefined;

export function getSql(): Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!client) {
    // [HNI-DB-02] postgres.js tagged templates parameterize values.
    // DB_DRIVER=pglite keeps this client; a socket process speaks the wire protocol.
    client = postgres(url, {
      max: driver() === "pglite" ? 1 : 4,
      ssl: sslOption(),
      connect_timeout: 10,
    });
  }
  return client;
}

export async function closeSql(): Promise<void> {
  if (!client) return;
  const current = client;
  client = undefined;
  await current.end({ timeout: 5 });
}

export type { Sql };

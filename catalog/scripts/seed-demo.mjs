import { openSql } from "./pg.mjs";

const appEnv = (process.env.APP_ENV ?? "").trim() || "prod";
const localAuth = (process.env.LOCAL_AUTH_MODE ?? "").trim() === "true";
if (!localAuth || appEnv !== "local") {
  console.error(
    "Seed requires LOCAL_AUTH_MODE=true and APP_ENV=local. Refusing to run.",
  );
  process.exit(1);
}

const OWNER = "00000000-0000-4000-8000-0000000000b2";
const APPS = [
  {
    name: "atlas",
    owner: "Synthetic Owner",
    description:
      "Maps the synthetic launch workspace and keeps the running link next to the owner.",
    url: "https://atlas.localhost",
    status: "active",
  },
  {
    name: "beacon",
    owner: "Demo Steward",
    description:
      "Signals when a registered app is ready for the local demo. This description is long enough to clamp to two lines on the card so the grid stays even.",
    url: "https://beacon.localhost",
    status: "active",
  },
  {
    name: "field-notes",
    owner: "Catalog Owner",
    description: "Captures synthetic field notes for the catalog demo.",
    url: "http://field-notes.localhost",
    status: "active",
  },
  {
    name: "launch-checklist",
    owner: "Sample Owner",
    description: "Walks through the local launch steps without leaving the catalog.",
    url: "https://launch-checklist.localhost",
    status: "active",
  },
  {
    name: "archive-tool",
    owner: "Synthetic Owner",
    description:
      "Keeps retired demo records available to read, with launch actions turned off.",
    url: "https://archive-tool.localhost",
    status: "retired",
  },
  {
    name: "roster",
    owner: "Demo Steward",
    description: "Lists the synthetic owners attached to each registered app.",
    url: "https://roster.localhost",
    status: "active",
  },
];

const sql = openSql();
try {
  for (const app of APPS) {
    await sql`
      INSERT INTO apps (
        name, owner_object_id, owner_display_name, description, url, revision, status
      )
      VALUES (
        ${app.name},
        ${OWNER}::uuid,
        ${app.owner},
        ${app.description},
        ${app.url},
        'demo',
        ${app.status}
      )
      ON CONFLICT (name) DO NOTHING
    `;
  }
  console.log("Synthetic demo apps are present.");
} catch {
  // [DEBUG] demo seed failed — confirm migrations have run and APP_ENV is local
  console.error("demo seed failed");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

import postgres from "postgres";

const url =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@127.0.0.1:54329/postgres";
const sql = postgres(url, { max: 1, ssl: false, connect_timeout: 10 });
try {
  const rows = await sql`select 1 as n`;
  console.log("ok", rows);
} catch (error) {
  console.error("probe failed", error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}

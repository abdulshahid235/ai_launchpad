import { openSql } from "./pg.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const oid = process.env.CATALOG_BOOTSTRAP_APPROVER_OID ?? "";
if (!UUID.test(oid)) {
  console.error("CATALOG_BOOTSTRAP_APPROVER_OID must be set to an object id.");
  process.exit(1);
}

const sql = openSql();
try {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(80401)`;
    const [approver] = await tx`
      SELECT object_id FROM users WHERE role = 'Catalog.Approve' AND active = true LIMIT 1
    `;
    if (approver) {
      console.log("A Catalog.Approve user already exists. No change.");
      return;
    }
    const [existing] = await tx`SELECT role FROM users WHERE object_id = ${oid}::uuid`;
    if (existing) {
      console.error("That object id already has a catalog user. Refusing to change the role.");
      throw new Error("exists");
    }
    await tx`INSERT INTO users (object_id, role) VALUES (${oid}::uuid, 'Catalog.Approve')`;
    await tx`
      INSERT INTO audit_events (actor, action, record_type, record_id, after_state)
      VALUES ('bootstrap', 'user_created', 'user', ${oid}, ${tx.json({ role: "Catalog.Approve" })})
    `;
    console.log("Catalog.Approve user inserted.");
  });
} catch (err) {
  // [DEBUG] bootstrap failed — confirm migrations have run and the object id is not already a user
  if (!(err instanceof Error) || err.message !== "exists") console.error("bootstrap failed");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

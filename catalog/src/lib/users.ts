import { writeAudit } from "./audit";
import type { Sql } from "./db";
import { ApiError } from "./errors";
import type { VerifiedUser } from "./auth";

export type ActiveUser = VerifiedUser & {
  role: "Catalog.Read" | "Catalog.Approve";
};

export async function openUser(
  sql: Sql,
  caller: VerifiedUser,
): Promise<ActiveUser> {
  // [HNI-AUTH-05] First valid login creates Catalog.Read. Later logins do not change the role.
  const inserted = await sql<{ object_id: string }[]>`
    INSERT INTO users (object_id, role)
    VALUES (${caller.oid}::uuid, 'Catalog.Read')
    ON CONFLICT (object_id) DO NOTHING
    RETURNING object_id
  `;
  const [row] = await sql<{ role: string; active: boolean }[]>`
    SELECT role, active FROM users WHERE object_id = ${caller.oid}::uuid
  `;
  if (!row || (row.role !== "Catalog.Read" && row.role !== "Catalog.Approve")) {
    throw new ApiError(
      500,
      "internal_error",
      "The catalog could not complete this request.",
    );
  }
  if (!row.active) {
    throw new ApiError(403, "inactive_user", "This user is not active.");
  }
  if (inserted.length > 0) {
    await writeAudit(sql, {
      actor: caller.oid,
      action: "user_created",
      recordType: "user",
      recordId: caller.oid,
      after: { role: "Catalog.Read" },
    });
  }
  return { ...caller, role: row.role };
}

export async function changeRole(
  sql: Sql,
  caller: ActiveUser,
  objectId: string,
  role: "Catalog.Read" | "Catalog.Approve",
): Promise<Record<string, unknown>> {
  if (caller.role !== "Catalog.Approve") {
    throw new ApiError(403, "missing_role", "Catalog.Approve is required.");
  }
  // [HNI-AUTH-08] A platform owner cannot change their own role.
  if (caller.oid === objectId) {
    throw new ApiError(
      403,
      "self_approval_rejected",
      "The caller cannot change their own role.",
    );
  }
  const result = await sql.begin(async (tx) => {
    const [current] = await tx<{ role: string; active: boolean }[]>`
      SELECT role, active FROM users WHERE object_id = ${objectId}::uuid FOR UPDATE
    `;
    if (!current) return { missing: true as const };
    if (!current.active) return { inactive: true as const };
    if (current.role === role) return { unchanged: true as const, role };
    await tx`UPDATE users SET role = ${role} WHERE object_id = ${objectId}::uuid`;
    return { missing: false as const, before: current.role, role };
  });
  if ("missing" in result && result.missing) {
    throw new ApiError(404, "not_found", "No matching record exists.");
  }
  if ("inactive" in result && result.inactive) {
    throw new ApiError(403, "inactive_user", "This user is not active.");
  }
  if ("unchanged" in result && result.unchanged) {
    return { kind: "user", id: objectId, object_id: objectId, role };
  }
  if (!("before" in result)) {
    throw new ApiError(
      500,
      "internal_error",
      "The catalog could not complete this request.",
    );
  }
  await writeAudit(sql, {
    actor: caller.oid,
    action: "role_changed",
    recordType: "user",
    recordId: objectId,
    before: { role: result.before },
    after: { role: result.role },
  });
  return { kind: "user", id: objectId, object_id: objectId, role: result.role };
}

import { verifyEntraToken } from "./auth";
import { writeAudit } from "./audit";
import { verifyCiToken, type CiIdentity } from "./ci-providers";
import type { Sql } from "./db";
import { ApiError } from "./errors";
import {
  decodeCursor,
  encodeCursor,
  likePattern,
  parseAppName,
} from "./validate";
import type { ActiveUser } from "./users";

type AppRow = {
  id: string;
  name: string;
  owner_object_id: string;
  owner_display_name: string | null;
  description: string;
  url: string;
  revision: string;
  status: string;
  updated_at?: Date | string;
  expires_at?: Date | string | null;
};

function updatedAt(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function appResource(row: AppRow): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    kind: "app",
    id: row.id,
    name: row.name,
    owner_object_id: row.owner_object_id,
    description: row.description,
    url: row.url,
    revision: row.revision,
    status: row.status,
  };
  if (row.owner_display_name)
    resource.owner_display_name = row.owner_display_name;
  if (row.updated_at) resource.updated_at = updatedAt(row.updated_at);
  if (row.expires_at) resource.expires_at = updatedAt(row.expires_at);
  return resource;
}

export async function listApps(
  sql: Sql,
  caller: ActiveUser,
  limit: number,
  cursorValue: string | null,
  query: string | null,
  status: "active" | "retired" | null,
): Promise<{
  data: Record<string, unknown>[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const cursor = decodeCursor(cursorValue);
  if (cursor && (!cursor.name || !cursor.id)) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  if (cursor) parseAppName(cursor.name);
  const pattern = query ? likePattern(query) : null;
  // [HNI-DB-02] Filter fragments are SQL constants. Values stay in parameters.
  // [HNI-API-06] q matches name and description only, never the owner.
  const rows = await sql<AppRow[]>`
    SELECT id, name, owner_object_id, owner_display_name, description, url, revision, status, updated_at, expires_at
    FROM apps
    WHERE TRUE
    ${status ? sql`AND status = ${status}` : sql``}
    ${pattern ? sql`AND (name ILIKE ${pattern} ESCAPE '\\' OR description ILIKE ${pattern} ESCAPE '\\')` : sql``}
    ${cursor ? sql`AND (name, id) > (${cursor.name}, ${cursor.id}::uuid)` : sql``}
    ORDER BY name, id
    LIMIT ${limit + 1}
  `;
  const page = rows.slice(0, limit);
  for (const row of page) {
    // [HNI-AUDIT-05] One access record per app returned. Failure does not hide the page.
    await writeAudit(sql, {
      actor: caller.oid,
      action: "app_read",
      recordType: "app",
      recordId: row.id,
    });
  }
  const last = page[page.length - 1];
  return {
    data: page.map(appResource),
    hasMore: rows.length > limit,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ name: last.name, id: last.id })
        : null,
  };
}

function notBound(): ApiError {
  return new ApiError(
    403,
    "app_not_bound",
    "This pipeline is not approved for that app.",
  );
}

// [HNI-AUTH-05] The binding's ci_provider selects the validator. The verified
// repo id must equal the binding's repo_id.
export async function verifyRegisterCaller(
  sql: Sql,
  token: string,
  appName: string,
): Promise<CiIdentity> {
  const [binding] = await sql<
    { ci_provider: string | null; repo_id: string | null }[]
  >`
    SELECT ci_provider, repo_id FROM pipeline_bindings WHERE app_name = ${appName}
  `;
  if (!binding) throw notBound();
  try {
    const caller = await verifyCiToken(binding.ci_provider, token);
    if (
      caller.provider !== binding.ci_provider ||
      caller.repoId !== binding.repo_id
    ) {
      throw notBound();
    }
    return caller;
  } catch (err: unknown) {
    if (!(err instanceof ApiError) || err.code !== "invalid_token") throw err;
    // [HNI-AUTH-05] Same Entra check as user routes. 403 only after signature, iss, aud, and exp succeed.
    await verifyEntraToken(token);
    throw new ApiError(
      403,
      "wrong_caller_type",
      "A user token cannot call this route.",
    );
  }
}

export async function registerApp(
  sql: Sql,
  caller: CiIdentity,
  input: {
    name: string;
    ownerObjectId: string;
    ownerDisplayName: string | null;
    description: string;
    url: string;
    revision: string;
  },
): Promise<{ created: boolean; resource: Record<string, unknown> }> {
  const outcome = await sql.begin(async (tx) => {
    const [binding] = await tx`
      SELECT app_name FROM pipeline_bindings
      WHERE app_name = ${input.name}
        AND ci_provider = ${caller.provider}
        AND repo_id = ${caller.repoId}
      FOR SHARE
    `;
    if (!binding) throw notBound();
    const [existing] = await tx<AppRow[]>`
      SELECT id, name, owner_object_id, owner_display_name, description, url, revision, status
      FROM apps WHERE name = ${input.name} FOR UPDATE
    `;
    if (!existing) {
      const [created] = await tx<AppRow[]>`
        INSERT INTO apps (name, owner_object_id, owner_display_name, description, url, revision, status)
        VALUES (
          ${input.name},
          ${input.ownerObjectId}::uuid,
          ${input.ownerDisplayName},
          ${input.description},
          ${input.url},
          ${input.revision},
          'active'
        )
        RETURNING id, name, owner_object_id, owner_display_name, description, url, revision, status
      `;
      return { created: true, row: created, before: null };
    }
    const [updated] = await tx<AppRow[]>`
      UPDATE apps
      SET description = ${input.description}, url = ${input.url}, revision = ${input.revision}, updated_at = now()
      WHERE name = ${input.name}
      RETURNING id, name, owner_object_id, owner_display_name, description, url, revision, status
    `;
    return { created: false, row: updated, before: existing };
  });
  const changed =
    outcome.created ||
    outcome.before?.description !== outcome.row.description ||
    outcome.before?.url !== outcome.row.url ||
    outcome.before?.revision !== outcome.row.revision;
  if (changed) {
    await writeAudit(sql, {
      actor: `${caller.provider}:${caller.repoId}`,
      action: outcome.created ? "app_created" : "app_updated",
      recordType: "app",
      recordId: outcome.row.id,
      before: outcome.before
        ? {
            description: outcome.before.description,
            url: outcome.before.url,
            revision: outcome.before.revision,
          }
        : null,
      after: {
        description: outcome.row.description,
        url: outcome.row.url,
        revision: outcome.row.revision,
      },
    });
  }
  return { created: outcome.created, resource: appResource(outcome.row) };
}

export async function patchApp(
  sql: Sql,
  caller: ActiveUser,
  name: string,
  patch: {
    ownerObjectId?: string;
    ownerDisplayName?: string;
    description?: string;
    status?: "active" | "retired";
  },
): Promise<Record<string, unknown>> {
  if (caller.role !== "Catalog.Approve") {
    throw new ApiError(403, "missing_role", "Catalog.Approve is required.");
  }
  const outcome = await sql.begin(async (tx) => {
    const [existing] = await tx<AppRow[]>`
      SELECT id, name, owner_object_id, owner_display_name, description, url, revision, status
      FROM apps WHERE name = ${name} FOR UPDATE
    `;
    if (!existing) return null;
    const next = {
      ownerObjectId: patch.ownerObjectId ?? existing.owner_object_id,
      ownerDisplayName: patch.ownerDisplayName ?? existing.owner_display_name,
      description: patch.description ?? existing.description,
      status: patch.status ?? existing.status,
    };
    const [updated] = await tx<AppRow[]>`
      UPDATE apps
      SET owner_object_id = ${next.ownerObjectId}::uuid,
          owner_display_name = ${next.ownerDisplayName},
          description = ${next.description},
          status = ${next.status},
          updated_at = now()
      WHERE name = ${name}
      RETURNING id, name, owner_object_id, owner_display_name, description, url, revision, status
    `;
    return { before: existing, row: updated };
  });
  if (!outcome)
    throw new ApiError(404, "not_found", "No matching record exists.");
  const before = {
    owner_object_id: outcome.before.owner_object_id,
    owner_display_name: outcome.before.owner_display_name,
    description: outcome.before.description,
    status: outcome.before.status,
  };
  const after = {
    owner_object_id: outcome.row.owner_object_id,
    owner_display_name: outcome.row.owner_display_name,
    description: outcome.row.description,
    status: outcome.row.status,
  };
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    await writeAudit(sql, {
      actor: caller.oid,
      action: "app_patched",
      recordType: "app",
      recordId: outcome.row.id,
      before,
      after,
    });
  }
  return appResource(outcome.row);
}

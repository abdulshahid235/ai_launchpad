import { writeAudit } from "./audit";
import type { Sql } from "./db";
import { ApiError } from "./errors";
import { decodeCursor, encodeCursor, isUuid } from "./validate";
import type { ActiveUser } from "./users";

export const OPEN_APPROVAL_CAP = 5;

type ApprovalRow = {
  id: string;
  app_name: string;
  bitbucket_repo: string;
  environment: string;
  pipeline_client_id: string;
  federated_subject: string;
  ci_provider: string | null;
  repo_id: string | null;
  requester_object_id: string;
  decision: string;
  approver_object_id: string | null;
  approver_subject: string | null;
  created_at: Date | string;
};

function approvalResource(row: ApprovalRow): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    kind: "approval",
    id: row.id,
    app_name: row.app_name,
    bitbucket_repo: row.bitbucket_repo,
    environment: row.environment,
    pipeline_client_id: row.pipeline_client_id,
    federated_subject: row.federated_subject,
    requester_object_id: row.requester_object_id,
    decision: row.decision,
  };
  if (row.ci_provider) resource.ci_provider = row.ci_provider;
  if (row.repo_id) resource.repo_id = row.repo_id;
  if (row.approver_subject) resource.approver_subject = row.approver_subject;
  return resource;
}

function createdAt(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

export async function listApprovals(
  sql: Sql,
  caller: ActiveUser,
  limit: number,
  cursorValue: string | null,
  decision: "pending" | "approved" | "rejected" | null,
): Promise<{
  data: Record<string, unknown>[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const cursor = decodeCursor(cursorValue);
  if (cursor && (!cursor.created_at || !isUuid(cursor.id ?? ""))) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  const ownOnly = caller.role !== "Catalog.Approve";
  const rows = await sql<ApprovalRow[]>`
    SELECT id, app_name, bitbucket_repo, environment, pipeline_client_id, federated_subject,
           ci_provider, repo_id,
           requester_object_id, decision, approver_object_id, approver_subject, created_at
    FROM approvals
    WHERE TRUE
    ${ownOnly ? sql`AND requester_object_id = ${caller.oid}::uuid` : sql``}
    ${decision ? sql`AND decision = ${decision}` : sql``}
    ${cursor ? sql`AND (created_at, id) > (${cursor.created_at}::timestamptz, ${cursor.id}::uuid)` : sql``}
    ORDER BY created_at, id
    LIMIT ${limit + 1}
  `;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    data: page.map(approvalResource),
    hasMore: rows.length > limit,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ created_at: createdAt(last.created_at), id: last.id })
        : null,
  };
}

export async function createApproval(
  sql: Sql,
  caller: ActiveUser,
  input: {
    appName: string;
    bitbucketRepo: string;
    environment: string;
    pipelineClientId: string;
    federatedSubject: string;
    ciProvider: string;
    repoId: string;
  },
): Promise<Record<string, unknown>> {
  const [count] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM approvals
    WHERE requester_object_id = ${caller.oid}::uuid AND decision = 'pending'
  `;
  if (Number(count?.n ?? 0) >= OPEN_APPROVAL_CAP) {
    throw new ApiError(
      409,
      "approval_cap_reached",
      "This caller already has the maximum number of pending approvals.",
    );
  }
  const [duplicate] = await sql`
    SELECT id FROM approvals WHERE app_name = ${input.appName} AND decision = 'pending'
  `;
  if (duplicate) {
    throw new ApiError(
      409,
      "conflict",
      "A pending approval already exists for this app.",
    );
  }
  const [row] = await sql<ApprovalRow[]>`
    INSERT INTO approvals (
      app_name, bitbucket_repo, environment, pipeline_client_id, federated_subject,
      ci_provider, repo_id, requester_object_id
    )
    VALUES (
      ${input.appName},
      ${input.bitbucketRepo},
      ${input.environment},
      ${input.pipelineClientId}::uuid,
      ${input.federatedSubject},
      ${input.ciProvider},
      ${input.repoId},
      ${caller.oid}::uuid
    )
    RETURNING id, app_name, bitbucket_repo, environment, pipeline_client_id, federated_subject,
              ci_provider, repo_id,
              requester_object_id, decision, approver_object_id, approver_subject, created_at
  `;
  await writeAudit(sql, {
    actor: caller.oid,
    action: "approval_created",
    recordType: "approval",
    recordId: row.id,
    after: { decision: "pending", app_name: row.app_name },
  });
  return approvalResource(row);
}

export async function decideApproval(
  sql: Sql,
  caller: ActiveUser,
  approvalId: string,
  decision: "approved" | "rejected",
): Promise<Record<string, unknown>> {
  if (caller.role !== "Catalog.Approve") {
    throw new ApiError(403, "missing_role", "Catalog.Approve is required.");
  }
  const outcome = await sql.begin(async (tx) => {
    const [row] = await tx<ApprovalRow[]>`
      SELECT id, app_name, bitbucket_repo, environment, pipeline_client_id, federated_subject,
             ci_provider, repo_id,
             requester_object_id, decision, approver_object_id, approver_subject, created_at
      FROM approvals WHERE id = ${approvalId}::uuid FOR UPDATE
    `;
    if (!row) return { missing: true as const };
    if (row.decision !== "pending") return { conflict: true as const };
    // [HNI-AUTH-08] Reject the requester, the pipeline client, and a matching federated subject.
    if (
      caller.oid === row.requester_object_id ||
      caller.azp === row.pipeline_client_id ||
      caller.subject === row.federated_subject
    ) {
      throw new ApiError(
        403,
        "self_approval_rejected",
        "The caller cannot approve this request.",
      );
    }
    const [updated] = await tx<ApprovalRow[]>`
      UPDATE approvals
      SET decision = ${decision},
          approver_object_id = ${caller.oid}::uuid,
          approver_subject = ${caller.subject},
          decided_at = now()
      WHERE id = ${approvalId}::uuid
      RETURNING id, app_name, bitbucket_repo, environment, pipeline_client_id, federated_subject,
                ci_provider, repo_id,
                requester_object_id, decision, approver_object_id, approver_subject, created_at
    `;
    if (decision === "approved") {
      const [existing] = await tx<{ pipeline_client_id: string }[]>`
        SELECT pipeline_client_id FROM pipeline_bindings WHERE app_name = ${row.app_name} FOR UPDATE
      `;
      if (existing && existing.pipeline_client_id !== row.pipeline_client_id) {
        throw new ApiError(
          409,
          "conflict",
          "This app is already bound to another pipeline.",
        );
      }
      const [repoTaken] = await tx`
        SELECT app_name FROM pipeline_bindings
        WHERE ci_provider = ${row.ci_provider} AND repo_id = ${row.repo_id}
          AND app_name <> ${row.app_name}
        FOR UPDATE
      `;
      if (repoTaken) {
        throw new ApiError(
          409,
          "conflict",
          "This repository is already bound to another app.",
        );
      }
      await tx`
        INSERT INTO pipeline_bindings (
          app_name, pipeline_client_id, federated_subject, bitbucket_repo, environment,
          ci_provider, repo_id
        )
        VALUES (
          ${row.app_name},
          ${row.pipeline_client_id}::uuid,
          ${row.federated_subject},
          ${row.bitbucket_repo},
          ${row.environment},
          ${row.ci_provider},
          ${row.repo_id}
        )
        ON CONFLICT (app_name) DO UPDATE SET
          federated_subject = EXCLUDED.federated_subject,
          bitbucket_repo = EXCLUDED.bitbucket_repo,
          environment = EXCLUDED.environment,
          ci_provider = EXCLUDED.ci_provider,
          repo_id = EXCLUDED.repo_id
      `;
    }
    return { row: updated, before: row.decision };
  });
  if ("missing" in outcome && outcome.missing) {
    throw new ApiError(404, "not_found", "No matching record exists.");
  }
  if ("conflict" in outcome && outcome.conflict) {
    throw new ApiError(409, "conflict", "This approval was already decided.");
  }
  if (!("row" in outcome)) {
    throw new ApiError(
      500,
      "internal_error",
      "The catalog could not complete this request.",
    );
  }
  await writeAudit(sql, {
    actor: caller.oid,
    action: "approval_decided",
    recordType: "approval",
    recordId: outcome.row.id,
    before: { decision: outcome.before },
    after: { decision: outcome.row.decision, approver_subject: caller.subject },
  });
  return approvalResource(outcome.row);
}

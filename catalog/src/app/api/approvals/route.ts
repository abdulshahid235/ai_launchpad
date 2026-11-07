import { requireUser } from "@/lib/auth";
import { createApproval, listApprovals } from "@/lib/approvals";
import { getSql } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { handle, requireDatabase, successResponse } from "@/lib/http";
import { enforceRate } from "@/lib/rate-limit";
import { openUser } from "@/lib/users";
import {
  parseApproval,
  parseDecisionFilter,
  parseLimit,
  readJson,
} from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handle(request, "list-approvals", async () => {
    const caller = await requireUser(request);
    requireDatabase();
    enforceRate(`approvals:list:${caller.oid}`, 300);
    const sql = getSql();
    if (!sql)
      throw new ApiError(
        503,
        "database_unavailable",
        "The catalog database is not configured.",
      );
    const user = await openUser(sql, caller);
    const url = new URL(request.url);
    const page = await listApprovals(
      sql,
      user,
      parseLimit(url.searchParams.get("limit")),
      url.searchParams.get("cursor"),
      parseDecisionFilter(url.searchParams.get("decision")),
    );
    return successResponse(
      request,
      200,
      page.data,
      page.nextCursor,
      page.hasMore,
    );
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, "create-approval", async () => {
    const caller = await requireUser(request);
    requireDatabase();
    enforceRate(`approvals:create:${caller.oid}`, 30);
    const sql = getSql();
    if (!sql)
      throw new ApiError(
        503,
        "database_unavailable",
        "The catalog database is not configured.",
      );
    const user = await openUser(sql, caller);
    const resource = await createApproval(
      sql,
      user,
      await parseApproval(await readJson(request)),
    );
    return successResponse(request, 201, [resource], null, false);
  });
}

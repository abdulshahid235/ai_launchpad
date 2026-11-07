import { requireUser } from "@/lib/auth";
import { decideApproval } from "@/lib/approvals";
import { getSql } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { handle, requireDatabase, successResponse } from "@/lib/http";
import { enforceRate } from "@/lib/rate-limit";
import { openUser } from "@/lib/users";
import { isUuid, parseDecision, readJson } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ approvalId: string }> },
): Promise<Response> {
  return handle(request, "decide-approval", async () => {
    const caller = await requireUser(request);
    requireDatabase();
    enforceRate(`approvals:decide:${caller.oid}`, 300);
    const { approvalId } = await context.params;
    if (!isUuid(approvalId)) {
      throw new ApiError(
        400,
        "validation_failed",
        "The request did not match the contract.",
      );
    }
    const sql = getSql();
    if (!sql)
      throw new ApiError(
        503,
        "database_unavailable",
        "The catalog database is not configured.",
      );
    const user = await openUser(sql, caller);
    const resource = await decideApproval(
      sql,
      user,
      approvalId,
      parseDecision(await readJson(request)),
    );
    return successResponse(request, 200, [resource], null, false);
  });
}

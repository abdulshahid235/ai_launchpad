import { requireUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { handle, requireDatabase, successResponse } from "@/lib/http";
import { enforceRate } from "@/lib/rate-limit";
import { changeRole, openUser } from "@/lib/users";
import { parseRoleChange, readJson } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handle(request, "change-role", async () => {
    const caller = await requireUser(request);
    requireDatabase();
    enforceRate(`roles:${caller.oid}`, 300);
    const sql = getSql();
    if (!sql)
      throw new ApiError(
        503,
        "database_unavailable",
        "The catalog database is not configured.",
      );
    const user = await openUser(sql, caller);
    const input = parseRoleChange(await readJson(request));
    const resource = await changeRole(sql, user, input.objectId, input.role);
    return successResponse(request, 200, [resource], null, false);
  });
}

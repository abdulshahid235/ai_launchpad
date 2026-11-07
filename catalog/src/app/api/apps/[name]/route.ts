import { requireUser } from "@/lib/auth";
import { patchApp } from "@/lib/apps";
import { getSql } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { handle, requireDatabase, successResponse } from "@/lib/http";
import { enforceRate } from "@/lib/rate-limit";
import { openUser } from "@/lib/users";
import { parseAppName, parsePatch, readJson } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ name: string }> },
): Promise<Response> {
  return handle(request, "patch-app", async () => {
    const caller = await requireUser(request);
    requireDatabase();
    enforceRate(`patch:${caller.oid}`, 300);
    const { name } = await context.params;
    const sql = getSql();
    if (!sql)
      throw new ApiError(
        503,
        "database_unavailable",
        "The catalog database is not configured.",
      );
    const user = await openUser(sql, caller);
    const resource = await patchApp(
      sql,
      user,
      parseAppName(name),
      parsePatch(await readJson(request)),
    );
    return successResponse(request, 200, [resource], null, false);
  });
}

import { bearer, requireUser } from "@/lib/auth";
import { listApps, registerApp, verifyRegisterCaller } from "@/lib/apps";
import { getSql } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { enforceRate } from "@/lib/rate-limit";
import { handle, requireDatabase, successResponse } from "@/lib/http";
import { openUser } from "@/lib/users";
import {
  parseLimit,
  parseQuery,
  parseRegister,
  parseStatus,
  readJson,
} from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handle(request, "list-apps", async () => {
    const caller = await requireUser(request);
    requireDatabase();
    const url = new URL(request.url);
    const query = parseQuery(url.searchParams.get("q"));
    enforceRate(`list:${caller.oid}`, query ? 20 : 300);
    const sql = getSql();
    if (!sql)
      throw new ApiError(
        503,
        "database_unavailable",
        "The catalog database is not configured.",
      );
    const user = await openUser(sql, caller);
    const page = await listApps(
      sql,
      user,
      parseLimit(url.searchParams.get("limit")),
      url.searchParams.get("cursor"),
      query,
      parseStatus(url.searchParams.get("status")),
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
  return handle(request, "register-app", async () => {
    // [HNI-AUTH-05] The CI host's OIDC token is the bearer. A verified Entra token is the wrong caller.
    const token = bearer(request);
    requireDatabase();
    const sql = getSql();
    if (!sql)
      throw new ApiError(
        503,
        "database_unavailable",
        "The catalog database is not configured.",
      );
    const input = parseRegister(await readJson(request));
    const caller = await verifyRegisterCaller(sql, token, input.name);
    enforceRate(`register:${caller.provider}:${caller.repoId}`, 300);
    const result = await registerApp(sql, caller, input);
    return successResponse(
      request,
      result.created ? 201 : 200,
      [result.resource],
      null,
      false,
    );
  });
}

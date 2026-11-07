import { successResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// [HNI-INFRA-07] Unauthenticated, no database, no rate limit, no version or environment.
export function GET(request: Request): Response {
  return successResponse(request, 200, [], null, false);
}

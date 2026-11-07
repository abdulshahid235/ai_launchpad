import { ApiError } from "./errors";

function corsHeaders(request: Request): Headers {
  const headers = new Headers({ "cache-control": "no-store" });
  const origin = request.headers.get("origin");
  const allowed = (process.env.CATALOG_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== "*");
  // [HNI-SEC-10] Reflect only an explicit origin. Never *.
  if (origin && allowed.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "origin");
  }
  return headers;
}

export function errorResponse(
  request: Request,
  status: number,
  code: string,
  message: string,
  retryAfter?: number,
): Response {
  const headers = corsHeaders(request);
  if (retryAfter !== undefined) headers.set("retry-after", String(retryAfter));
  return Response.json({ error: { code, message } }, { status, headers });
}

export function successResponse(
  request: Request,
  status: number,
  data: Record<string, unknown>[],
  nextCursor: string | null,
  hasMore: boolean,
): Response {
  return Response.json(
    { status: "ok", data, next_cursor: nextCursor, has_more: hasMore },
    { status, headers: corsHeaders(request) },
  );
}

export async function handle(
  request: Request,
  route: string,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    if ((process.env.CATALOG_MAX_REPLICAS ?? "1") !== "1") {
      return errorResponse(
        request,
        503,
        "database_unavailable",
        "The catalog database is not configured.",
      );
    }
    return await run();
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      return errorResponse(
        request,
        err.status,
        err.code,
        err.clientMessage,
        err.retryAfter,
      );
    }
    // [DEBUG] data route failed - check the route name in the log; do not log the body or the token
    console.error("request failed", route);
    const code = unavailable(err) ? "database_unavailable" : "internal_error";
    const status = code === "database_unavailable" ? 503 : 500;
    const message =
      status === 503
        ? "The catalog database is not configured."
        : "The catalog could not complete this request.";
    return errorResponse(request, status, code, message);
  }
}

function unavailable(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("code" in err)) return false;
  const code = String((err as { code: unknown }).code);
  return [
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNRESET",
    "08006",
    "57P01",
    "28P01",
  ].includes(code);
}

export function requireDatabase(): void {
  if (!process.env.DATABASE_URL) {
    throw new ApiError(
      503,
      "database_unavailable",
      "The catalog database is not configured.",
    );
  }
}

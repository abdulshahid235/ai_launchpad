import { ApiError } from "./errors";

const windows = new Map<string, number[]>();

// [HNI-SEC-08] In-memory windows are valid only while the catalog stays at one replica.
export function rateLimit(
  key: string,
  limit: number,
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const recent = (windows.get(key) ?? []).filter(
    (stamp) => now - stamp < 60_000,
  );
  if (recent.length >= limit) {
    windows.set(key, recent);
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((recent[0] + 60_000 - now) / 1000)),
    };
  }
  recent.push(now);
  windows.set(key, recent);
  return { ok: true };
}

export function enforceRate(key: string, limit: number): void {
  const result = rateLimit(key, limit);
  if (!result.ok) {
    throw new ApiError(
      429,
      "rate_limited",
      "Too many requests. Retry after the indicated delay.",
      result.retryAfter,
    );
  }
}

export function clearRateLimitForTests(): void {
  if (process.env.NODE_ENV === "test") windows.clear();
}

export type CatalogRow = Record<string, unknown>;

export function cell(row: CatalogRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

export async function catalogJson(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: CatalogRow[] } | { ok: false; message: string }> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      typeof body === "object" && body !== null && "error" in body
        ? body.error
        : null;
    const message =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : "The catalog could not complete this request.";
    return { ok: false, message };
  }
  const data =
    typeof body === "object" &&
    body !== null &&
    "data" in body &&
    Array.isArray(body.data)
      ? body.data.filter(
          (item): item is CatalogRow =>
            typeof item === "object" && item !== null,
        )
      : [];
  return { ok: true, data };
}

import { publicAuthConfig } from "@/lib/public-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Unauthenticated. The body is the public Entra ids and nothing else.
export function GET(): Response {
  const { tenantId, clientId, scope } = publicAuthConfig();
  return Response.json(
    { tenantId, clientId, scope },
    { headers: { "cache-control": "no-store" } },
  );
}

import { withUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unavailable(): Response {
  return Response.json(
    { error: "unavailable", message: "The model gateway is unavailable." },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

function headerValue(name: string): string {
  return process.env[name] ?? "";
}

export const POST = withUser(async () => {
  const serviceKey = headerValue("PORTKEY_SERVICE_KEY");
  const url = headerValue("PORTKEY_GATEWAY_URL");
  if (!serviceKey || !url) return unavailable();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-portkey-api-key": serviceKey,
        "x-portkey-team": headerValue("PORTKEY_TEAM"),
        "x-portkey-feature": headerValue("PORTKEY_FEATURE"),
        "x-portkey-environment": headerValue("PORTKEY_ENVIRONMENT"),
        "x-portkey-model": headerValue("PORTKEY_MODEL"),
      },
      body: JSON.stringify({
        model: headerValue("PORTKEY_MODEL"),
        messages: [{ role: "user", content: "Reply with one word: ready." }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return unavailable();
    return Response.json(
      { status: "ok" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    // [DEBUG] gateway call failed — check PORTKEY_GATEWAY_URL reachability; do not log the service key
    return unavailable();
  }
});

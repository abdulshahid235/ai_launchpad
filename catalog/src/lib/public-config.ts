export type PublicAuthConfig = {
  tenantId: string;
  clientId: string;
  scope: string;
  issuer: string;
  audience: string;
};

function read(name: string): string {
  const raw = process.env[name];
  return typeof raw === "string" ? raw.trim() : "";
}

// Request-time lookup. A NEXT_PUBLIC_* name would be frozen into the image at build.
export function publicAuthConfig(): PublicAuthConfig {
  const audience =
    read("AUTH_AUDIENCE") ||
    read("AZURE_AUDIENCE") ||
    read("AZURE_CLIENT_ID");
  const clientId =
    read("AZURE_SPA_CLIENT_ID") || read("AZURE_CLIENT_ID") || audience;
  const tenantId = read("AZURE_TENANT_ID");
  const issuer = (read("AUTH_ISSUER") || "").replace(/\/$/, "");
  const scope = audience;
  return { tenantId, clientId, scope, issuer, audience };
}

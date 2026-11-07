import { connection } from "next/server";
import type { ReactNode } from "react";
import { localAuthEnabled } from "@/lib/local-auth";
import { publicAuthConfig } from "@/lib/public-config";
import { Session } from "./session";
import "./globals.css";

export const metadata = { title: "App Launchpad" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  const { clientId, tenantId, scope, issuer, audience } = publicAuthConfig();
  const localAuth = localAuthEnabled();
  const msal = Boolean(clientId && tenantId && scope) && !localAuth;
  return (
    <html lang="en">
      <body>
        <Session
          clientId={clientId}
          tenantId={tenantId}
          scope={scope}
          issuer={issuer}
          audience={audience}
          msal={msal}
          localAuth={localAuth}
        >
          {children}
        </Session>
      </body>
    </html>
  );
}

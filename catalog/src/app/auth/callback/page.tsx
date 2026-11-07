"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function requiredConfig(): {
  issuer: string;
  clientId: string;
  audience: string;
} {
  const issuer = sessionStorage.getItem("oidc_issuer") || "";
  const clientId = sessionStorage.getItem("oidc_client_id") || "";
  const audience = sessionStorage.getItem("oidc_audience") || clientId;
  return { issuer, clientId, audience };
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Completing sign-in…");

  useEffect(() => {
    void (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const err = params.get("error");
        if (err) {
          setMessage(`Sign-in failed: ${err}`);
          return;
        }
        if (!code) {
          setMessage("Sign-in failed: missing authorization code.");
          return;
        }
        const verifier = sessionStorage.getItem("oidc_pkce_verifier");
        const { issuer, clientId, audience } = requiredConfig();
        if (!verifier || !issuer || !clientId) {
          setMessage("Sign-in failed: missing PKCE state. Start again from Apps.");
          return;
        }
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          redirect_uri: `${window.location.origin}/auth/callback`,
          code_verifier: verifier,
          resource: audience,
        });
        const tokenResponse = await fetch(`${issuer}/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        });
        const tokenBody = (await tokenResponse.json()) as {
          access_token?: string;
          error?: string;
        };
        if (!tokenResponse.ok || !tokenBody.access_token) {
          setMessage(
            `Sign-in failed: ${tokenBody.error || tokenResponse.status}`,
          );
          return;
        }
        sessionStorage.setItem("launchpad_access_token", tokenBody.access_token);
        document.cookie = `launchpad_token=${encodeURIComponent(tokenBody.access_token)}; Path=/; SameSite=Lax`;
        sessionStorage.removeItem("oidc_pkce_verifier");
        router.replace("/");
      } catch {
        // [DEBUG] auth callback failed — check redirect_uri against auth-mock clients
        setMessage("Sign-in did not complete.");
      }
    })();
  }, [router]);

  return (
    <main>
      <p className="notice" role="status">
        {message}
      </p>
    </main>
  );
}

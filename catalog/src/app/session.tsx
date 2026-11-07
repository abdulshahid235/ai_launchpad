"use client";

import { PublicClientApplication } from "@azure/msal-browser";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { initialOf, readClaims } from "./ui";

type SessionValue = {
  token: string;
  oid: string;
  name: string;
  msal: boolean;
  localAuth: boolean;
  signIn: () => void;
  openDev: () => void;
};

const SessionContext = createContext<SessionValue>({
  token: "",
  oid: "",
  name: "",
  msal: false,
  localAuth: false,
  signIn: () => {},
  openDev: () => {},
});

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

export function useAccessToken(): string {
  return useContext(SessionContext).token;
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = Array.from(bytes, (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

export function Session({
  clientId,
  tenantId,
  scope,
  issuer,
  audience,
  msal,
  localAuth,
  children,
}: {
  clientId: string;
  tenantId: string;
  scope: string;
  issuer: string;
  audience: string;
  msal: boolean;
  localAuth: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [devOpen, setDevOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const claims = useMemo(() => readClaims(token), [token]);
  const localOidc = Boolean(localAuth && issuer && clientId && audience);

  useEffect(() => {
    const stored = sessionStorage.getItem("launchpad_access_token");
    if (stored) setToken(stored);
  }, []);

  useEffect(() => {
    if (!devOpen) return;
    tokenInputRef.current?.focus();
    function onPointer(event: MouseEvent): void {
      if (!popoverRef.current?.contains(event.target as Node)) setDevOpen(false);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setDevOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [devOpen]);

  async function signInLocalOidc(): Promise<void> {
    try {
      const { verifier, challenge } = await pkcePair();
      sessionStorage.setItem("oidc_pkce_verifier", verifier);
      sessionStorage.setItem("oidc_issuer", issuer);
      sessionStorage.setItem("oidc_client_id", clientId);
      sessionStorage.setItem("oidc_audience", audience);
      const url = new URL("/auth", issuer);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid profile access_as_user");
      url.searchParams.set(
        "redirect_uri",
        `${window.location.origin}/auth/callback`,
      );
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("resource", audience);
      window.location.assign(url.toString());
    } catch {
      // [DEBUG] local OIDC start failed — check AUTH_ISSUER and auth-mock /auth
      setMessage("Sign-in did not complete.");
    }
  }

  async function signInMsal(): Promise<void> {
    try {
      const app = new PublicClientApplication({
        auth: {
          clientId,
          authority: `https://login.microsoftonline.com/${tenantId}`,
          redirectUri: window.location.origin,
        },
      });
      await app.initialize();
      const result = await app.loginPopup({ scopes: [scope] });
      setToken(result.accessToken);
      sessionStorage.setItem("launchpad_access_token", result.accessToken);
      setMessage("");
    } catch {
      // [DEBUG] MSAL popup failed - check the browser network log and the Entra redirect URI
      setMessage("Sign-in did not complete.");
    }
  }

  async function signIn(): Promise<void> {
    if (localOidc) {
      await signInLocalOidc();
      return;
    }
    await signInMsal();
  }

  function applyToken(event: FormEvent): void {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    setToken(next);
    sessionStorage.setItem("launchpad_access_token", next);
    setDraft("");
    setMessage("");
    setDevOpen(false);
  }

  const onApps = pathname === "/";
  const onApprovals = pathname.startsWith("/approvals");
  const chipLabel = claims.name || "Signed in";

  return (
    <SessionContext.Provider
      value={{
        token,
        oid: claims.oid,
        name: claims.name,
        msal: msal && !localOidc,
        localAuth,
        signIn: () => void signIn(),
        openDev: () => setDevOpen(true),
      }}
    >
      <header className="top">
        <div className="brand">App Launchpad</div>
        <nav>
          <Link href="/" aria-current={onApps ? "page" : undefined}>
            Apps
          </Link>
          <Link href="/approvals" aria-current={onApprovals ? "page" : undefined}>
            Approvals
          </Link>
        </nav>
        <div className="header-end">
          {localAuth ? (
            <div className="popover" ref={popoverRef}>
              <button
                type="button"
                className="button button-quiet"
                aria-expanded={devOpen}
                aria-controls="dev-token-panel"
                onClick={() => setDevOpen((open) => !open)}
              >
                Dev
              </button>
              {devOpen ? (
                <form
                  id="dev-token-panel"
                  className="popover-panel"
                  role="dialog"
                  aria-label="Development token"
                  onSubmit={applyToken}
                >
                  <label>
                    Dev token
                    <input
                      ref={tokenInputRef}
                      type="password"
                      autoComplete="off"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                  </label>
                  <button type="submit" className="button">
                    Use token
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
          {token ? (
            <span className="chip">
              <span className="avatar avatar-sm" aria-hidden="true">
                {initialOf(chipLabel)}
              </span>
              <span className="chip-label">{chipLabel}</span>
            </span>
          ) : (
            <span className="chip chip-quiet">Signed out</span>
          )}
        </div>
      </header>
      {message ? (
        <p className="notice" role="alert">
          {message}
        </p>
      ) : null}
      {children}
    </SessionContext.Provider>
  );
}

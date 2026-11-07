"use client";

import { useEffect, useState } from "react";
import { catalogJson, cell, type CatalogRow } from "./catalog-fetch";
import { useSession } from "./session";
import {
  CardShell,
  countText,
  EmptyState,
  ErrorState,
  PageHeading,
  relativeUpdated,
  rowTimestamp,
  safeHttpUrl,
  SearchField,
  Segment,
  SignedOut,
  SkeletonGrid,
} from "./ui";

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "retired", label: "Retired" },
] as const;

type Phase = "signed-out" | "loading" | "ready" | "error";

export function AppsTable() {
  const { token, msal, localAuth, signIn } = useSession();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [phase, setPhase] = useState<Phase>("signed-out");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [trackedToken, setTrackedToken] = useState(token);
  if (token !== trackedToken) {
    setTrackedToken(token);
    setRows([]);
    setPhase(token ? "loading" : "signed-out");
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (status) params.set("status", status);
        const path = params.size > 0 ? `/api/apps?${params}` : "/api/apps";
        try {
          const result = await catalogJson(token, path);
          if (cancelled) return;
          if (!result.ok) {
            setRows([]);
            setError(result.message);
            setPhase("error");
            return;
          }
          setRows(result.data);
          setError("");
          setPhase("ready");
        } catch {
          // [DEBUG] app list failed - check the browser network log for GET /api/apps
          if (cancelled) return;
          setRows([]);
          setError("The catalog could not load apps.");
          setPhase("error");
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [token, query, status, reload]);

  const onSignIn = msal || localAuth ? signIn : undefined;
  const showCount = Boolean(token) && (phase === "ready" || (phase === "loading" && rows.length > 0));
  const filtered = query.trim().length > 0 || status.length > 0;

  let body = null;
  if (!token) {
    body = <SignedOut text="Sign in to see registered apps." onSignIn={onSignIn} />;
  } else if (phase === "error") {
    body = <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} />;
  } else if (rows.length === 0 && phase !== "ready") {
    body = <SkeletonGrid label="Loading apps" />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        text={filtered ? "No apps match this filter." : "No apps are registered."}
      />
    );
  } else {
    body = (
      <div className="cards">
        {rows.map((row) => {
          const name = cell(row, "name");
          const appStatus = cell(row, "status");
          const retired = appStatus === "retired";
          const href = retired ? null : safeHttpUrl(cell(row, "url"));
          const owner = cell(row, "owner_display_name") || "Owner not listed";
          const updated = relativeUpdated(rowTimestamp(row));
          return (
            <CardShell
              key={cell(row, "id") || name}
              name={name || "Untitled app"}
              status={appStatus}
              retired={retired}
            >
              <p className="clamp">{cell(row, "description")}</p>
              <p className="meta">
                {updated ? `${owner} · updated ${updated}` : owner}
              </p>
              {href ? (
                <a className="button" href={href} target="_blank" rel="noopener noreferrer">
                  Open app
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <button type="button" className="button" disabled>
                  Open app
                </button>
              )}
            </CardShell>
          );
        })}
      </div>
    );
  }

  return (
    <section>
      <PageHeading
        title="Apps"
        count={showCount ? countText(rows.length, "app", "apps") : undefined}
      />
      {token ? (
        <form className="toolbar" role="search" onSubmit={(event) => event.preventDefault()}>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Name or description"
          />
          <Segment
            label="Status"
            value={status}
            options={STATUS_OPTIONS}
            onChange={setStatus}
          />
        </form>
      ) : null}
      {body}
    </section>
  );
}

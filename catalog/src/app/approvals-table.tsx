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
  Segment,
  SignedOut,
  SkeletonGrid,
} from "./ui";

const DECISION_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "", label: "Any" },
] as const;

type Phase = "signed-out" | "loading" | "ready" | "error";

export function ApprovalsTable() {
  const { token, oid, msal, localAuth, signIn, openDev } = useSession();
  const [decision, setDecision] = useState("pending");
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [phase, setPhase] = useState<Phase>("signed-out");
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState("");
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
        if (decision) params.set("decision", decision);
        const path = params.size > 0 ? `/api/approvals?${params}` : "/api/approvals";
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
          // [DEBUG] approval list failed - check the browser network log for GET /api/approvals
          if (cancelled) return;
          setRows([]);
          setError("The catalog could not load approvals.");
          setPhase("error");
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [token, decision, reload]);

  async function decide(id: string, next: "approved" | "rejected"): Promise<void> {
    if (!token || busy) return;
    setBusy(id);
    setBanner("");
    try {
      const result = await catalogJson(token, `/api/approvals/${id}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision: next }),
      });
      if (!result.ok) {
        setBanner(result.message);
        return;
      }
      setReload((value) => value + 1);
    } catch {
      // [DEBUG] approval decision failed - check the browser network log for the decision route
      setBanner("The catalog could not record the decision.");
    } finally {
      setBusy("");
    }
  }

  const onSignIn = msal ? signIn : localAuth ? openDev : undefined;
  const showCount = Boolean(token) && (phase === "ready" || (phase === "loading" && rows.length > 0));

  let body = null;
  if (!token) {
    body = <SignedOut text="Sign in to review approvals." onSignIn={onSignIn} />;
  } else if (phase === "error") {
    body = <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} />;
  } else if (rows.length === 0 && phase !== "ready") {
    body = <SkeletonGrid label="Loading approvals" />;
  } else if (rows.length === 0) {
    body = <EmptyState text="No approvals in this list." />;
  } else {
    body = (
      <div className="cards">
        {rows.map((row) => {
          const id = cell(row, "id");
          const appName = cell(row, "app_name") || "Untitled app";
          const requester = cell(row, "requester_object_id");
          const repo = cell(row, "bitbucket_repo");
          const environment = cell(row, "environment");
          const current = cell(row, "decision");
          const pending = current === "pending";
          const same =
            oid.length > 0 &&
            requester.length > 0 &&
            oid.toLowerCase() === requester.toLowerCase();
          // Readers only receive their own rows. Another person's row is a platform owner.
          const canDecide = pending && oid.length > 0 && !same;
          const repoLine = [repo, environment].filter((part) => part.length > 0).join(" · ");
          return (
            <CardShell key={id || appName} name={appName} status={current}>
              <p className="meta">Requester {requester || "Unknown"}</p>
              <p className="meta">{repoLine || "Repository not listed"}</p>
              {pending && same ? (
                <p className="self-note">You can&apos;t approve your own request</p>
              ) : null}
              {canDecide ? (
                <div className="actions">
                  <button
                    type="button"
                    className="button"
                    disabled={busy === id}
                    onClick={() => void decide(id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy === id}
                    onClick={() => void decide(id, "rejected")}
                  >
                    Reject
                  </button>
                </div>
              ) : null}
            </CardShell>
          );
        })}
      </div>
    );
  }

  return (
    <section>
      <PageHeading
        title="Approvals"
        count={showCount ? countText(rows.length, "approval", "approvals") : undefined}
        lede="A platform owner approves or rejects a request for someone else."
      />
      {banner ? (
        <p className="notice banner" role="alert">
          {banner}
        </p>
      ) : null}
      {token ? (
        <div className="toolbar">
          <Segment
            label="Decision"
            value={decision}
            options={DECISION_OPTIONS}
            onChange={setDecision}
          />
        </div>
      ) : null}
      {body}
    </section>
  );
}

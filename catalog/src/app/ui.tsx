"use client";

import type { ReactNode } from "react";
import type { CatalogRow } from "./catalog-fetch";

export function safeHttpUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.href;
}

export function readClaims(token: string): { oid: string; name: string } {
  const segment = token.split(".")[1];
  if (!segment) return { oid: "", name: "" };
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const pad =
      padded.length % 4 === 0 ? padded : padded + "=".repeat(4 - (padded.length % 4));
    const payload: unknown = JSON.parse(atob(pad));
    if (typeof payload !== "object" || payload === null) return { oid: "", name: "" };
    const record = payload as Record<string, unknown>;
    return {
      oid: typeof record.oid === "string" ? record.oid : "",
      name: typeof record.name === "string" ? record.name : "",
    };
  } catch {
    // [DEBUG] token payload was not readable - the chip falls back to a generic label
    return { oid: "", name: "" };
  }
}

export function initialOf(name: string): string {
  const char = Array.from(name.trim())[0];
  return char ? char.toUpperCase() : "?";
}

export function rowTimestamp(row: CatalogRow): string {
  const value = row.updated_at;
  return typeof value === "string" ? value.trim() : "";
}

export function relativeUpdated(value: string): string {
  const then = Date.parse(value);
  if (Number.isNaN(then)) return "";
  const delta = then - Date.now();
  const abs = Math.abs(delta);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < minute) return format.format(Math.round(delta / 1000), "second");
  if (abs < hour) return format.format(Math.round(delta / minute), "minute");
  if (abs < day) return format.format(Math.round(delta / hour), "hour");
  if (abs < week) return format.format(Math.round(delta / day), "day");
  if (abs < month) return format.format(Math.round(delta / week), "week");
  if (abs < year) return format.format(Math.round(delta / month), "month");
  return format.format(Math.round(delta / year), "year");
}

export function statusLabel(status: string): string {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function statusTone(status: string): "good" | "wait" | "muted" {
  if (status === "active" || status === "approved") return "good";
  if (status === "pending") return "wait";
  return "muted";
}

export function countText(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function IconSearch() {
  return (
    <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path d="M16 16.5 20 20.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconTray() {
  return (
    <svg className="state-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8h16l-1.5 10h-13L4 8Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M4 8 6.2 5h11.6L20 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 12.5h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg className="state-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 19.5c1.2-3 3.4-4.5 6.5-4.5s5.3 1.5 6.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg className="state-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="16.25" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search">
      <span className="sr-only">Search</span>
      <IconSearch />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function Segment({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="segment" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill-${statusTone(status)}`}>{statusLabel(status)}</span>;
}

export function SignedOut({
  text,
  onSignIn,
}: {
  text: string;
  onSignIn?: () => void;
}) {
  return (
    <div className="state">
      <IconUser />
      <p>{text}</p>
      {onSignIn ? (
        <button type="button" className="button" onClick={onSignIn}>
          Sign in
        </button>
      ) : (
        <p>Sign-in is not configured.</p>
      )}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="state">
      <IconTray />
      <p>{text}</p>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="state" role="alert">
      <IconAlert />
      <p>{message}</p>
      <button type="button" className="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export function SkeletonGrid({ label }: { label: string }) {
  return (
    <div className="cards" aria-busy="true">
      <p className="sr-only">{label}</p>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="card skeleton" aria-hidden="true" />
      ))}
    </div>
  );
}

export function PageHeading({
  title,
  count,
  lede,
}: {
  title: string;
  count?: string;
  lede?: string;
}) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {count ? <p className="count">{count}</p> : null}
      {lede ? <p className="lede">{lede}</p> : null}
    </div>
  );
}

export function CardShell({
  name,
  status,
  retired,
  children,
}: {
  name: string;
  status: string;
  retired?: boolean;
  children: ReactNode;
}) {
  return (
    <article className={retired ? "card card-retired" : "card"} tabIndex={0} aria-label={name}>
      <div className="card-top">
        <span className="avatar" aria-hidden="true">
          {initialOf(name)}
        </span>
        <div className="card-heading">
          <h2>{name}</h2>
          <StatusPill status={status} />
        </div>
      </div>
      {children}
    </article>
  );
}

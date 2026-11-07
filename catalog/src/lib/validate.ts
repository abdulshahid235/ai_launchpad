import { isCiProvider, parseRepoId } from "./ci-providers";
import { ApiError } from "./errors";

const APP_NAME = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTPS_URL = /^https:\/\/\S+$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ENVIRONMENTS = new Set(["dev", "qa", "production"]);
const STATUSES = new Set(["active", "retired"]);
const ROLES = new Set(["Catalog.Read", "Catalog.Approve"]);
const DECISIONS = new Set(["pending", "approved", "rejected"]);

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJson(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) {
      throw new ApiError(
        400,
        "validation_failed",
        "The request did not match the contract.",
      );
    }
    return body;
  } catch (err: unknown) {
    if (err instanceof ApiError) throw err;
    // [DEBUG] body was not a JSON object - compare Content-Type with the catalog contract
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
}

function rejectUnknown(body: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw new ApiError(
        400,
        "validation_failed",
        "The request did not match the contract.",
      );
    }
  }
}

function text(value: unknown, min: number, max: number): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  return value;
}

export function parseAppName(value: unknown): string {
  const name = text(value, 1, 63);
  if (!APP_NAME.test(name)) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  return name;
}

export function parseRegister(body: Record<string, unknown>): {
  name: string;
  ownerObjectId: string;
  ownerDisplayName: string | null;
  description: string;
  url: string;
  revision: string;
} {
  rejectUnknown(body, [
    "name",
    "owner_object_id",
    "owner_display_name",
    "description",
    "url",
    "revision",
  ]);
  const ownerObjectId = text(body.owner_object_id, 36, 36);
  if (!isUuid(ownerObjectId)) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  const url = text(body.url, 8, 300);
  const revision = text(body.revision, 1, 128);
  if (!HTTPS_URL.test(url) || /[\u0000-\u001f]/.test(revision)) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  let ownerDisplayName: string | null = null;
  if (body.owner_display_name !== undefined) {
    ownerDisplayName = text(body.owner_display_name, 1, 200);
  }
  return {
    name: parseAppName(body.name),
    ownerObjectId,
    ownerDisplayName,
    description: text(body.description, 1, 500),
    url,
    revision,
  };
}

export function parsePatch(body: Record<string, unknown>): {
  ownerObjectId?: string;
  ownerDisplayName?: string;
  description?: string;
  status?: "active" | "retired";
} {
  rejectUnknown(body, [
    "owner_object_id",
    "owner_display_name",
    "description",
    "status",
  ]);
  const patch: {
    ownerObjectId?: string;
    ownerDisplayName?: string;
    description?: string;
    status?: "active" | "retired";
  } = {};
  if (body.owner_object_id !== undefined) {
    const ownerObjectId = text(body.owner_object_id, 36, 36);
    if (!isUuid(ownerObjectId)) {
      throw new ApiError(
        400,
        "validation_failed",
        "The request did not match the contract.",
      );
    }
    patch.ownerObjectId = ownerObjectId;
  }
  if (body.owner_display_name !== undefined)
    patch.ownerDisplayName = text(body.owner_display_name, 1, 200);
  if (body.description !== undefined)
    patch.description = text(body.description, 1, 500);
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !STATUSES.has(body.status)) {
      throw new ApiError(
        400,
        "validation_failed",
        "The request did not match the contract.",
      );
    }
    patch.status = body.status as "active" | "retired";
  }
  if (Object.keys(patch).length === 0) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  return patch;
}

export function parseApproval(body: Record<string, unknown>): {
  appName: string;
  bitbucketRepo: string;
  environment: "dev" | "qa" | "production";
  pipelineClientId: string;
  federatedSubject: string;
  ciProvider: string;
  repoId: string;
} {
  rejectUnknown(body, [
    "app_name",
    "bitbucket_repo",
    "environment",
    "pipeline_client_id",
    "federated_subject",
    "ci_provider",
    "repo_id",
  ]);
  const pipelineClientId = text(body.pipeline_client_id, 36, 36);
  const environment = body.environment;
  const federatedSubject = text(body.federated_subject, 1, 512);
  const bitbucketRepo = text(body.bitbucket_repo, 3, 200);
  const ciProvider = text(body.ci_provider, 1, 32);
  // [HNI-AUTH-05] Only a provider with a token validator can be bound.
  if (!isCiProvider(ciProvider)) {
    throw new ApiError(
      403,
      "unknown_ci_provider",
      "This CI provider is not supported.",
    );
  }
  const repoId = parseRepoId(ciProvider, text(body.repo_id, 1, 200));
  if (
    repoId === null ||
    !isUuid(pipelineClientId) ||
    typeof environment !== "string" ||
    !ENVIRONMENTS.has(environment) ||
    !REPO.test(bitbucketRepo) ||
    /[\u0000-\u001f]/.test(federatedSubject)
  ) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  return {
    appName: parseAppName(body.app_name),
    bitbucketRepo,
    environment: environment as "dev" | "qa" | "production",
    pipelineClientId,
    federatedSubject,
    ciProvider,
    repoId,
  };
}

export function parseDecision(
  body: Record<string, unknown>,
): "approved" | "rejected" {
  rejectUnknown(body, ["decision"]);
  if (body.decision !== "approved" && body.decision !== "rejected") {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  return body.decision;
}

export function parseRoleChange(body: Record<string, unknown>): {
  objectId: string;
  role: "Catalog.Read" | "Catalog.Approve";
} {
  rejectUnknown(body, ["object_id", "role"]);
  const objectId = text(body.object_id, 36, 36);
  if (
    !isUuid(objectId) ||
    typeof body.role !== "string" ||
    !ROLES.has(body.role)
  ) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  return { objectId, role: body.role as "Catalog.Read" | "Catalog.Approve" };
}

export function parseLimit(value: string | null): number {
  if (value === null) return 50;
  if (!/^\d+$/.test(value)) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  const limit = Number(value);
  if (limit < 1 || limit > 100) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  return limit;
}

export function parseStatus(value: string | null): "active" | "retired" | null {
  if (value === null) return null;
  if (!STATUSES.has(value)) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  return value as "active" | "retired";
}

export function parseDecisionFilter(
  value: string | null,
): "pending" | "approved" | "rejected" | null {
  if (value === null) return null;
  if (!DECISIONS.has(value)) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  return value as "pending" | "approved" | "rejected";
}

export function parseQuery(value: string | null): string | null {
  if (value === null || value === "") return null;
  if (value.length > 80) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  return value;
}

export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function encodeCursor(value: Record<string, string>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor(
  value: string | null,
): Record<string, string> | null {
  if (value === null) return null;
  if (value.length > 512) {
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!isRecord(parsed)) throw new Error("cursor");
    const cursor: Record<string, string> = {};
    for (const [key, item] of Object.entries(parsed)) {
      if (typeof item !== "string") throw new Error("cursor");
      cursor[key] = item;
    }
    return cursor;
  } catch (err: unknown) {
    if (err instanceof ApiError) throw err;
    // [DEBUG] cursor was not the keyset token this service issued
    throw new ApiError(
      400,
      "validation_failed",
      "The request did not match the contract.",
    );
  }
}

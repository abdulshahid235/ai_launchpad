import type { Sql } from "./db";

type AuditInput = {
  actor: string;
  action: string;
  recordType: string;
  recordId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

// [HNI-API-07] One write path. A failed audit does not undo the business change.
export async function writeAudit(sql: Sql, input: AuditInput): Promise<void> {
  try {
    const before = input.before ? JSON.stringify(input.before) : null;
    const after = input.after ? JSON.stringify(input.after) : null;
    await sql`
      INSERT INTO audit_events (actor, action, record_type, record_id, before_state, after_state)
      VALUES (
        ${input.actor},
        ${input.action},
        ${input.recordType},
        ${input.recordId},
        ${before}::jsonb,
        ${after}::jsonb
      )
    `;
  } catch {
    // [DEBUG] audit insert failed - check audit_events triggers, disk, and the database role
    console.error("audit write failed", input.action, input.recordType);
  }
}

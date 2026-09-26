/**
 * Outbox health and dead-letter replay, shared by the studio (one
 * academy, under tenant RLS) and the console (every academy, as
 * app_console). The queries carry no tenant filter: the role and its
 * policies decide which events are in view.
 *
 * Payloads are never returned. They can carry a learner's details, and
 * the error and the event type are enough to decide on a replay.
 */
import type { QueryResultRow } from 'pg';

interface Queries {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<T>;
  maybeOne<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<T | null>;
}

export const DEAD_SHOWN = 50;
const STATUSES = ['pending', 'in_flight', 'delivered', 'failed', 'dead'] as const;

export const deadLetterSchema = {
  type: 'object',
  required: ['id', 'tenantId', 'academy', 'eventType', 'retryCount', 'lastError', 'createdAt'],
  properties: {
    id: { type: 'string' }, tenantId: { type: 'string' }, academy: { type: 'string' },
    eventType: { type: 'string' }, retryCount: { type: 'integer' },
    lastError: { type: ['string', 'null'] }, createdAt: { type: 'string' },
  },
} as const;

export const healthSchema = {
  type: 'object', required: ['counts', 'oldestPendingAt', 'dead'],
  properties: {
    counts: { type: 'object', required: [...STATUSES], properties: Object.fromEntries(STATUSES.map((s) => [s, { type: 'integer' }])) },
    oldestPendingAt: { type: ['string', 'null'] },
    dead: { type: 'array', items: deadLetterSchema },
  },
} as const;

interface DeadRow { id: string; tenantId: string; academy: string; eventType: string; retryCount: number; lastError: string | null; createdAt: Date }

/**
 * Counts by status, how long the oldest undelivered event has waited,
 * and the most recent dead letters. `academyName` says how to name the
 * academy: the studio may not read app.tenants, the console may.
 */
export async function outboxHealth(db: Queries, academyName: string) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<(typeof STATUSES)[number], number>;
  for (const r of await db.query<{ status: (typeof STATUSES)[number]; n: number }>(
    'SELECT status, count(*)::int AS n FROM app.outbox_events GROUP BY status')) counts[r.status] = r.n;

  const oldest = await db.one<{ at: Date | null }>(
    `SELECT min(created_at) AS at FROM app.outbox_events WHERE status IN ('pending', 'in_flight', 'failed')`);
  const dead = await db.query<DeadRow>(
    `SELECT e.id, e.tenant_id AS "tenantId", ${academyName} AS academy, e.event_type AS "eventType",
            e.retry_count AS "retryCount", e.last_error AS "lastError", e.created_at AS "createdAt"
       FROM app.outbox_events e
      WHERE e.status = 'dead'
      ORDER BY e.created_at DESC LIMIT ${DEAD_SHOWN}`);
  return {
    counts,
    oldestPendingAt: oldest.at?.toISOString() ?? null,
    dead: dead.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
  };
}

export type ReplayResult =
  | { ok: true; id: string; tenantId: string; eventType: string; lastError: string | null }
  | { ok: false; reason: 'not_found' | 'not_dead' };

/**
 * Sends a dead letter round again from the start: pending, no attempts
 * counted, available now. Only a dead event: one still being retried
 * is left to its own schedule.
 */
export async function replayDeadLetter(db: Queries, id: string): Promise<ReplayResult> {
  const current = await db.maybeOne<{ status: string }>('SELECT status FROM app.outbox_events WHERE id = $1 FOR UPDATE', [id]);
  if (!current) return { ok: false, reason: 'not_found' };
  if (current.status !== 'dead') return { ok: false, reason: 'not_dead' };
  const row = await db.one<{ tenantId: string; eventType: string; lastError: string | null }>(
    `WITH before AS (SELECT last_error FROM app.outbox_events WHERE id = $1)
     UPDATE app.outbox_events
        SET status = 'pending', retry_count = 0, available_at = now(), last_error = NULL
      WHERE id = $1
     RETURNING tenant_id AS "tenantId", event_type AS "eventType", (SELECT last_error FROM before) AS "lastError"`,
    [id],
  );
  return { ok: true, id, ...row };
}

/**
 * Scoped unit of work.
 *
 * The failure mode this exists to prevent: with transaction pooling in
 * front of Postgres, a connection returns to the pool between requests.
 * A tenant applied with SET (session scope) would survive into whoever
 * borrows that connection next, and one broker would read another's
 * learners.
 *
 * Three things stop that here.
 *   1. The tenant is applied with SET LOCAL, inside an explicit
 *      transaction, so it is discarded at COMMIT or ROLLBACK.
 *   2. Every query in a request runs through one pinned client. Work
 *      started with Promise.all cannot pick up a second connection,
 *      because callers never see the pool, only the pinned handle.
 *   3. The connection is reset on release.
 */
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

/** The only database surface a request handler is given. */
export interface ScopedDb {
  readonly tenantId: string;
  readonly actor: string;
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<T>;
  maybeOne<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<T | null>;
  /** Writes an event into the outbox inside this same transaction. */
  enqueue(event: OutboxEvent): Promise<void>;
  /** Appends a hash-chained audit record inside this same transaction. */
  audit(entry: AuditEntry): Promise<void>;
}

export interface OutboxEvent {
  type: string;
  payload: Record<string, unknown>;
  /** Stable across retries. Built from the facts, never from a clock. */
  idempotencyKey: string;
  /** Events sharing a key are delivered in order. Usually the learner id. */
  partitionKey?: string;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Pools                                                               */
/* ------------------------------------------------------------------ */

/** Request path. Runs as app_user, which has no BYPASSRLS. */
export const requestPool = new Pool({
  connectionString: config.databaseUrl,
  max: config.pool.requestMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: config.pool.statementTimeoutMs,
});

/**
 * Control plane. Provisioning and the outbox relay legitimately work
 * across tenants, so they get a separate role and a separate pool. The
 * request path can never acquire this one.
 */
export const controlPool = new Pool({
  connectionString: config.controlDatabaseUrl,
  max: config.pool.controlMax,
  idleTimeoutMillis: 30_000,
});

requestPool.on('error', (err) => logger.error({ err }, 'request pool error'));
controlPool.on('error', (err) => logger.error({ err }, 'control pool error'));

/* ------------------------------------------------------------------ */
/* Unit of work                                                        */
/* ------------------------------------------------------------------ */

export class TenantContextMissingError extends Error {
  constructor() {
    super('a tenant is required to open a scoped unit of work');
    this.name = 'TenantContextMissingError';
  }
}

interface RunOptions {
  tenantId: string;
  actor?: string;
  /** Read-only work takes a cheaper transaction and cannot write. */
  readOnly?: boolean;
}

/**
 * Opens one transaction, pins one client, applies the tenant with
 * SET LOCAL, runs the caller's work, then commits or rolls back.
 *
 * Nothing inside `fn` can reach the pool, so concurrent queries are
 * guaranteed to share the transaction that carries the tenant.
 */
export async function withTenant<T>(
  opts: RunOptions,
  fn: (db: ScopedDb) => Promise<T>,
): Promise<T> {
  if (!opts.tenantId) throw new TenantContextMissingError();

  const client: PoolClient = await requestPool.connect();
  const started = Date.now();
  let committed = false;

  try {
    await client.query(opts.readOnly ? 'BEGIN READ ONLY' : 'BEGIN');

    // SET LOCAL is scoped to this transaction. It cannot survive into
    // the next borrower of this connection. Values are bound rather
    // than interpolated, so a tenant id can never carry SQL with it.
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [opts.tenantId]);
    await client.query(`SELECT set_config('app.actor', $1, true)`, [opts.actor ?? 'system']);

    const db = makeScopedDb(client, opts.tenantId, opts.actor ?? 'system');
    const result = await fn(db);

    await client.query('COMMIT');
    committed = true;
    return result;
  } catch (err) {
    if (!committed) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error({ err: rollbackErr }, 'rollback failed');
      }
    }
    throw err;
  } finally {
    // Belt and braces. SET LOCAL has already expired with the
    // transaction; DISCARD ALL also clears prepared statements,
    // temp tables and any session state a library may have left.
    try {
      await client.query('DISCARD ALL');
    } catch {
      /* the client is being destroyed anyway */
    }
    client.release();
    const ms = Date.now() - started;
    if (ms > config.pool.slowTransactionMs) {
      logger.warn({ ms, tenantId: opts.tenantId }, 'slow transaction');
    }
  }
}

function makeScopedDb(client: PoolClient, tenantId: string, actor: string): ScopedDb {
  const query = async <T extends QueryResultRow>(text: string, values: unknown[] = []) => {
    const res = await client.query<T>(text, values);
    return res.rows;
  };

  return {
    tenantId,
    actor,
    query,
    async one<T extends QueryResultRow>(text: string, values: unknown[] = []) {
      const rows = await query<T>(text, values);
      const row = rows[0];
      if (rows.length !== 1 || row === undefined) {
        throw new Error(`expected exactly one row, received ${rows.length}`);
      }
      return row;
    },
    async maybeOne<T extends QueryResultRow>(text: string, values: unknown[] = []) {
      const rows = await query<T>(text, values);
      if (rows.length > 1) throw new Error(`expected at most one row, received ${rows.length}`);
      return rows[0] ?? null;
    },
    async enqueue(event: OutboxEvent) {
      await client.query(
        `SELECT app.outbox_enqueue($1, $2::jsonb, $3, $4)`,
        [event.type, JSON.stringify(event.payload), event.idempotencyKey, event.partitionKey ?? ''],
      );
    },
    async audit(entry: AuditEntry) {
      await client.query(
        `SELECT app.audit_append($1, $2, $3, $4, $5::jsonb)`,
        [actor, entry.action, entry.entityType, entry.entityId ?? null, JSON.stringify(entry.payload ?? {})],
      );
    },
  };
}

/** Control-plane work. Crosses tenants deliberately, never on request path. */
export async function withControl<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await controlPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function shutdown(): Promise<void> {
  await Promise.allSettled([requestPool.end(), controlPool.end()]);
}

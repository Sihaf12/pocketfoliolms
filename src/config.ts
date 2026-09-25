/** Configuration. Every value is overridable by environment. */
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://app_user@/academy?host=/tmp&port=5433',
  controlDatabaseUrl: process.env.CONTROL_DATABASE_URL ?? 'postgres://app_control@/academy?host=/tmp&port=5433',
  pool: {
    requestMax: Number(process.env.POOL_REQUEST_MAX ?? 20),
    controlMax: Number(process.env.POOL_CONTROL_MAX ?? 4),
    statementTimeoutMs: Number(process.env.STATEMENT_TIMEOUT_MS ?? 8_000),
    slowTransactionMs: Number(process.env.SLOW_TX_MS ?? 1_000),
  },
  outbox: {
    pollMs: Number(process.env.OUTBOX_POLL_MS ?? 1_000),
    perTenant: Number(process.env.OUTBOX_PER_TENANT ?? 4),
    batchSize: Number(process.env.OUTBOX_BATCH ?? 50),
    maxAttempts: Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 5),
    timeoutMs: Number(process.env.OUTBOX_TIMEOUT_MS ?? 5_000),
    staleLockSeconds: Number(process.env.OUTBOX_STALE_LOCK_S ?? 120),
  },
  ai: {
    model: process.env.AI_MODEL ?? 'claude-sonnet-4-6',
    region: process.env.AI_REGION ?? 'uae-north',
    retention: 'none' as const,
  },
} as const;

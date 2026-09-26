/** Configuration. Every value is overridable by environment. */
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://app_user@/academy?host=/tmp&port=5433',
  controlDatabaseUrl: process.env.CONTROL_DATABASE_URL ?? 'postgres://app_control@/academy?host=/tmp&port=5433',
  studioDatabaseUrl: process.env.STUDIO_DATABASE_URL ?? 'postgres://app_studio@/academy?host=/tmp',
  consoleDatabaseUrl: process.env.CONSOLE_DATABASE_URL ?? 'postgres://app_console@/academy?host=/tmp',
  pool: {
    requestMax: Number(process.env.POOL_REQUEST_MAX ?? 20),
    controlMax: Number(process.env.POOL_CONTROL_MAX ?? 4),
    studioMax: Number(process.env.POOL_STUDIO_MAX ?? 8),
    consoleMax: Number(process.env.POOL_CONSOLE_MAX ?? 4),
    statementTimeoutMs: Number(process.env.STATEMENT_TIMEOUT_MS ?? 8_000),
    slowTransactionMs: Number(process.env.SLOW_TX_MS ?? 1_000),
  },
  http: {
    host: process.env.HTTP_HOST ?? '0.0.0.0',
    port: Number(process.env.HTTP_PORT ?? 3000),
    // Shared with the Next.js front end, which sends it with every
    // forwarded request. Forwarded headers without it are refused. Empty
    // means no front end: the Host header alone decides the academy.
    proxySecret: process.env.PROXY_SECRET ?? '',
    webRoot: process.env.WEB_ROOT ?? 'web',
    // Development only. The server refuses to start with it in production.
    insecureDevCookie: process.env.DEV_INSECURE_COOKIE === '1',
  },
  console: {
    // The one host the platform console answers on. Empty disables the console.
    host: (process.env.CONSOLE_HOST ?? '').trim().toLowerCase(),
    // 32 bytes, base64: the key TOTP secrets are encrypted with.
    totpKey: process.env.CONSOLE_TOTP_KEY ?? '',
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

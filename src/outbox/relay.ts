/**
 * Outbox relay.
 *
 * Events are written by the request path inside the business
 * transaction. This worker is the only thing that delivers them, so a
 * slow CRM lengthens a queue rather than making a learner wait.
 *
 * Scheduling is fair-share: each pass takes at most `perTenant` events
 * from any one academy, so a marketing surge at one broker cannot
 * starve the rest of the queue. A broker whose endpoint is timing out
 * and holding connections is capped the same way.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { PoolClient } from 'pg';
import { withControl } from '../db/unitOfWork.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { isBlockedAddress } from '../net/address.js';

export interface OutboxRow {
  id: string;
  tenant_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  retry_count: number;
  partition_key: string;
}

export interface DeliveryTarget {
  url: string;
  secret: string | null;
}

export interface Dispatcher {
  send(target: DeliveryTarget, row: OutboxRow): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* HTTP dispatcher                                                     */
/* ------------------------------------------------------------------ */

export class HttpDispatcher implements Dispatcher {
  constructor(private readonly timeoutMs = config.outbox.timeoutMs) {}

  async send(target: DeliveryTarget, row: OutboxRow): Promise<void> {
    const body = JSON.stringify({
      id: row.id,
      type: row.event_type,
      tenant_id: row.tenant_id,
      occurred_at: new Date().toISOString(),
      data: row.payload,
    });

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      // The receiver dedupes on this, so a retry creates one lead and
      // one commission credit rather than two.
      'idempotency-key': row.idempotency_key,
      'x-event-type': row.event_type,
      'x-delivery-attempt': String(row.retry_count + 1),
      'x-request-id': randomUUID(),
    };

    if (target.secret) {
      const ts = Math.floor(Date.now() / 1000);
      headers['x-signature-timestamp'] = String(ts);
      headers['x-signature'] =
        'sha256=' + createHmac('sha256', target.secret).update(`${ts}.${body}`).digest('hex');
    }

    await post(target.url, headers, body, this.timeoutMs);
  }
}

/**
 * One POST over https, to a public address only. The address is checked
 * inside the connection's own DNS lookup, so the check and the connect
 * see the same answer: a name that resolves to a public address when the
 * admin saves it and to 169.254.169.254 at delivery is refused then.
 * Redirects are not followed, for the same reason.
 */
function post(url: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<void> {
  const target = new URL(url);
  if (target.protocol !== 'https:') return Promise.reject(new Error('refused: the CRM endpoint must use https'));
  const literal = target.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) && isBlockedAddress(literal)) {
    return Promise.reject(new Error(`refused: ${literal} is not a public address`));
  }

  const lookup: LookupFunction = (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      const list = addresses as LookupAddress[];
      const blocked = list.find((a) => isBlockedAddress(a.address));
      if (blocked || list.length === 0) {
        const refusal = Object.assign(new Error(`refused: ${hostname} resolves to ${blocked?.address ?? 'nothing'}, not a public address`), { code: 'EADDRNOTPUBLIC' });
        return callback(refusal, '', 0);
      }
      if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      const first = list[0]!;
      callback(null, first.address, first.family);
    });
  };

  return new Promise((resolve, reject) => {
    const req = httpsRequest(target, {
      method: 'POST',
      headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
      lookup,
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => { if (size < 4096) { chunks.push(c); size += c.length; } });
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) return resolve();
        reject(new Error(`HTTP ${status} ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`));
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end(body);
  });
}
/* ------------------------------------------------------------------ */
/* Relay                                                               */
/* ------------------------------------------------------------------ */

export interface RelayOptions {
  workerId?: string;
  perTenant?: number;
  batchSize?: number;
  maxAttempts?: number;
  dispatcher?: Dispatcher;
}

export interface PassResult {
  claimed: number;
  delivered: number;
  failed: number;
  dead: number;
  byTenant: Record<string, number>;
}

export class OutboxRelay {
  private readonly workerId: string;
  private readonly perTenant: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly dispatcher: Dispatcher;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(opts: RelayOptions = {}) {
    this.workerId = opts.workerId ?? `relay-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.perTenant = opts.perTenant ?? config.outbox.perTenant;
    this.batchSize = opts.batchSize ?? config.outbox.batchSize;
    this.maxAttempts = opts.maxAttempts ?? config.outbox.maxAttempts;
    this.dispatcher = opts.dispatcher ?? new HttpDispatcher();
  }

  /** One scheduling pass. Exposed so tests can drive it deterministically. */
  async pass(): Promise<PassResult> {
    const result: PassResult = { claimed: 0, delivered: 0, failed: 0, dead: 0, byTenant: {} };

    const claimed = await withControl(async (client) => {
      // Reclaim anything a crashed worker left locked before claiming more.
      await client.query('SELECT app.outbox_reap($1)', [config.outbox.staleLockSeconds]);
      const res = await client.query<OutboxRow>(
        'SELECT * FROM app.outbox_claim_batch($1, $2, $3)',
        [this.workerId, this.perTenant, this.batchSize],
      );
      return res.rows;
    });

    result.claimed = claimed.length;
    if (claimed.length === 0) return result;

    const targets = await this.loadTargets(claimed.map((r) => r.tenant_id));

    // Group by partition so events for one learner stay in order, then
    // run partitions concurrently up to the per-tenant ceiling.
    const partitions = new Map<string, OutboxRow[]>();
    for (const row of claimed) {
      const key = `${row.tenant_id}:${row.partition_key}`;
      const list = partitions.get(key) ?? [];
      list.push(row);
      partitions.set(key, list);
    }

    await Promise.all(
      [...partitions.values()].map(async (rows) => {
        for (const row of rows) {
          result.byTenant[row.tenant_id] = (result.byTenant[row.tenant_id] ?? 0) + 1;
          const target = targets.get(row.tenant_id);
          if (!target) {
            await this.settle(row.id, false, 'tenant has no CRM endpoint configured', result);
            // Nothing later in this partition can be delivered in order
            // either, so stop and let the next pass retry.
            break;
          }
          try {
            await this.dispatcher.send(target, row);
            await this.settle(row.id, true, null, result);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn({ id: row.id, tenant: row.tenant_id, attempt: row.retry_count + 1, message },
              'delivery failed, backing off');
            await this.settle(row.id, false, message, result);
            break; // preserve ordering within the partition
          }
        }
      }),
    );

    return result;
  }

  private async settle(id: string, ok: boolean, error: string | null, result: PassResult) {
    const status = await withControl(async (client: PoolClient) => {
      const res = await client.query<{ outbox_settle: string }>(
        'SELECT app.outbox_settle($1, $2, $3, $4) AS outbox_settle',
        [id, ok, error, this.maxAttempts],
      );
      return res.rows[0]?.outbox_settle;
    });
    if (status === 'delivered') result.delivered += 1;
    else if (status === 'dead') {
      result.dead += 1;
      // The payload stays in place with its error, visible in the admin
      // console and replayable once the endpoint returns.
      logger.error({ id, error }, 'event moved to dead letter after max attempts');
    } else result.failed += 1;
  }

  private async loadTargets(tenantIds: string[]): Promise<Map<string, DeliveryTarget>> {
    const unique = [...new Set(tenantIds)];
    const rows = await withControl(async (client) => {
      const res = await client.query<{ id: string; crm_webhook_url: string | null; crm_secret: string | null }>(
        'SELECT id, crm_webhook_url, crm_secret FROM app.tenants WHERE id = ANY($1::uuid[])',
        [unique],
      );
      return res.rows;
    });
    const map = new Map<string, DeliveryTarget>();
    for (const r of rows) {
      if (r.crm_webhook_url) map.set(r.id, { url: r.crm_webhook_url, secret: r.crm_secret });
    }
    return map;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      this.inFlight = this.pass().then(
        (r) => { if (r.claimed > 0) logger.info(r, 'outbox pass'); },
        (err: unknown) => { logger.error({ err }, 'outbox pass failed'); },
      );
      await this.inFlight;
      this.inFlight = null;
      if (this.running) this.timer = setTimeout(loop, config.outbox.pollMs);
    };
    void loop();
    logger.info({ worker: this.workerId }, 'outbox relay started');
  }

  /**
   * No new pass starts; resolves once the one under way has finished, so
   * a restart does not leave claimed events locked until the reaper frees them.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
  }
}

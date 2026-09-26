/**
 * The academy's own settings, for its tenant admins: brand, review
 * sign-offs, domain, and CRM endpoint. Every change is audited.
 *
 * The brand, domain and CRM live on app.tenants, which app_studio cannot
 * touch. They are read and written through the functions in migration
 * 010, each acting on the academy in scope and nothing else.
 *
 * A domain moves only once the academy proves it controls the new one,
 * with a DNS TXT record. The platform owner can override that from the
 * console; both paths are audited.
 */
import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import type { FastifyInstance } from 'fastify';
import type { StudioRole } from '../../../auth/studioSession.js';
import { BRAND_TOKENS, sanitiseBrand, type Tokens } from '../../../../packages/shared/brand.js';
import { checkPalette } from '../../../../packages/shared/contrast.js';
import { isObviouslyInternalHost } from '../../../net/address.js';
import { HttpError } from '../../errors.js';
import { inStudio, requireStudio } from '../../studioScope.js';
import { forgetResolvedHosts, normaliseHost } from '../../tenantScope.js';

const ADMIN: StudioRole[] = ['tenant_admin'];

/** Looks up TXT records. Injected in tests; DNS otherwise. */
export type ResolveTxt = (name: string) => Promise<string[][]>;

export const CHALLENGE_PREFIX = '_academy-challenge';
export const CHALLENGE_VALUE = 'academy-domain-verification=';

export interface SettingsOptions {
  consoleHost: string;
  resolveTxt?: ResolveTxt;
}

const tokenNames = BRAND_TOKENS.map((t) => t.name);

const brandSchema = {
  type: 'object', additionalProperties: false, required: ['sub', 'tokens'],
  properties: {
    sub: { type: 'string', maxLength: 80 },
    tokens: { type: 'object', additionalProperties: { type: 'string', maxLength: 16 } },
  },
} as const;

const pendingSchema = {
  type: ['object', 'null'], required: ['id', 'domain', 'requestedAt', 'record'],
  properties: {
    id: { type: 'string' }, domain: { type: 'string' }, requestedAt: { type: 'string' },
    record: {
      type: 'object', required: ['type', 'name', 'value'],
      properties: { type: { type: 'string' }, name: { type: 'string' }, value: { type: 'string' } },
    },
  },
} as const;

const crmSchema = {
  type: 'object', required: ['url', 'secretHint'],
  properties: { url: { type: ['string', 'null'] }, secretHint: { type: ['string', 'null'] } },
} as const;

interface Current { name: string; primary_domain: string; brand: unknown; crm_webhook_url: string | null; crm_secret_hint: string | null }
interface PendingRow { id: string; domain: string; token: string; requestedAt: Date }

const recordFor = (p: PendingRow) => ({
  type: 'TXT', name: `${CHALLENGE_PREFIX}.${p.domain}`, value: `${CHALLENGE_VALUE}${p.token}`,
});
const shapePending = (p: PendingRow | null) =>
  p && { id: p.id, domain: p.domain, requestedAt: p.requestedAt.toISOString(), record: recordFor(p) };

const PENDING_SQL = `SELECT id, requested_domain AS domain, txt_token AS token, requested_at AS "requestedAt"
                       FROM app.domain_changes WHERE status = 'pending'`;

/** The CRM's host, if the URL is one the relay would deliver to. */
function crmProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Give the full address of the endpoint, starting https://.';
  }
  if (url.protocol !== 'https:') return 'The CRM endpoint must use https.';
  if (url.username || url.password) return 'Put credentials in the signing secret, not the address.';
  if (isObviouslyInternalHost(url.hostname)) return 'The CRM endpoint must be a public address on the internet.';
  return null;
}

export async function studioSettingsRoutes(app: FastifyInstance, opts: SettingsOptions): Promise<void> {
  const resolveTxt: ResolveTxt = opts.resolveTxt ?? ((name) => dns.resolveTxt(name));

  /* Brand ------------------------------------------------------------- */

  app.get('/settings/brand', {
    schema: { response: { 200: { type: 'object', required: ['brand'], properties: { brand: brandSchema } } } },
  }, async (req) =>
    inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      const current = await db.one<Current>('SELECT * FROM app.current_tenant_settings()');
      const { sub, tokens } = sanitiseBrand(current.brand);
      return { brand: { sub, tokens } };
    }));

  app.put<{ Body: { sub: string; tokens: Record<string, string> } }>('/settings/brand', {
    schema: {
      body: brandSchema,
      response: { 200: { type: 'object', required: ['brand'], properties: { brand: brandSchema } } },
    },
  }, async (req) => {
    const unknown = Object.keys(req.body.tokens).filter((k) => !tokenNames.includes(k as keyof Tokens));
    if (unknown.length) {
      throw new HttpError(422, 'unknown_tokens', `An academy sets these ten tokens only: ${tokenNames.join(', ')}.`, { tokens: unknown });
    }
    const brand = sanitiseBrand(req.body);
    if (brand.refused.length) {
      throw new HttpError(422, 'invalid_tokens',
        'Colours are #RGB or #RRGGBB, with no transparency; the radius is whole pixels, such as 12px.', { tokens: brand.refused });
    }
    const palette = checkPalette(brand.tokens);
    if (!palette.ok) {
      const pairs = palette.failures.map((f) => `${f.text} on ${f.on} (${f.use}) is ${f.ratio}:1`).join('; ');
      throw new HttpError(422, 'insufficient_contrast',
        `Text must reach ${palette.failures[0]!.minimum}:1 against what it sits on. ${pairs}.`, { failures: palette.failures });
    }
    return inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      const before = sanitiseBrand((await db.one<Current>('SELECT * FROM app.current_tenant_settings()')).brand);
      const next = { sub: brand.sub, tokens: brand.tokens };
      await db.query('SELECT app.set_current_tenant_brand($1::jsonb)', [JSON.stringify(next)]);
      await db.audit({
        action: 'settings.brand_changed', entityType: 'tenant', entityId: db.tenantId,
        payload: { from: { sub: before.sub, tokens: before.tokens }, to: next },
      });
      return { brand: next };
    });
  });

  /* Review sign-offs -------------------------------------------------- */

  const reviewSchema = { type: 'object', required: ['signoffs'], properties: { signoffs: { type: 'integer' } } } as const;

  app.get('/settings/review', { schema: { response: { 200: reviewSchema } } }, async (req) =>
    inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      const row = await db.maybeOne<{ n: number }>('SELECT review_signoffs AS n FROM app.tenant_settings');
      return { signoffs: row?.n ?? 2 };
    }));

  app.put<{ Body: { signoffs: 2 | 3 } }>('/settings/review', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['signoffs'],
        // Two is the floor: the author and the publisher always differ.
        properties: { signoffs: { type: 'integer', enum: [2, 3] } },
      },
      response: { 200: reviewSchema },
    },
  }, async (req) =>
    inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      const before = await db.maybeOne<{ n: number }>('SELECT review_signoffs AS n FROM app.tenant_settings FOR UPDATE');
      await db.query(
        `INSERT INTO app.tenant_settings (tenant_id, review_signoffs) VALUES (app.current_tenant(), $1)
         ON CONFLICT (tenant_id) DO UPDATE SET review_signoffs = EXCLUDED.review_signoffs, updated_at = now()`,
        [req.body.signoffs],
      );
      await db.audit({
        action: 'settings.review_signoffs_changed', entityType: 'tenant', entityId: db.tenantId,
        payload: { from: before?.n ?? 2, to: req.body.signoffs },
      });
      return { signoffs: req.body.signoffs };
    }));

  /* Domain ------------------------------------------------------------ */

  const domainResponse = {
    type: 'object', required: ['domain', 'pending'],
    properties: { domain: { type: 'string' }, pending: pendingSchema },
  } as const;

  app.get('/settings/domain', { schema: { response: { 200: domainResponse } } }, async (req) =>
    inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      const current = await db.one<Current>('SELECT * FROM app.current_tenant_settings()');
      return { domain: current.primary_domain, pending: shapePending(await db.maybeOne<PendingRow>(PENDING_SQL)) };
    }));

  app.post<{ Body: { domain: string } }>('/settings/domain', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['domain'],
        properties: { domain: { type: 'string', minLength: 3, maxLength: 253 } },
      },
      response: { 201: domainResponse },
    },
  }, async (req, reply) => {
    const domain = normaliseHost(req.body.domain);
    if (!domain || domain !== req.body.domain.trim().toLowerCase()) {
      throw new HttpError(400, 'invalid_domain', 'Give the domain as a plain host name, such as learn.example.com.');
    }
    if (domain === opts.consoleHost) throw new HttpError(400, 'invalid_domain', 'That host is reserved.');

    const result = await inStudio(req, async (db) => {
      const admin = await requireStudio(db, req, ADMIN);
      const current = await db.one<Current>('SELECT * FROM app.current_tenant_settings()');
      if (domain === current.primary_domain) throw new HttpError(409, 'same_domain', 'That is already the academy\'s domain.');
      if ((await db.one<{ taken: boolean }>('SELECT app.domain_in_use($1) AS taken', [domain])).taken) {
        throw new HttpError(409, 'domain_taken', 'Another academy already uses that domain.');
      }
      // One change at a time: a new request replaces the one before it.
      const replaced = await db.maybeOne<{ id: string; domain: string }>(
        `UPDATE app.domain_changes SET status = 'cancelled', resolved_by = $1, resolved_at = now()
          WHERE status = 'pending' RETURNING id, requested_domain AS domain`, [admin.id]);
      const pending = await db.one<PendingRow>(
        `INSERT INTO app.domain_changes (tenant_id, requested_domain, txt_token, requested_by)
         VALUES (app.current_tenant(), $1, $2, $3)
         RETURNING id, requested_domain AS domain, txt_token AS token, requested_at AS "requestedAt"`,
        [domain, randomBytes(24).toString('base64url'), admin.id],
      );
      await db.audit({
        action: 'domain.change_requested', entityType: 'domain_change', entityId: pending.id,
        payload: { from: current.primary_domain, to: domain, replaced: replaced?.id ?? null },
      });
      return { domain: current.primary_domain, pending: shapePending(pending) };
    });
    return reply.status(201).send(result);
  });

  app.delete('/settings/domain/pending', async (req, reply) => {
    await inStudio(req, async (db) => {
      const admin = await requireStudio(db, req, ADMIN);
      const cancelled = await db.maybeOne<{ id: string; domain: string }>(
        `UPDATE app.domain_changes SET status = 'cancelled', resolved_by = $1, resolved_at = now()
          WHERE status = 'pending' RETURNING id, requested_domain AS domain`, [admin.id]);
      if (!cancelled) throw new HttpError(404, 'not_found', 'There is no domain change waiting.');
      await db.audit({
        action: 'domain.change_cancelled', entityType: 'domain_change', entityId: cancelled.id, payload: { domain: cancelled.domain },
      });
    });
    return reply.status(204).send();
  });

  app.post('/settings/domain/verify', {
    schema: {
      response: { 200: { type: 'object', required: ['domain', 'pending'], properties: { domain: { type: 'string' }, pending: { type: 'null' } } } },
    },
  }, async (req) => {
    // DNS is looked up outside the transaction, so a slow resolver holds
    // no connection. The change is re-read and locked before it is applied.
    const pending = await inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      return db.maybeOne<PendingRow>(PENDING_SQL);
    });
    if (!pending) throw new HttpError(404, 'not_found', 'There is no domain change waiting to be verified.');

    const record = recordFor(pending);
    let found: string[];
    try {
      found = (await resolveTxt(record.name)).map((chunks) => chunks.join(''));
    } catch {
      found = [];
    }
    if (!found.includes(record.value)) {
      throw new HttpError(422, 'txt_not_found',
        `No TXT record at ${record.name} holds the value yet. DNS changes can take a while to appear.`, { record });
    }

    const domain = await inStudio(req, async (db) => {
      const admin = await requireStudio(db, req, ADMIN);
      const before = await db.one<Current>('SELECT * FROM app.current_tenant_settings()');
      const still = await db.maybeOne<{ id: string }>(`${PENDING_SQL} AND id = $1 FOR UPDATE`, [pending.id]);
      if (!still) throw new HttpError(409, 'change_moved_on', 'That domain change was cancelled or replaced. Start again.');
      if ((await db.one<{ taken: boolean }>('SELECT app.domain_in_use($1) AS taken', [pending.domain])).taken) {
        throw new HttpError(409, 'domain_taken', 'Another academy has taken that domain since it was requested.');
      }
      const applied = await db.one<{ domain: string }>('SELECT app.apply_domain_change($1, $2) AS domain', [pending.id, admin.id]);
      await db.audit({
        action: 'domain.changed', entityType: 'domain_change', entityId: pending.id,
        payload: { from: before.primary_domain, to: applied.domain, by: 'dns_txt' },
      });
      return applied.domain;
    });
    // The old host stops answering for this academy here; other processes follow within 30 seconds.
    forgetResolvedHosts();
    return { domain, pending: null };
  });

  /* CRM --------------------------------------------------------------- */

  app.get('/settings/crm', { schema: { response: { 200: crmSchema } } }, async (req) =>
    inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      const current = await db.one<Current>('SELECT * FROM app.current_tenant_settings()');
      return { url: current.crm_webhook_url, secretHint: current.crm_secret_hint };
    }));

  app.put<{ Body: { url: string | null; secret?: string; clearSecret?: boolean } }>('/settings/crm', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['url'],
        properties: {
          url: { type: ['string', 'null'], maxLength: 2000 },
          // Write-only: never returned, only its last four characters.
          secret: { type: 'string', minLength: 16, maxLength: 200 },
          clearSecret: { type: 'boolean' },
        },
      },
      response: { 200: crmSchema },
    },
  }, async (req) => {
    const { url, secret, clearSecret = false } = req.body;
    if (url !== null) {
      const problem = crmProblem(url);
      if (problem) throw new HttpError(422, 'invalid_crm_url', problem);
    }
    if (secret !== undefined && clearSecret) {
      throw new HttpError(400, 'conflicting_secret', 'Either set a new secret or clear it, not both.');
    }
    return inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      const before = await db.one<Current>('SELECT * FROM app.current_tenant_settings()');
      await db.query('SELECT app.set_current_tenant_crm($1, $2, $3)', [url, secret ?? null, clearSecret]);
      const after = await db.one<Current>('SELECT * FROM app.current_tenant_settings()');
      await db.audit({
        action: 'settings.crm_changed', entityType: 'tenant', entityId: db.tenantId,
        // The secret itself is never written to the audit log.
        payload: {
          from: before.crm_webhook_url, to: after.crm_webhook_url,
          secret: clearSecret ? 'cleared' : secret !== undefined ? 'replaced' : 'unchanged',
        },
      });
      return { url: after.crm_webhook_url, secretHint: after.crm_secret_hint };
    });
  });
}

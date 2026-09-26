/**
 * Academies, as the platform owner sees them: list, create, look at one,
 * suspend or reactivate. Everything is in the platform audit log.
 *
 * Creating an academy writes the tenant, its settings, a catalogue with
 * every published platform course switched on, and an invitation for
 * its first tenant admin, in one transaction. The invitation link is
 * shown once, in this response.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { hashToken } from '../../../auth/studioSession.js';
import { HttpError, fieldError } from '../../errors.js';
import { inConsole, requireStaff } from '../../consoleScope.js';
import { publicOrigin } from '../../sameOrigin.js';
import { forgetResolvedHosts, normaliseHost } from '../../tenantScope.js';
import { uuid } from '../../schemas.js';
import { SLUG } from '../../../../packages/shared/names.js';

const OWNER = ['platform_owner'] as const;

const tenantSchema = {
  type: 'object',
  required: ['id', 'slug', 'name', 'primaryDomain', 'status', 'createdAt'],
  properties: {
    id: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' },
    primaryDomain: { type: 'string' }, status: { type: 'string' }, createdAt: { type: 'string' },
  },
} as const;

const TENANT_COLUMNS = `id, slug, name, primary_domain AS "primaryDomain", status, created_at AS "createdAt"`;

interface TenantRow { id: string; slug: string; name: string; primaryDomain: string; status: string; createdAt: Date }
const shape = (t: TenantRow) => ({ ...t, createdAt: t.createdAt.toISOString() });

interface CreateBody { slug: string; name: string; primaryDomain: string; adminEmail: string }

export async function consoleTenantRoutes(app: FastifyInstance, opts: { consoleHost: string }): Promise<void> {
  app.get('/tenants', {
    schema: { response: { 200: { type: 'object', required: ['tenants'], properties: { tenants: { type: 'array', items: tenantSchema } } } } },
  }, async (req) =>
    inConsole(async (db) => {
      await requireStaff(db, req, OWNER);
      return { tenants: (await db.query<TenantRow>(`SELECT ${TENANT_COLUMNS} FROM app.tenants ORDER BY name`)).map(shape) };
    }));

  app.post<{ Body: CreateBody }>('/tenants', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['slug', 'name', 'primaryDomain', 'adminEmail'],
        properties: {
          slug: { type: 'string', pattern: SLUG.source },
          name: { type: 'string', minLength: 2, maxLength: 100 },
          primaryDomain: { type: 'string', minLength: 3, maxLength: 253 },
          adminEmail: { type: 'string', format: 'email', maxLength: 254 },
        },
      },
      response: {
        201: {
          type: 'object', required: ['tenant', 'adminInvitation', 'link'],
          properties: {
            tenant: tenantSchema,
            adminInvitation: { type: 'object', required: ['email', 'expiresAt'], properties: { email: { type: 'string' }, expiresAt: { type: 'string' } } },
            link: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const domain = normaliseHost(req.body.primaryDomain);
    if (!domain || domain !== req.body.primaryDomain.trim().toLowerCase()) {
      throw fieldError(400, 'invalid_domain', 'primaryDomain', 'Give the academy\'s domain as a plain host name, such as learn.example.com.');
    }
    if (domain === opts.consoleHost) {
      throw fieldError(400, 'invalid_domain', 'primaryDomain', 'That is the console\'s own host and can never be an academy.');
    }
    const adminEmail = req.body.adminEmail.trim().toLowerCase();
    const token = randomBytes(32).toString('base64url');

    const result = await inConsole(async (db) => {
      const owner = await requireStaff(db, req, OWNER);
      const clash = await db.maybeOne<{ slug: string; primaryDomain: string }>(
        `SELECT slug, primary_domain AS "primaryDomain" FROM app.tenants WHERE slug = $1 OR primary_domain = $2 LIMIT 1`,
        [req.body.slug, domain],
      );
      if (clash) {
        throw clash.slug === req.body.slug
          ? fieldError(409, 'slug_taken', 'slug', 'Another academy already uses that short name.')
          : fieldError(409, 'domain_taken', 'primaryDomain', 'Another academy already uses that domain.');
      }

      const tenant = await db.one<TenantRow>(
        `INSERT INTO app.tenants (slug, name, primary_domain) VALUES ($1, $2, $3) RETURNING ${TENANT_COLUMNS}`,
        [req.body.slug, req.body.name, domain],
      );
      await db.query('INSERT INTO app.tenant_settings (tenant_id) VALUES ($1)', [tenant.id]);
      await db.query(
        `INSERT INTO app.tenant_catalogues (tenant_id, course_id, enabled, position)
         SELECT $1, c.id, true, row_number() OVER (ORDER BY c.tier, c.title)
           FROM platform.courses c WHERE c.owner_tenant_id IS NULL AND c.review_state = 'published'`,
        [tenant.id],
      );
      const invitation = await db.one<{ id: string; expiresAt: Date }>(
        `INSERT INTO app.studio_invitations (tenant_id, email, roles, token_hash, invited_by, invited_by_kind)
         VALUES ($1, $2, ARRAY['tenant_admin'], $3, $4, 'platform') RETURNING id, expires_at AS "expiresAt"`,
        [tenant.id, adminEmail, hashToken(token), owner.id],
      );
      await db.audit({ action: 'tenant.created', entityType: 'tenant', entityId: tenant.id, payload: { slug: tenant.slug, domain } });
      await db.audit({
        action: 'tenant.admin_invited', entityType: 'studio_invitation', entityId: invitation.id,
        payload: { tenant_id: tenant.id, email: adminEmail },
      });
      return { tenant: shape(tenant), adminInvitation: { email: adminEmail, expiresAt: invitation.expiresAt.toISOString() } };
    });

    // This process may have remembered the host as unknown moments ago.
    forgetResolvedHosts();
    const scheme = publicOrigin(req).startsWith('https') ? 'https' : 'http';
    return reply.status(201).send({ ...result, link: `${scheme}://${domain}/studio/invite/${token}` });
  });

  app.get<{ Params: { id: string } }>('/tenants/:id', {
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } },
      response: {
        200: {
          type: 'object', required: ['tenant', 'reviewSignoffs', 'openInvitations', 'pendingDomain', 'firstAdmin'],
          properties: {
            // The first admin's invitation, the one the console makes: whether it is still open.
            firstAdmin: {
              type: ['object', 'null'], required: ['email', 'state', 'expiresAt'],
              properties: { email: { type: 'string' }, state: { type: 'string', enum: ['waiting', 'expired', 'joined'] }, expiresAt: { type: 'string' } },
            },
            tenant: tenantSchema, reviewSignoffs: { type: 'integer' }, openInvitations: { type: 'integer' },
            // A domain the academy asked for and has not yet proved, which the owner may apply.
            pendingDomain: { type: ['string', 'null'] },
          },
        },
      },
    },
  }, async (req) =>
    inConsole(async (db) => {
      await requireStaff(db, req, OWNER);
      const tenant = await db.maybeOne<TenantRow>(`SELECT ${TENANT_COLUMNS} FROM app.tenants WHERE id = $1`, [req.params.id]);
      if (!tenant) throw new HttpError(404, 'not_found', 'No academy with that id.');
      const settings = await db.maybeOne<{ n: number }>(
        'SELECT review_signoffs AS n FROM app.tenant_settings WHERE tenant_id = $1', [tenant.id]);
      const open = await db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.studio_invitations
          WHERE tenant_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, [tenant.id]);
      const pending = await db.maybeOne<{ domain: string }>(
        `SELECT requested_domain AS domain FROM app.domain_changes WHERE tenant_id = $1 AND status = 'pending'`, [tenant.id]);
      const first = await db.maybeOne<{ email: string; accepted: boolean; expired: boolean; expiresAt: Date }>(
        `SELECT email, accepted_at IS NOT NULL AS accepted, expires_at <= now() AS expired, expires_at AS "expiresAt"
           FROM app.studio_invitations
          WHERE tenant_id = $1 AND invited_by_kind = 'platform' AND revoked_at IS NULL
          ORDER BY created_at DESC LIMIT 1`, [tenant.id]);
      return {
        tenant: shape(tenant), reviewSignoffs: settings?.n ?? 2, openInvitations: open.n, pendingDomain: pending?.domain ?? null,
        firstAdmin: first && {
          email: first.email, expiresAt: first.expiresAt.toISOString(),
          state: first.accepted ? 'joined' as const : first.expired ? 'expired' as const : 'waiting' as const,
        },
      };
    }));

  app.patch<{ Params: { id: string }; Body: { status: 'active' | 'suspended' } }>('/tenants/:id', {
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } },
      body: {
        type: 'object', additionalProperties: false, required: ['status'],
        properties: { status: { type: 'string', enum: ['active', 'suspended'] } },
      },
      response: { 200: { type: 'object', required: ['tenant'], properties: { tenant: tenantSchema } } },
    },
  }, async (req) => {
    const tenant = await inConsole(async (db) => {
      await requireStaff(db, req, OWNER);
      const before = await db.maybeOne<{ status: string }>('SELECT status FROM app.tenants WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!before) throw new HttpError(404, 'not_found', 'No academy with that id.');
      const after = await db.one<TenantRow>(
        `UPDATE app.tenants SET status = $2 WHERE id = $1 RETURNING ${TENANT_COLUMNS}`, [req.params.id, req.body.status]);
      await db.audit({
        action: 'tenant.status_changed', entityType: 'tenant', entityId: after.id,
        payload: { from: before.status, to: after.status },
      });
      return after;
    });
    // Other processes follow within the cache's 30 seconds; see the README.
    forgetResolvedHosts();
    return { tenant: shape(tenant) };
  });

  // A new link for the first admin, while their invitation is unused. The
  // old token stops working in the same transaction; the link is shown once.
  app.post<{ Params: { id: string } }>('/tenants/:id/admin-invitation/reissue', {
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } },
      response: {
        201: {
          type: 'object', required: ['email', 'expiresAt', 'link'],
          properties: { email: { type: 'string' }, expiresAt: { type: 'string' }, link: { type: 'string' } },
        },
      },
    },
  }, async (req, reply) => {
    const token = randomBytes(32).toString('base64url');
    const made = await inConsole(async (db) => {
      const owner = await requireStaff(db, req, OWNER);
      const tenant = await db.maybeOne<{ domain: string }>('SELECT primary_domain AS domain FROM app.tenants WHERE id = $1', [req.params.id]);
      if (!tenant) throw new HttpError(404, 'not_found', 'No academy with that id.');
      const old = await db.maybeOne<{ id: string; email: string }>(
        `UPDATE app.studio_invitations SET revoked_at = now()
          WHERE id = (SELECT id FROM app.studio_invitations
                       WHERE tenant_id = $1 AND invited_by_kind = 'platform' AND accepted_at IS NULL AND revoked_at IS NULL
                       ORDER BY created_at DESC LIMIT 1 FOR UPDATE)
          RETURNING id, email`, [req.params.id]);
      if (!old) throw new HttpError(409, 'already_joined', 'The first admin has already joined. Their studio invites anyone else.');
      const row = await db.one<{ id: string; expiresAt: Date }>(
        `INSERT INTO app.studio_invitations (tenant_id, email, roles, token_hash, invited_by, invited_by_kind)
         VALUES ($1, $2, ARRAY['tenant_admin'], $3, $4, 'platform') RETURNING id, expires_at AS "expiresAt"`,
        [req.params.id, old.email, hashToken(token), owner.id]);
      await db.audit({
        action: 'tenant.admin_reinvited', entityType: 'studio_invitation', entityId: row.id,
        payload: { tenant_id: req.params.id, replaces: old.id, email: old.email },
      });
      return { email: old.email, expiresAt: row.expiresAt.toISOString(), domain: tenant.domain };
    });
    const scheme = publicOrigin(req).startsWith('https') ? 'https' : 'http';
    return reply.status(201).send({ email: made.email, expiresAt: made.expiresAt, link: `${scheme}://${made.domain}/studio/invite/${token}` });
  });

  // The owner's way past the DNS check, for an academy that cannot add a
  // TXT record. Only a change the academy itself asked for can be applied.
  app.post<{ Params: { id: string }; Body: { reason: string } }>('/tenants/:id/domain/override', {
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } },
      body: {
        type: 'object', additionalProperties: false, required: ['reason'],
        properties: { reason: { type: 'string', minLength: 5, maxLength: 500 } },
      },
      response: { 200: { type: 'object', required: ['tenant'], properties: { tenant: tenantSchema } } },
    },
  }, async (req) => {
    const tenant = await inConsole(async (db) => {
      const owner = await requireStaff(db, req, OWNER);
      const before = await db.maybeOne<{ domain: string }>(
        'SELECT primary_domain AS domain FROM app.tenants WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!before) throw new HttpError(404, 'not_found', 'No academy with that id.');
      const change = await db.maybeOne<{ id: string; domain: string }>(
        `UPDATE app.domain_changes SET status = 'overridden', resolved_by = $2, resolved_at = now()
          WHERE tenant_id = $1 AND status = 'pending' RETURNING id, requested_domain AS domain`,
        [req.params.id, owner.id]);
      if (!change) throw new HttpError(404, 'no_pending_change', 'This academy has not asked for a domain change.');
      if (change.domain === opts.consoleHost) throw new HttpError(400, 'invalid_domain', 'That is the console\'s own host.');
      const clash = await db.maybeOne('SELECT 1 FROM app.tenants WHERE primary_domain = $1', [change.domain]);
      if (clash) throw new HttpError(409, 'domain_taken', 'Another academy already uses that domain.');
      const after = await db.one<TenantRow>(
        `UPDATE app.tenants SET primary_domain = $2 WHERE id = $1 RETURNING ${TENANT_COLUMNS}`, [req.params.id, change.domain]);
      await db.audit({
        action: 'tenant.domain_overridden', entityType: 'domain_change', entityId: change.id,
        payload: { tenant_id: req.params.id, from: before.domain, to: change.domain, reason: req.body.reason },
      });
      return after;
    });
    forgetResolvedHosts();
    return { tenant: shape(tenant) };
  });
}

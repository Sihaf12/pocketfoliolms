/**
 * The academy's studio team, managed by its tenant admins.
 *
 * People join by invitation only: the link is shown once, in the
 * response to the admin who made it, and only its hash is kept. Every
 * invitation, revocation and change of roles is in the academy's audit
 * log. An academy can never be left without a tenant admin.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  hashToken, revokeAllStudioSessions, STUDIO_ROLES, type StudioRole,
} from '../../../auth/studioSession.js';
import { HttpError, fieldError } from '../../errors.js';
import { publicOrigin } from '../../sameOrigin.js';
import { inStudio, requireStudio } from '../../studioScope.js';
import { studioUserSchema } from './account.js';
import { uuid } from '../../schemas.js';

const roles = { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: STUDIO_ROLES } } as const;
const ADMIN: StudioRole[] = ['tenant_admin'];

const invitationSchema = {
  type: 'object',
  required: ['id', 'email', 'roles', 'createdAt', 'expiresAt', 'state'],
  properties: {
    id: { type: 'string' }, email: { type: 'string' }, roles: { type: 'array', items: { type: 'string' } },
    createdAt: { type: 'string' }, expiresAt: { type: 'string' }, state: { type: 'string', enum: ['pending', 'expired'] },
  },
} as const;

export async function studioUserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users', {
    schema: {
      response: {
        200: {
          type: 'object', required: ['users', 'invitations'],
          properties: { users: { type: 'array', items: studioUserSchema }, invitations: { type: 'array', items: invitationSchema } },
        },
      },
    },
  }, async (req) =>
    inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      const users = await db.query(
        `SELECT id, email, display_name AS "displayName", studio_roles AS roles
           FROM app.users WHERE cardinality(studio_roles) > 0 ORDER BY display_name, email`);
      const invitations = await db.query<{ id: string; email: string; roles: string[]; createdAt: Date; expiresAt: Date; expired: boolean }>(
        `SELECT id, email, roles, created_at AS "createdAt", expires_at AS "expiresAt", expires_at <= now() AS expired
           FROM app.studio_invitations
          WHERE accepted_at IS NULL AND revoked_at IS NULL
          ORDER BY created_at DESC LIMIT 100`);
      return {
        users,
        invitations: invitations.map(({ expired, createdAt, expiresAt, ...i }) => ({
          ...i, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(), state: expired ? 'expired' : 'pending',
        })),
      };
    }));

  app.post<{ Body: { email: string; roles: StudioRole[] } }>('/users', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['email', 'roles'],
        properties: { email: { type: 'string', format: 'email', maxLength: 254 }, roles },
      },
      response: {
        201: {
          type: 'object', required: ['invitation', 'link'],
          properties: { invitation: invitationSchema, link: { type: 'string' } },
        },
      },
    },
  }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase();
    const token = randomBytes(32).toString('base64url');
    const invitation = await inStudio(req, async (db) => {
      const admin = await requireStudio(db, req, ADMIN);
      const holder = await db.maybeOne<{ roles: string[] }>(
        'SELECT studio_roles AS roles FROM app.users WHERE email = $1', [email]);
      if (holder && req.body.roles.every((r) => holder.roles.includes(r))) {
        throw fieldError(409, 'already_has_roles', 'roles', 'This person already holds those roles.');
      }
      const row = await db.one<{ id: string; createdAt: Date; expiresAt: Date }>(
        `INSERT INTO app.studio_invitations (tenant_id, email, roles, token_hash, invited_by, invited_by_kind)
         VALUES (app.current_tenant(), $1, $2::text[], $3, $4, 'studio')
         RETURNING id, created_at AS "createdAt", expires_at AS "expiresAt"`,
        [email, req.body.roles, hashToken(token), admin.id],
      );
      await db.audit({
        action: 'studio.invitation_created', entityType: 'invitation', entityId: row.id,
        payload: { email, roles: req.body.roles },
      });
      return {
        id: row.id, email, roles: req.body.roles, state: 'pending' as const,
        createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
      };
    });
    // The only time the token exists outside the browser that follows it.
    return reply.status(201).send({ invitation, link: `${publicOrigin(req)}/studio/invite/${token}` });
  });

  app.delete<{ Params: { id: string } }>('/users/invitations/:id', {
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } } },
  }, async (req, reply) => {
    await inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      const revoked = await db.maybeOne(
        `UPDATE app.studio_invitations SET revoked_at = now()
          WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
        [req.params.id],
      );
      if (!revoked) throw new HttpError(404, 'not_found', 'No open invitation with that id.');
      await db.audit({ action: 'studio.invitation_revoked', entityType: 'invitation', entityId: req.params.id });
    });
    return reply.status(204).send();
  });

  app.patch<{ Params: { id: string }; Body: { roles: StudioRole[] } }>('/users/:id', {
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } },
      body: {
        type: 'object', additionalProperties: false, required: ['roles'],
        properties: { roles: { ...roles, minItems: 0 } },
      },
      response: { 200: { type: 'object', required: ['user'], properties: { user: studioUserSchema } } },
    },
  }, async (req) =>
    inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      // Only people already in the studio: invitations are the way in.
      const target = await db.maybeOne<{ roles: StudioRole[] }>(
        'SELECT studio_roles AS roles FROM app.users WHERE id = $1 AND cardinality(studio_roles) > 0 FOR UPDATE',
        [req.params.id],
      );
      if (!target) throw new HttpError(404, 'not_found', 'No studio member with that id.');

      const next = [...req.body.roles].sort();
      if (target.roles.includes('tenant_admin') && !next.includes('tenant_admin')) {
        // Every admin row is locked before counting, so two admins removing
        // each other at once are serialised and the second sees one left.
        const admins = await db.query(
          `SELECT id FROM app.users WHERE 'tenant_admin' = ANY(studio_roles) ORDER BY id FOR UPDATE`);
        if (admins.length <= 1) {
          throw new HttpError(409, 'last_admin', 'This is the academy\'s last tenant admin. Make someone else an admin first.');
        }
      }
      const user = await db.one(
        `UPDATE app.users SET studio_roles = $2::text[] WHERE id = $1
         RETURNING id, email, display_name AS "displayName", studio_roles AS roles`,
        [req.params.id, next],
      );
      if (next.length === 0) await revokeAllStudioSessions(db, req.params.id);
      await db.audit({
        action: 'studio.roles_changed', entityType: 'user', entityId: req.params.id,
        payload: { from: target.roles, to: next },
      });
      return { user };
    }));
}

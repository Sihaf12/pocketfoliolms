/**
 * Platform staff, managed by the platform owner. Staff join by
 * invitation: single use, 72 hours, the link shown once, every
 * invitation in the platform audit log. The owner role is not invitable;
 * owners are provisioned from the command line, where TOTP is enrolled.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { hashToken } from '../../../auth/studioSession.js';
import { HttpError } from '../../errors.js';
import { inConsole, requireStaff } from '../../consoleScope.js';
import { publicOrigin } from '../../sameOrigin.js';
import { staffSchema } from './account.js';

const INVITABLE = ['platform_author', 'platform_reviewer', 'platform_compliance'] as const;

const invitationSchema = {
  type: 'object',
  required: ['id', 'email', 'role', 'createdAt', 'expiresAt'],
  properties: {
    id: { type: 'string' }, email: { type: 'string' }, role: { type: 'string' },
    createdAt: { type: 'string' }, expiresAt: { type: 'string' },
  },
} as const;

export async function consoleStaffRoutes(app: FastifyInstance): Promise<void> {
  app.get('/staff', {
    schema: {
      response: {
        200: {
          type: 'object', required: ['staff', 'invitations'],
          properties: { staff: { type: 'array', items: staffSchema }, invitations: { type: 'array', items: invitationSchema } },
        },
      },
    },
  }, async (req) =>
    inConsole(async (db) => {
      await requireStaff(db, req, ['platform_owner']);
      const staff = await db.query(
        `SELECT id, email, display_name AS "displayName", role FROM platform.staff
          WHERE disabled_at IS NULL ORDER BY role, display_name`);
      const invitations = await db.query<{ id: string; email: string; role: string; createdAt: Date; expiresAt: Date }>(
        `SELECT id, email, role, created_at AS "createdAt", expires_at AS "expiresAt" FROM platform.staff_invitations
          WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`);
      return {
        staff,
        invitations: invitations.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString() })),
      };
    }));

  app.post<{ Body: { email: string; role: (typeof INVITABLE)[number] } }>('/staff', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['email', 'role'],
        properties: { email: { type: 'string', format: 'email', maxLength: 254 }, role: { type: 'string', enum: INVITABLE } },
      },
      response: {
        201: { type: 'object', required: ['invitation', 'link'], properties: { invitation: invitationSchema, link: { type: 'string' } } },
      },
    },
  }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase();
    const token = randomBytes(32).toString('base64url');
    const invitation = await inConsole(async (db) => {
      const owner = await requireStaff(db, req, ['platform_owner']);
      const existing = await db.maybeOne('SELECT 1 FROM platform.staff WHERE email = $1', [email]);
      if (existing) throw new HttpError(409, 'already_staff', 'This email already belongs to a staff account.');
      const row = await db.one<{ id: string; createdAt: Date; expiresAt: Date }>(
        `INSERT INTO platform.staff_invitations (email, role, token_hash, invited_by) VALUES ($1, $2, $3, $4)
         RETURNING id, created_at AS "createdAt", expires_at AS "expiresAt"`,
        [email, req.body.role, hashToken(token), owner.id],
      );
      await db.audit({
        action: 'staff.invitation_created', entityType: 'staff_invitation', entityId: row.id,
        payload: { email, role: req.body.role },
      });
      return { id: row.id, email, role: req.body.role, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
    });
    return reply.status(201).send({ invitation, link: `${publicOrigin(req)}/invite/${token}` });
  });
}

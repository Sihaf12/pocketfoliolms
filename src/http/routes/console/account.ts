/**
 * Console sign-in and staff invitations.
 *
 * The platform owner always signs in with a TOTP code; other staff do
 * when they have enrolled one. A code is accepted once: the step it
 * matched is recorded, and a code at or before it is refused. Every
 * failure gets the same answer, so the console does not say whether
 * the email, the password or the code was wrong.
 */
import type { FastifyInstance } from 'fastify';
import { hashPassword, verifyPassword } from '../../../auth/password.js';
import { hashToken } from '../../../auth/studioSession.js';
import { CONSOLE_COOKIE, issueStaffSession, revokeStaffSession, type StaffRole } from '../../../auth/staffSession.js';
import { open } from '../../../auth/secretBox.js';
import { verifyTotp } from '../../../auth/totp.js';
import { HttpError } from '../../errors.js';
import { clearConsoleCookie, inConsole, requireStaff, setConsoleCookie } from '../../consoleScope.js';
import type { RouteLimit } from '../../server.js';

export const staffSchema = {
  type: 'object',
  required: ['id', 'email', 'displayName', 'role'],
  properties: { id: { type: 'string' }, email: { type: 'string' }, displayName: { type: 'string' }, role: { type: 'string' } },
} as const;

const refused = () => new HttpError(401, 'invalid_credentials', 'Email, password or code is incorrect.');

export async function consoleAccountRoutes(app: FastifyInstance, opts: { loginLimit: RouteLimit }): Promise<void> {
  const limit = { rateLimit: { max: opts.loginLimit.max, timeWindow: opts.loginLimit.windowMs } };

  app.post<{ Body: { email: string; password: string; code?: string } }>('/auth/login', {
    config: limit,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254 },
          password: { type: 'string', minLength: 1, maxLength: 200 },
          code: { type: 'string', pattern: '^[0-9]{6}$' },
        },
      },
      response: { 200: { type: 'object', required: ['staff'], properties: { staff: staffSchema } } },
    },
  }, async (req, reply) => {
    const { staff, token } = await inConsole(async (db) => {
      const row = await db.maybeOne<{
        id: string; email: string; displayName: string; role: StaffRole;
        passwordHash: string; totpSecret: string | null; lastStep: string | null; disabled: boolean;
      }>(
        `SELECT id, email, display_name AS "displayName", role, password_hash AS "passwordHash",
                totp_secret AS "totpSecret", totp_last_step AS "lastStep", disabled_at IS NOT NULL AS disabled
           FROM platform.staff WHERE email = $1`,
        [req.body.email.trim().toLowerCase()],
      );
      const passwordOk = await verifyPassword(req.body.password, row?.passwordHash ?? null);
      if (!row || !passwordOk || row.disabled) throw refused();

      let mfa = false;
      if (row.totpSecret || row.role === 'platform_owner') {
        if (!row.totpSecret || !req.body.code) throw refused();
        const step = verifyTotp(open(row.totpSecret, app.totpKey), req.body.code, Date.now() / 1000,
          row.lastStep === null ? null : Number(row.lastStep));
        // Recorded only if still newer than the last, so a code raced in
        // two requests is accepted by one of them.
        const claimed = step === null ? null : await db.maybeOne(
          `UPDATE platform.staff SET totp_last_step = $2
            WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2) RETURNING id`,
          [row.id, step],
        );
        if (!claimed) throw refused();
        mfa = true;
      }

      const { passwordHash: _p, totpSecret: _t, lastStep: _l, disabled: _d, ...staff } = row;
      await db.query(`SELECT set_config('app.actor', $1, true)`, [`staff:${staff.id}`]);
      await db.audit({ action: 'staff.signed_in', entityType: 'staff', entityId: staff.id, payload: { mfa } });
      return { staff, token: await issueStaffSession(db, staff.id, mfa) };
    });
    setConsoleCookie(reply, token);
    return reply.send({ staff });
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[CONSOLE_COOKIE];
    if (token) await inConsole((db) => revokeStaffSession(db, token));
    clearConsoleCookie(reply);
    return reply.status(204).send();
  });

  app.get('/me', {
    schema: { response: { 200: { type: 'object', required: ['staff'], properties: { staff: staffSchema } } } },
  }, async (req) => inConsole(async (db) => ({ staff: await requireStaff(db, req) })));

  app.post<{ Body: { token: string; displayName: string; password: string } }>('/staff/invitations/accept', {
    config: limit,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['token', 'displayName', 'password'],
        properties: {
          token: { type: 'string', minLength: 20, maxLength: 200 },
          displayName: { type: 'string', minLength: 1, maxLength: 100 },
          password: { type: 'string', minLength: 12, maxLength: 200 },
        },
      },
      response: { 201: { type: 'object', required: ['staff'], properties: { staff: staffSchema } } },
    },
  }, async (req, reply) => {
    const passwordHash = await hashPassword(req.body.password);
    const { staff, token } = await inConsole(async (db) => {
      const invitation = await db.maybeOne<{ id: string; email: string; role: StaffRole }>(
        `UPDATE platform.staff_invitations SET accepted_at = now()
          WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
          RETURNING id, email, role`,
        [hashToken(req.body.token)],
      );
      if (!invitation) throw new HttpError(404, 'invitation_invalid', 'This invitation has expired or been used.');
      const taken = await db.maybeOne('SELECT 1 FROM platform.staff WHERE email = $1', [invitation.email]);
      if (taken) throw new HttpError(409, 'already_staff', 'This email already belongs to a staff account.');
      const staff = await db.one<{ id: string; email: string; displayName: string; role: StaffRole }>(
        `INSERT INTO platform.staff (email, display_name, role, password_hash) VALUES ($1, $2, $3, $4)
         RETURNING id, email, display_name AS "displayName", role`,
        [invitation.email, req.body.displayName, invitation.role, passwordHash],
      );
      await db.query(`SELECT set_config('app.actor', $1, true)`, [`staff:${staff.id}`]);
      await db.audit({
        action: 'staff.invitation_accepted', entityType: 'staff_invitation', entityId: invitation.id,
        payload: { staff_id: staff.id, role: staff.role },
      });
      return { staff, token: await issueStaffSession(db, staff.id, false) };
    });
    setConsoleCookie(reply, token);
    return reply.status(201).send({ staff });
  });
}

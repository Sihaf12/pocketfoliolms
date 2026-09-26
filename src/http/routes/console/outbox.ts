/**
 * CRM deliveries across every academy, for the platform owner: queue
 * health, dead letters with the academy they belong to, and replay.
 * Replays go in the platform audit log.
 */
import type { FastifyInstance } from 'fastify';
import { healthSchema, outboxHealth, replayDeadLetter } from '../../../outbox/health.js';
import { HttpError } from '../../errors.js';
import { inConsole, requireStaff } from '../../consoleScope.js';
import { uuid } from '../../schemas.js';

const OWNER = ['platform_owner'] as const;

export async function consoleOutboxRoutes(app: FastifyInstance): Promise<void> {
  app.get('/outbox', { schema: { response: { 200: healthSchema } } }, async (req) =>
    inConsole(async (db) => {
      await requireStaff(db, req, OWNER);
      return outboxHealth(db, '(SELECT t.name FROM app.tenants t WHERE t.id = e.tenant_id)');
    }));

  app.post<{ Params: { id: string } }>('/outbox/:id/replay', {
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } } },
  }, async (req, reply) => {
    await inConsole(async (db) => {
      await requireStaff(db, req, OWNER);
      const result = await replayDeadLetter(db, req.params.id);
      if (!result.ok) {
        throw result.reason === 'not_found'
          ? new HttpError(404, 'not_found', 'No event with that id.')
          : new HttpError(409, 'not_dead', 'Only an event that ran out of attempts can be replayed; this one is still in the queue.');
      }
      await db.audit({
        action: 'outbox.replayed', entityType: 'outbox_event', entityId: result.id,
        payload: { tenantId: result.tenantId, eventType: result.eventType, lastError: result.lastError },
      });
    });
    return reply.status(202).send();
  });
}

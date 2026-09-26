/**
 * The academy's CRM deliveries, for its tenant admins: how the queue is
 * doing, and a replay for events that ran out of attempts. Tenant RLS
 * keeps another academy's events out of view; one asked for by id is 404.
 */
import type { FastifyInstance } from 'fastify';
import type { StudioRole } from '../../../auth/studioSession.js';
import { healthSchema, outboxHealth, replayDeadLetter } from '../../../outbox/health.js';
import { HttpError } from '../../errors.js';
import { inStudio, requireStudio } from '../../studioScope.js';
import { uuid } from '../../schemas.js';

const ADMIN: StudioRole[] = ['tenant_admin'];

export async function studioOutboxRoutes(app: FastifyInstance): Promise<void> {
  app.get('/outbox', { schema: { response: { 200: healthSchema } } }, async (req) =>
    inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      return outboxHealth(db, `(SELECT name FROM app.current_tenant_settings())`);
    }));

  app.post<{ Params: { id: string } }>('/outbox/:id/replay', {
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } } },
  }, async (req, reply) => {
    await inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      const result = await replayDeadLetter(db, req.params.id);
      if (!result.ok) {
        throw result.reason === 'not_found'
          ? new HttpError(404, 'not_found', 'No event with that id.')
          : new HttpError(409, 'not_dead', 'Only an event that ran out of attempts can be replayed; this one is still in the queue.');
      }
      await db.audit({
        action: 'outbox.replayed', entityType: 'outbox_event', entityId: result.id,
        payload: { eventType: result.eventType, lastError: result.lastError },
      });
    });
    return reply.status(202).send();
  });
}

/**
 * What the academy's learners are offered, for its tenant admins.
 *
 * Every published course the academy may offer is listed: its own, and
 * the platform courses the platform allows it (011). The admin switches each on or off and orders them.
 * Platform courses stay read-only here; this changes only whether this
 * academy shows one, never the course. A draft or retired course cannot
 * be switched on, so a learner never meets unreviewed content.
 */
import type { FastifyInstance } from 'fastify';
import type { StudioRole } from '../../../auth/studioSession.js';
import { HttpError } from '../../errors.js';
import { inStudio, requireStudio } from '../../studioScope.js';
import { uuid } from '../../schemas.js';

const ADMIN: StudioRole[] = ['tenant_admin'];

const entrySchema = {
  type: 'object',
  required: ['courseId', 'title', 'tier', 'source', 'enabled', 'position', 'lessons'],
  properties: {
    courseId: { type: 'string' }, title: { type: 'string' }, tier: { type: 'string' },
    source: { type: 'string', enum: ['platform', 'academy'] },
    enabled: { type: 'boolean' }, position: { type: 'integer' }, lessons: { type: 'integer' },
  },
} as const;

// A course the academy has never touched is off, and sorts after the rest.
const CATALOGUE_SQL = `
  SELECT c.id AS "courseId", c.title, c.tier,
         CASE WHEN c.owner_tenant_id IS NULL THEN 'platform' ELSE 'academy' END AS source,
         COALESCE(tc.enabled, false) AS enabled, COALESCE(tc.position, 0) AS position,
         (SELECT count(*)::int FROM platform.lessons l WHERE l.course_id = c.id) AS lessons
    FROM platform.courses c
    LEFT JOIN app.tenant_catalogues tc ON tc.course_id = c.id
   WHERE c.review_state = 'published'
     -- Platform courses only as far as the platform allows this academy (011).
     AND (c.owner_tenant_id IS NOT NULL OR EXISTS (SELECT 1 FROM app.tenant_entitlements e WHERE e.course_id = c.id))`;

export async function studioCatalogueRoutes(app: FastifyInstance): Promise<void> {
  app.get('/catalogue', {
    schema: { response: { 200: { type: 'object', required: ['courses'], properties: { courses: { type: 'array', items: entrySchema } } } } },
  }, async (req) =>
    inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      return { courses: await db.query(`${CATALOGUE_SQL} ORDER BY tc.course_id IS NULL, tc.position, c.tier, c.title`) };
    }));

  app.put<{ Params: { courseId: string }; Body: { enabled: boolean; position: number } }>('/catalogue/:courseId', {
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['courseId'], properties: { courseId: uuid } },
      body: {
        type: 'object', additionalProperties: false, required: ['enabled', 'position'],
        properties: { enabled: { type: 'boolean' }, position: { type: 'integer', minimum: 0, maximum: 10_000 } },
      },
      response: { 200: { type: 'object', required: ['course'], properties: { course: entrySchema } } },
    },
  }, async (req) =>
    inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      // RLS already hides other academies' private courses: they are 404 like any unknown id.
      const course = await db.maybeOne<{ state: string; allowed: boolean }>(
        `SELECT review_state AS state,
                owner_tenant_id IS NOT NULL OR EXISTS (SELECT 1 FROM app.tenant_entitlements e WHERE e.course_id = c.id) AS allowed
           FROM platform.courses c WHERE id = $1`, [req.params.courseId]);
      if (!course) throw new HttpError(404, 'not_found', 'No course with that id.');

      if (course.state !== 'published') {
        throw new HttpError(409, 'not_published', 'Only a published course can be offered to learners.');
      }
      if (!course.allowed && req.body.enabled) {
        throw new HttpError(403, 'not_allowed', 'Your academy is not allowed this course. The platform decides which of its courses each academy may offer.');
      }
      const before = await db.maybeOne<{ enabled: boolean; position: number }>(
        'SELECT enabled, position FROM app.tenant_catalogues WHERE course_id = $1 FOR UPDATE', [req.params.courseId]);
      await db.query(
        `INSERT INTO app.tenant_catalogues (tenant_id, course_id, enabled, position)
         VALUES (app.current_tenant(), $1, $2, $3)
         ON CONFLICT (tenant_id, course_id) DO UPDATE
           SET enabled = EXCLUDED.enabled, position = EXCLUDED.position,
               enabled_at = CASE WHEN EXCLUDED.enabled AND NOT app.tenant_catalogues.enabled THEN now()
                                 ELSE app.tenant_catalogues.enabled_at END`,
        [req.params.courseId, req.body.enabled, req.body.position],
      );
      await db.audit({
        action: 'catalogue.changed', entityType: 'course', entityId: req.params.courseId,
        payload: { from: before, to: req.body },
      });
      return { course: await db.one(`${CATALOGUE_SQL} AND c.id = $1`, [req.params.courseId]) };
    }));
}

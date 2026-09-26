/**
 * What anyone may read about an academy before signing up: its name and
 * brand (already public on every page it serves), and the courses it
 * offers, with what opens each tier. Nothing about any learner.
 */
import type { FastifyInstance } from 'fastify';
import { tierRequirement, type Tier } from '../../domain/placement.js';
import { sanitiseBrand } from '../brand.js';
import { inAcademy } from '../context.js';

const TIER_ORDER = `array_position(ARRAY['learn','safeguard','apply','specialise'], c.tier::text)`;

export async function academyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/academy', {
    schema: {
      response: {
        200: {
          type: 'object', required: ['name', 'sub', 'tokens'],
          properties: { name: { type: 'string' }, sub: { type: 'string' }, tokens: { type: 'object', additionalProperties: { type: 'string' } } },
        },
      },
    },
  }, async (req) =>
    inAcademy(req, async (db) => {
      const academy = await db.one<{ name: string; brand: unknown }>('SELECT name, brand FROM app.current_tenant_brand()');
      const { sub, tokens } = sanitiseBrand(academy.brand);
      return { name: academy.name, sub, tokens };
    }));

  app.get('/catalogue', {
    schema: {
      response: {
        200: {
          type: 'object', required: ['courses'],
          properties: {
            courses: {
              type: 'array',
              items: {
                type: 'object', required: ['id', 'title', 'tier', 'summary', 'lessons', 'minutes', 'requirement', 'lessonTitles'],
                properties: {
                  id: { type: 'string' }, title: { type: 'string' }, tier: { type: 'string' }, summary: { type: 'string' },
                  lessons: { type: 'integer' }, minutes: { type: 'integer' }, requirement: { type: ['string', 'null'] },
                  // In order: what the landing page draws its example path from.
                  lessonTitles: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  }, async (req) =>
    inAcademy(req, async (db) => {
      const courses = await db.query<{ id: string; title: string; tier: Tier; summary: string; lessons: number; minutes: number; lessonTitles: string[] }>(
        `SELECT c.id, c.title, c.tier, c.summary,
                ARRAY(SELECT l.title FROM platform.lessons l WHERE l.course_id = c.id ORDER BY l.position) AS "lessonTitles",
                (SELECT count(*)::int FROM platform.lessons l WHERE l.course_id = c.id) AS lessons,
                COALESCE((SELECT round(sum(l.duration_secs) / 60.0)::int FROM platform.lessons l WHERE l.course_id = c.id), c.est_minutes) AS minutes
           FROM app.tenant_catalogues tc
           JOIN platform.courses c ON c.id = tc.course_id AND c.review_state = 'published'
          WHERE tc.enabled
          ORDER BY ${TIER_ORDER}, tc.position, c.title`);
      return { courses: courses.map((c) => ({ ...c, requirement: tierRequirement(c.tier) })) };
    }));
}

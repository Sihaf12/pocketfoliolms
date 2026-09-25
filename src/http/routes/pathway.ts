/**
 * The learner's pathway: their baseline and level, and for each tier
 * whether it is open and which catalogue courses sit in it.
 *
 * Courses come from this academy's catalogue (enabled rows only) joined
 * to platform.courses, whose RLS hides any other academy's private course
 * even if a catalogue row were to name it.
 */
import type { FastifyInstance } from 'fastify';
import { TIERS, levelFrom, type Tier } from '../../domain/placement.js';
import { inAcademy, requireLearner, requirePlacement } from '../context.js';
import { tierScoresSchema } from './onboarding.js';
import { tierStatuses } from './placement.js';

interface CourseRow {
  id: string;
  slug: string;
  title: string;
  tier: Tier;
  estMinutes: number;
  state: string;
  progressPct: number;
}

interface LessonRow {
  id: string;
  courseId: string;
  position: number;
  title: string;
}

const lessonSchema = {
  type: 'object',
  required: ['id', 'position', 'title'],
  properties: { id: { type: 'string' }, position: { type: 'integer' }, title: { type: 'string' } },
} as const;

const courseSchema = {
  type: 'object',
  required: ['id', 'slug', 'title', 'estMinutes', 'state', 'progressPct', 'lessons'],
  properties: {
    id: { type: 'string' },
    slug: { type: 'string' },
    title: { type: 'string' },
    estMinutes: { type: 'integer' },
    state: { type: 'string' },
    progressPct: { type: 'integer' },
    lessons: { type: 'array', items: lessonSchema },
  },
} as const;

const pathwaySchema = {
  type: 'object',
  required: ['level', 'baseline', 'tiers'],
  properties: {
    level: { type: 'string' },
    baseline: tierScoresSchema,
    tiers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['tier', 'unlocked', 'gateReason', 'courses'],
        properties: {
          tier: { type: 'string' },
          unlocked: { type: 'boolean' },
          gateReason: { type: ['string', 'null'] },
          courses: { type: 'array', items: courseSchema },
        },
      },
    },
  },
} as const;

export async function pathwayRoutes(app: FastifyInstance): Promise<void> {
  app.get('/pathway', { schema: { response: { 200: pathwaySchema } } }, async (req) =>
    inAcademy(req, async (db) => {
      const learner = await requireLearner(db, req);
      const baseline = await requirePlacement(db, learner);

      const courses = await db.query<CourseRow>(
        `SELECT c.id, c.slug, c.title, c.tier, c.est_minutes AS "estMinutes",
                COALESCE(e.state, 'not_started') AS state,
                COALESCE(e.progress_pct, 0)::int AS "progressPct"
           FROM app.tenant_catalogues tc
           JOIN platform.courses c ON c.id = tc.course_id
           LEFT JOIN app.enrolments e ON e.course_id = c.id AND e.user_id = $1
          WHERE tc.enabled AND c.review_state = 'published'
          ORDER BY tc.position, c.title`,
        [learner.id],
      );
      const lessons = await db.query<LessonRow>(
        `SELECT id, course_id AS "courseId", position, title
           FROM platform.lessons
          WHERE course_id = ANY($1::uuid[])
          ORDER BY position`,
        [courses.map((c) => c.id)],
      );

      const statuses = tierStatuses(baseline);
      return {
        level: levelFrom(baseline),
        baseline,
        tiers: TIERS.map((tier, i) => ({
          ...statuses[i]!,
          courses: courses
            .filter((c) => c.tier === tier)
            .map((c) => ({ ...c, lessons: lessons.filter((l) => l.courseId === c.id) })),
        })),
      };
    }));
}

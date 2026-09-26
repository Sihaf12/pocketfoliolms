/**
 * The learner's pathway: their baseline and level, and for each tier
 * whether it is open and which catalogue courses sit in it, down to each
 * lesson's state and the reason it is locked.
 *
 * Every state comes from domain/pathway.ts, the same rule the lesson
 * routes enforce, so the client draws what the server decided.
 *
 * Courses come from this academy's catalogue (enabled rows only) joined
 * to platform.courses, whose RLS hides any other academy's private course
 * even if a catalogue row were to name it.
 */
import type { FastifyInstance } from 'fastify';
import { TIERS, levelFrom, tierOutlook, type Tier } from '../../domain/placement.js';
import { availability, type LessonState } from '../../domain/pathway.js';
import { inAcademy, requireLearner, requirePlacement } from '../context.js';
import { passedLessons, prerequisitesOf, unmetPrerequisites } from '../learning.js';
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
  minutes: number;
  xp: number;
}

interface PathwayLesson {
  id: string;
  position: number;
  title: string;
  minutes: number;
  xp: number;
  state: LessonState;
  gateReason: string | null;
  requires: string[];
}

const lessonSchema = {
  type: 'object',
  required: ['id', 'position', 'title', 'minutes', 'xp', 'state', 'gateReason', 'requires'],
  properties: {
    id: { type: 'string' },
    position: { type: 'integer' },
    title: { type: 'string' },
    minutes: { type: 'integer' },
    xp: { type: 'integer' },
    state: { type: 'string', enum: ['done', 'open', 'locked'] },
    gateReason: { type: ['string', 'null'] },
    requires: { type: 'array', items: { type: 'string' } },
  },
} as const;

const certificateSchema = {
  type: ['object', 'null'],
  required: ['serial', 'issuedAt'],
  properties: { serial: { type: 'string' }, issuedAt: { type: 'string' } },
} as const;

const courseSchema = {
  type: 'object',
  required: ['id', 'slug', 'title', 'estMinutes', 'state', 'progressPct', 'certificate', 'lessons'],
  properties: {
    id: { type: 'string' },
    slug: { type: 'string' },
    title: { type: 'string' },
    estMinutes: { type: 'integer' },
    state: { type: 'string' },
    progressPct: { type: 'integer' },
    certificate: certificateSchema,
    lessons: { type: 'array', items: lessonSchema },
  },
} as const;

const pathwaySchema = {
  type: 'object',
  required: ['level', 'baseline', 'nextLessonId', 'tiers'],
  properties: {
    level: { type: 'string' },
    baseline: tierScoresSchema,
    nextLessonId: { type: ['string', 'null'] },
    tiers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['tier', 'unlocked', 'gateReason', 'outlook', 'courses'],
        properties: {
          tier: { type: 'string' },
          unlocked: { type: 'boolean' },
          gateReason: { type: ['string', 'null'] },
          outlook: { type: 'string' },
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
        `SELECT id, course_id AS "courseId", position, title,
                GREATEST(1, round(duration_secs / 60.0))::int AS minutes, xp
           FROM platform.lessons
          WHERE course_id = ANY($1::uuid[])
          ORDER BY position`,
        [courses.map((c) => c.id)],
      );
      const lessonIds = lessons.map((l) => l.id);
      const passed = await passedLessons(db, learner.id);
      const unmet = await unmetPrerequisites(db, learner.id, lessonIds);
      const requires = await prerequisitesOf(db, lessonIds);
      const certificates = await db.query<{ courseId: string; serial: string; issuedAt: Date }>(
        `SELECT course_id AS "courseId", serial, issued_at AS "issuedAt"
           FROM app.certificates WHERE user_id = $1 AND revoked_at IS NULL`,
        [learner.id],
      );

      const tierOf = new Map(courses.map((c) => [c.id, c.tier]));
      const shaped = new Map<string, PathwayLesson[]>();
      for (const l of lessons) {
        const { state, gateReason } = availability(tierOf.get(l.courseId)!, baseline, passed.has(l.id), unmet.get(l.id) ?? []);
        const lesson: PathwayLesson = {
          id: l.id, position: l.position, title: l.title, minutes: l.minutes, xp: l.xp,
          state, gateReason, requires: requires.get(l.id) ?? [],
        };
        shaped.set(l.courseId, [...(shaped.get(l.courseId) ?? []), lesson]);
      }

      const statuses = tierStatuses(baseline);
      const tiers = TIERS.map((tier, i) => ({
        ...statuses[i]!,
        outlook: tierOutlook(tier, baseline),
        courses: courses
          .filter((c) => c.tier === tier)
          .map((c) => {
            const cert = certificates.find((x) => x.courseId === c.id);
            return {
              ...c,
              certificate: cert ? { serial: cert.serial, issuedAt: cert.issuedAt.toISOString() } : null,
              lessons: shaped.get(c.id) ?? [],
            };
          }),
      }));

      // The first open lesson in pathway order: tier, catalogue position, lesson position.
      const next = tiers.flatMap((t) => t.courses.flatMap((c) => c.lessons)).find((l) => l.state === 'open');
      return { level: levelFrom(baseline), baseline, nextLessonId: next?.id ?? null, tiers };
    }));
}

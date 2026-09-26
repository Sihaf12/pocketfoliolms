/**
 * The learner's own record, read-only: who they are, where they placed,
 * what they have verified, what it is worth, and the events their
 * learning has put in the outbox.
 *
 * Every number here is computed by the database from recorded attempts.
 * A verified lesson is one with a passed knowledge check; its XP counts
 * once, however often it is passed.
 */
import type { FastifyInstance } from 'fastify';
import type { Level, Tier, TierScores } from '../../domain/placement.js';
import { TIERS } from '../../domain/placement.js';
import { inAcademy, requireLearner } from '../context.js';
import { tierScoresSchema } from './onboarding.js';

const NOT_YET_PLACED = new Set(['registered', 'onboarded']);

const str = { type: 'string' } as const;
const int = { type: 'integer' } as const;
const nullableStr = { type: ['string', 'null'] } as const;

const meSchema = {
  type: 'object',
  required: ['user', 'academy', 'placement', 'stats', 'tiers', 'recent', 'certificates', 'week'],
  properties: {
    user: {
      type: 'object',
      required: ['id', 'email', 'displayName', 'lifecycle', 'ibRefCode', 'goal', 'dailyMinutes'],
      properties: {
        id: str, email: str, displayName: str, lifecycle: str, ibRefCode: nullableStr, goal: nullableStr,
        dailyMinutes: { type: ['integer', 'null'] },
      },
    },
    academy: { type: 'object', required: ['name'], properties: { name: str } },
    placement: {
      type: ['object', 'null'],
      required: ['level', 'baseline'],
      properties: { level: str, baseline: tierScoresSchema },
    },
    stats: {
      type: 'object',
      required: ['xp', 'streakDays', 'verifiedLessons', 'totalLessons'],
      properties: { xp: int, streakDays: int, verifiedLessons: int, totalLessons: int },
    },
    tiers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['tier', 'verifiedLessons', 'totalLessons'],
        properties: { tier: str, verifiedLessons: int, totalLessons: int },
      },
    },
    recent: {
      type: 'array',
      items: {
        type: 'object',
        required: ['lessonId', 'title', 'tier', 'xp', 'verifiedAt'],
        properties: { lessonId: str, title: str, tier: str, xp: int, verifiedAt: str },
      },
    },
    certificates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['serial', 'courseTitle', 'issuedAt'],
        properties: { serial: str, courseTitle: str, issuedAt: str },
      },
    },
    // Monday to Sunday of this UTC week: whether any knowledge check was passed that day.
    week: {
      type: 'array',
      items: { type: 'object', required: ['date', 'learned'], properties: { date: str, learned: { type: 'boolean' } } },
    },
  },
} as const;

const eventsSchema = {
  type: 'object',
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'idempotencyKey', 'status', 'createdAt', 'deliveredAt', 'payload'],
        properties: {
          type: str, idempotencyKey: str, status: str, createdAt: str,
          deliveredAt: nullableStr, payload: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
} as const;

export const EVENTS_SHOWN = 50;

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', { schema: { response: { 200: meSchema } } }, async (req) =>
    inAcademy(req, async (db) => {
      const learner = await requireLearner(db, req);

      const profile = await db.one<{ goal: string | null; dailyMinutes: number | null }>(
        'SELECT goal, daily_minutes AS "dailyMinutes" FROM app.users WHERE id = $1',
        [learner.id],
      );
      const academy = await db.one<{ name: string }>('SELECT name FROM app.current_tenant_brand()');

      const placement = NOT_YET_PLACED.has(learner.lifecycle)
        ? null
        : await db.one<{ level: Level; baseline: TierScores }>(
          'SELECT level, baseline FROM app.learning_paths WHERE user_id = $1',
          [learner.id],
        );

      // Each lesson counts once, from the moment it was first passed.
      const verified = await db.query<{ lessonId: string; title: string; tier: Tier; xp: number; verifiedAt: Date }>(
        `SELECT l.id AS "lessonId", l.title, c.tier, l.xp, f.first_pass AS "verifiedAt"
           FROM (SELECT lesson_id, min(submitted_at) AS first_pass
                   FROM app.quiz_attempts
                  WHERE user_id = $1 AND kind = 'knowledge_check' AND passed AND lesson_id IS NOT NULL
                  GROUP BY lesson_id) f
           JOIN platform.lessons l ON l.id = f.lesson_id
           JOIN platform.courses c ON c.id = l.course_id
          ORDER BY f.first_pass DESC`,
        [learner.id],
      );

      const catalogue = await db.query<{ id: string; tier: Tier }>(
        `SELECT l.id, c.tier
           FROM app.tenant_catalogues tc
           JOIN platform.courses c ON c.id = tc.course_id
           JOIN platform.lessons l ON l.course_id = c.id
          WHERE tc.enabled AND c.review_state = 'published'`,
      );

      // Consecutive UTC days on which a lesson was first verified, ending
      // today or yesterday. A day with only repeat passes does not count.
      const streak = await db.one<{ days: number }>(
        `WITH days AS (
           SELECT DISTINCT (min(submitted_at) AT TIME ZONE 'UTC')::date AS d
             FROM app.quiz_attempts
            WHERE user_id = $1 AND kind = 'knowledge_check' AND passed AND lesson_id IS NOT NULL
            GROUP BY lesson_id
         ), runs AS (
           SELECT max(d) AS last_day, count(*)::int AS len
             FROM (SELECT d, d - (row_number() OVER (ORDER BY d))::int AS grp FROM days) r
            GROUP BY grp
         )
         SELECT COALESCE((SELECT len FROM runs
                           WHERE last_day >= (now() AT TIME ZONE 'UTC')::date - 1
                           ORDER BY last_day DESC LIMIT 1), 0) AS days`,
        [learner.id],
      );

      const certificates = await db.query<{ serial: string; courseTitle: string; issuedAt: Date }>(
        `SELECT serial, course_title AS "courseTitle", issued_at AS "issuedAt"
           FROM app.certificates WHERE user_id = $1 AND revoked_at IS NULL ORDER BY issued_at`,
        [learner.id],
      );

      const week = await db.query<{ date: string; learned: boolean }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS date,
                EXISTS (SELECT 1 FROM app.quiz_attempts a
                         WHERE a.user_id = $1 AND a.kind = 'knowledge_check' AND a.passed
                           AND (a.submitted_at AT TIME ZONE 'UTC')::date = d) AS learned
           FROM generate_series(date_trunc('week', now() AT TIME ZONE 'UTC')::date,
                                date_trunc('week', now() AT TIME ZONE 'UTC')::date + 6, interval '1 day') AS g(d)
          ORDER BY d`,
        [learner.id],
      );

      const verifiedIds = new Set(verified.map((v) => v.lessonId));
      return {
        user: { ...learner, ...profile },
        academy,
        placement,
        stats: {
          xp: verified.reduce((sum, v) => sum + v.xp, 0),
          streakDays: streak.days,
          verifiedLessons: verified.length,
          totalLessons: catalogue.length,
        },
        tiers: TIERS.map((tier) => {
          const inTier = catalogue.filter((l) => l.tier === tier);
          return { tier, verifiedLessons: inTier.filter((l) => verifiedIds.has(l.id)).length, totalLessons: inTier.length };
        }),
        recent: verified.slice(0, 10).map((v) => ({ ...v, verifiedAt: v.verifiedAt.toISOString() })),
        certificates: certificates.map((c) => ({ ...c, issuedAt: c.issuedAt.toISOString() })),
        week,
      };
    }));

  app.get('/me/events', { schema: { response: { 200: eventsSchema } } }, async (req) =>
    inAcademy(req, async (db) => {
      const learner = await requireLearner(db, req);
      // Every event the request path emits is partitioned by learner id.
      const events = await db.query<{
        type: string; idempotencyKey: string; status: string; createdAt: Date; deliveredAt: Date | null;
        payload: Record<string, unknown>;
      }>(
        `SELECT event_type AS type, idempotency_key AS "idempotencyKey", status,
                created_at AS "createdAt", delivered_at AS "deliveredAt", payload
           FROM app.outbox_events
          WHERE partition_key = $1
          ORDER BY created_at DESC, id
          LIMIT ${EVENTS_SHOWN}`,
        [learner.id],
      );
      return {
        events: events.map((e) => ({
          ...e, createdAt: e.createdAt.toISOString(), deliveredAt: e.deliveredAt?.toISOString() ?? null,
        })),
      };
    }));
}

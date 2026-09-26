/**
 * The academy's learners, for its tenant admins: search, one learner's
 * placement, progress and certificates, and their attempts.
 *
 * Tenant RLS decides whose learners these are; nothing here filters by
 * academy. Opening a learner's record is audited, because it is personal
 * data being looked at, not just listed.
 *
 * A learner is anyone with a placement or an enrolment, studio members
 * included, so the team's own test accounts show up in reports the way
 * a real learner's would. An account that has never started learning
 * is not a learner yet.
 */
import type { FastifyInstance } from 'fastify';
import type { StudioRole } from '../../../auth/studioSession.js';
import { HttpError } from '../../errors.js';
import { inStudio, requireStudio } from '../../studioScope.js';
import { uuid } from '../../schemas.js';

const ADMIN: StudioRole[] = ['tenant_admin'];
export const LEARNER_PAGE = 25;
const ATTEMPTS_SHOWN = 100;

const summarySchema = {
  type: 'object',
  required: ['id', 'email', 'displayName', 'lifecycle', 'level', 'joinedAt', 'lastSeenAt'],
  properties: {
    id: { type: 'string' }, email: { type: 'string' }, displayName: { type: 'string' },
    lifecycle: { type: 'string' }, level: { type: ['string', 'null'] },
    joinedAt: { type: 'string' }, lastSeenAt: { type: ['string', 'null'] },
  },
} as const;

interface SummaryRow {
  id: string; email: string; displayName: string; lifecycle: string; level: string | null;
  joinedAt: Date; lastSeenAt: Date | null;
}
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const shapeSummary = (r: SummaryRow) => ({ ...r, joinedAt: r.joinedAt.toISOString(), lastSeenAt: iso(r.lastSeenAt) });

/** The cursor is the last row's (joined, id), opaque to the client. */
function readCursor(raw: string | undefined): { at: string; id: string } | null {
  if (!raw) return null;
  const [at, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/.test(id)) {
    throw new HttpError(400, 'invalid_cursor', 'That page cursor is not one this server gave out.');
  }
  return { at, id };
}
const writeCursor = (r: SummaryRow) => Buffer.from(`${r.joinedAt.toISOString()}|${r.id}`).toString('base64url');

/** Matches the text literally: % and _ in a search are characters, not wildcards. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Needs `u` for app.users and `lp` for its learning path, left-joined. */
const IS_LEARNER = `(lp.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM app.enrolments e WHERE e.user_id = u.id))`;

const SUMMARY_COLUMNS = `u.id, u.email, u.display_name AS "displayName", u.lifecycle, lp.level,
                         u.created_at AS "joinedAt", u.last_seen_at AS "lastSeenAt"`;

export async function studioLearnerRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string; cursor?: string } }>('/learners', {
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { q: { type: 'string', maxLength: 100 }, cursor: { type: 'string', maxLength: 200 } },
      },
      response: {
        200: {
          type: 'object', required: ['learners', 'next'],
          properties: { learners: { type: 'array', items: summarySchema }, next: { type: ['string', 'null'] } },
        },
      },
    },
  }, async (req) => {
    const cursor = readCursor(req.query.cursor);
    const q = req.query.q?.trim() ?? '';
    return inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      const rows = await db.query<SummaryRow>(
        `SELECT ${SUMMARY_COLUMNS}
           FROM app.users u
           LEFT JOIN app.learning_paths lp ON lp.user_id = u.id
          WHERE ${IS_LEARNER}
            AND ($1 = '' OR u.email ILIKE $2 OR u.display_name ILIKE $2)
            AND ($3::timestamptz IS NULL OR (u.created_at, u.id) < ($3::timestamptz, $4::uuid))
          ORDER BY u.created_at DESC, u.id DESC
          LIMIT $5`,
        [q, likePattern(q), cursor?.at ?? null, cursor?.id ?? null, LEARNER_PAGE + 1],
      );
      const page = rows.slice(0, LEARNER_PAGE);
      return { learners: page.map(shapeSummary), next: rows.length > LEARNER_PAGE ? writeCursor(page[page.length - 1]!) : null };
    });
  });

  app.get<{ Params: { id: string } }>('/learners/:id', {
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } },
      response: {
        200: {
          type: 'object', required: ['learner', 'placement', 'courses', 'certificates', 'lessonsVerified'],
          properties: {
            learner: summarySchema,
            placement: {
              type: ['object', 'null'], required: ['level', 'baseline', 'selfRating', 'placedAt'],
              properties: {
                level: { type: 'string' }, placedAt: { type: 'string' },
                baseline: { type: 'object', additionalProperties: { type: 'number' } },
                selfRating: { type: 'object', additionalProperties: { type: 'number' } },
              },
            },
            courses: {
              type: 'array',
              items: {
                type: 'object', required: ['courseId', 'title', 'state', 'progressPct', 'startedAt', 'completedAt'],
                properties: {
                  courseId: { type: 'string' }, title: { type: 'string' }, state: { type: 'string' },
                  progressPct: { type: 'integer' }, startedAt: { type: 'string' }, completedAt: { type: ['string', 'null'] },
                },
              },
            },
            certificates: {
              type: 'array',
              items: {
                type: 'object', required: ['serial', 'courseTitle', 'issuedAt', 'revoked'],
                properties: { serial: { type: 'string' }, courseTitle: { type: 'string' }, issuedAt: { type: 'string' }, revoked: { type: 'boolean' } },
              },
            },
            lessonsVerified: { type: 'integer' },
          },
        },
      },
    },
  }, async (req) =>
    inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      const learner = await db.maybeOne<SummaryRow>(
        `SELECT ${SUMMARY_COLUMNS} FROM app.users u LEFT JOIN app.learning_paths lp ON lp.user_id = u.id
          WHERE u.id = $1 AND ${IS_LEARNER}`, [req.params.id]);
      if (!learner) throw new HttpError(404, 'not_found', 'No learner with that id.');

      const placement = await db.maybeOne<{ level: string; baseline: Record<string, number>; selfRating: Record<string, number>; placedAt: Date }>(
        `SELECT level, baseline, self_rating AS "selfRating", computed_at AS "placedAt"
           FROM app.learning_paths WHERE user_id = $1`, [learner.id]);
      const courses = await db.query<{ courseId: string; title: string; state: string; progressPct: number; startedAt: Date; completedAt: Date | null }>(
        `SELECT e.course_id AS "courseId", c.title, e.state, e.progress_pct AS "progressPct",
                e.started_at AS "startedAt", e.completed_at AS "completedAt"
           FROM app.enrolments e JOIN platform.courses c ON c.id = e.course_id
          WHERE e.user_id = $1 ORDER BY e.started_at DESC`, [learner.id]);
      const certificates = await db.query<{ serial: string; courseTitle: string; issuedAt: Date; revoked: boolean }>(
        `SELECT serial, course_title AS "courseTitle", issued_at AS "issuedAt", revoked_at IS NOT NULL AS revoked
           FROM app.certificates WHERE user_id = $1 ORDER BY issued_at DESC`, [learner.id]);
      const verified = await db.one<{ n: number }>(
        `SELECT count(DISTINCT lesson_id)::int AS n FROM app.quiz_attempts
          WHERE user_id = $1 AND kind = 'knowledge_check' AND passed`, [learner.id]);

      await db.audit({ action: 'learner.viewed', entityType: 'user', entityId: learner.id });
      return {
        learner: shapeSummary(learner),
        placement: placement && { ...placement, placedAt: placement.placedAt.toISOString() },
        courses: courses.map((c) => ({ ...c, startedAt: c.startedAt.toISOString(), completedAt: iso(c.completedAt) })),
        certificates: certificates.map((c) => ({ ...c, issuedAt: c.issuedAt.toISOString() })),
        lessonsVerified: verified.n,
      };
    }));

  app.get<{ Params: { id: string } }>('/learners/:id/attempts', {
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } },
      response: {
        200: {
          type: 'object', required: ['attempts'],
          properties: {
            attempts: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'kind', 'courseTitle', 'lessonTitle', 'correct', 'total', 'passed', 'startedAt', 'submittedAt'],
                properties: {
                  id: { type: 'string' }, kind: { type: 'string' },
                  courseTitle: { type: ['string', 'null'] }, lessonTitle: { type: ['string', 'null'] },
                  correct: { type: ['integer', 'null'] }, total: { type: ['integer', 'null'] }, passed: { type: ['boolean', 'null'] },
                  startedAt: { type: 'string' }, submittedAt: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
      },
    },
  }, async (req) =>
    inStudio(req, async (db) => {
      await requireStudio(db, req, ADMIN);
      const exists = await db.maybeOne(
        `SELECT 1 FROM app.users u LEFT JOIN app.learning_paths lp ON lp.user_id = u.id WHERE u.id = $1 AND ${IS_LEARNER}`,
        [req.params.id]);
      if (!exists) throw new HttpError(404, 'not_found', 'No learner with that id.');
      const attempts = await db.query<{
        id: string; kind: string; courseTitle: string | null; lessonTitle: string | null;
        correct: number | null; total: number | null; passed: boolean | null; startedAt: Date; submittedAt: Date | null;
      }>(
        `SELECT a.id, a.kind, c.title AS "courseTitle", l.title AS "lessonTitle",
                a.correct_count AS correct, a.total_count AS total, a.passed,
                a.started_at AS "startedAt", a.submitted_at AS "submittedAt"
           FROM app.quiz_attempts a
           LEFT JOIN platform.courses c ON c.id = a.course_id
           LEFT JOIN platform.lessons l ON l.id = a.lesson_id
          WHERE a.user_id = $1
          ORDER BY a.started_at DESC LIMIT ${ATTEMPTS_SHOWN}`, [req.params.id]);
      return {
        attempts: attempts.map((a) => ({ ...a, startedAt: a.startedAt.toISOString(), submittedAt: iso(a.submittedAt) })),
      };
    }));
}

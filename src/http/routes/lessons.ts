/**
 * Lesson content and knowledge-check papers.
 *
 * A lesson is served only if RLS lets this academy see its course, the
 * course is published and enabled in this academy's catalogue, and the
 * learner's baseline has opened its tier. Anything unseen is a 404 that
 * looks the same as a lesson that never existed; a locked tier is a 403
 * carrying the published gate text.
 *
 * Opening a lesson, or drawing its check, enrols the learner in the
 * course the first time, copying the IB code held since signup.
 */
import type { FastifyInstance } from 'fastify';
import type { ScopedDb } from '../../db/unitOfWork.js';
import type { Learner } from '../../auth/session.js';
import { gateReason, tierUnlocked, type Tier, type TierScores } from '../../domain/placement.js';
import { drawCheck } from '../../domain/papers.js';
import { inAcademy, requireLearner, requirePlacement } from '../context.js';
import { HttpError } from '../errors.js';
import { inPaperOrder, paper, uuid, type PaperQuestion } from '../schemas.js';

interface LessonRow {
  id: string;
  courseId: string;
  position: number;
  title: string;
  bodyMd: string;
  videoAsset: string | null;
  transcript: unknown;
  durationSecs: number;
  authorName: string;
  reviewerName: string;
  reviewedAt: Date | null;
  tier: Tier;
}

const lessonParams = {
  type: 'object',
  additionalProperties: false,
  required: ['lessonId'],
  properties: { lessonId: uuid },
} as const;

const lessonSchema = {
  type: 'object',
  required: ['id', 'courseId', 'position', 'title', 'bodyMd', 'videoAsset', 'transcript', 'durationSecs',
    'authorName', 'reviewerName', 'reviewedAt', 'nextLessonId'],
  properties: {
    id: { type: 'string' },
    courseId: { type: 'string' },
    position: { type: 'integer' },
    title: { type: 'string' },
    bodyMd: { type: 'string' },
    videoAsset: { type: ['string', 'null'] },
    transcript: {},
    durationSecs: { type: 'integer' },
    authorName: { type: 'string' },
    reviewerName: { type: 'string' },
    reviewedAt: { type: ['string', 'null'] },
    nextLessonId: { type: ['string', 'null'] },
  },
} as const;

/** The lesson if this learner may open it; enrols them in its course on first open. */
async function openLesson(db: ScopedDb, learner: Learner, baseline: TierScores, lessonId: string): Promise<LessonRow> {
  const lesson = await db.maybeOne<LessonRow>(
    `SELECT l.id, l.course_id AS "courseId", l.position, l.title, l.body_md AS "bodyMd",
            l.video_asset AS "videoAsset", l.transcript, l.duration_secs AS "durationSecs",
            l.author_name AS "authorName", l.reviewer_name AS "reviewerName", l.reviewed_at AS "reviewedAt",
            c.tier
       FROM platform.lessons l
       JOIN platform.courses c ON c.id = l.course_id
       JOIN app.tenant_catalogues tc ON tc.course_id = c.id AND tc.enabled
      WHERE l.id = $1 AND c.review_state = 'published'`,
    [lessonId],
  );
  if (!lesson) throw new HttpError(404, 'lesson_not_found', 'No such lesson.');
  if (!tierUnlocked(lesson.tier, baseline)) {
    throw new HttpError(403, 'tier_locked', gateReason(lesson.tier, baseline) ?? 'This tier is locked.');
  }

  const enrolled = await db.maybeOne<{ ibRefCode: string | null }>(
    `INSERT INTO app.enrolments (tenant_id, user_id, course_id, ib_ref_code, source, state)
     SELECT app.current_tenant(), u.id, $2, u.ib_ref_code,
            CASE WHEN u.ib_ref_code IS NULL THEN 'organic' ELSE 'introducing_broker' END, 'in_progress'
       FROM app.users u
      WHERE u.id = $1
     ON CONFLICT (tenant_id, user_id, course_id) DO NOTHING
     RETURNING ib_ref_code AS "ibRefCode"`,
    [learner.id, lesson.courseId],
  );
  if (enrolled) {
    await db.enqueue({
      type: 'lead.enrolled',
      payload: { user_id: learner.id, course_id: lesson.courseId, ib_ref_code: enrolled.ibRefCode },
      idempotencyKey: `enrol:${learner.id}:${lesson.courseId}`,
      partitionKey: learner.id,
    });
  }
  return lesson;
}

export async function lessonRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { lessonId: string } }>('/lessons/:lessonId', {
    schema: { params: lessonParams, response: { 200: lessonSchema } },
  }, async (req) =>
    inAcademy(req, async (db) => {
      const learner = await requireLearner(db, req);
      const baseline = await requirePlacement(db, learner);
      const { tier: _tier, reviewedAt, ...lesson } = await openLesson(db, learner, baseline, req.params.lessonId);
      const next = await db.maybeOne<{ id: string }>(
        `SELECT id FROM platform.lessons WHERE course_id = $1 AND position > $2 ORDER BY position LIMIT 1`,
        [lesson.courseId, lesson.position],
      );
      return { ...lesson, reviewedAt: reviewedAt?.toISOString() ?? null, nextLessonId: next?.id ?? null };
    }));

  app.post<{ Params: { lessonId: string } }>('/lessons/:lessonId/checks', {
    schema: { params: lessonParams, response: { 200: paper, 201: paper } },
  }, async (req, reply) => {
    const { lessonId } = req.params;
    const { status, body } = await inAcademy(req, async (db) => {
      const learner = await requireLearner(db, req);
      const baseline = await requirePlacement(db, learner);
      const lesson = await openLesson(db, learner, baseline, lessonId);

      const questionsFor = async (ids: string[]) => inPaperOrder(ids, await db.query<PaperQuestion>(
        'SELECT id, prompt, options FROM platform.questions WHERE id = ANY($1::uuid[])', [ids]));

      // Hand back an open paper for this lesson rather than redrawing.
      const openPaper = async () => {
        const open = await db.maybeOne<{ id: string; questionIds: string[] }>(
          `SELECT id, question_ids AS "questionIds" FROM app.quiz_attempts
            WHERE user_id = $1 AND lesson_id = $2 AND kind = 'knowledge_check' AND submitted_at IS NULL`,
          [learner.id, lessonId],
        );
        return open && { status: 200 as const, body: { attemptId: open.id, questions: await questionsFor(open.questionIds) } };
      };
      const existing = await openPaper();
      if (existing) return existing;

      const bank = await db.query<{ id: string }>(
        'SELECT id FROM platform.questions WHERE lesson_id = $1 AND NOT is_placement',
        [lessonId],
      );
      const drawn = drawCheck(bank);
      if (!drawn) throw new HttpError(409, 'check_unavailable', 'This lesson has no knowledge check yet.');

      const ids = drawn.map((q) => q.id);
      // As with placement: a concurrent draw that inserted first wins, and
      // this caller is handed its paper.
      const attempt = await db.maybeOne<{ id: string }>(
        `INSERT INTO app.quiz_attempts (tenant_id, user_id, course_id, lesson_id, kind, question_ids, total_count)
         VALUES (app.current_tenant(), $1, $2, $3, 'knowledge_check', $4::uuid[], $5)
         ON CONFLICT (user_id, lesson_id) WHERE kind = 'knowledge_check' AND submitted_at IS NULL DO NOTHING
         RETURNING id`,
        [learner.id, lesson.courseId, lessonId, ids, ids.length],
      );
      if (attempt) return { status: 201 as const, body: { attemptId: attempt.id, questions: await questionsFor(ids) } };
      const winner = await openPaper();
      if (!winner) throw new Error('check insert conflicted but no open paper is visible');
      return winner;
    });
    return reply.status(status).send(body);
  });
}

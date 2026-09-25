/**
 * Knowledge-check submission. Two of three correct is a pass, and a pass
 * is the North Star: progression.verified, keyed by the attempt so a
 * retried submission can never count twice.
 *
 * The first pass also activates a placed learner. Every pass updates
 * course progress: the share of the course's lessons with a passed check.
 */
import type { FastifyInstance } from 'fastify';
import type { ScopedDb } from '../../db/unitOfWork.js';
import { gradeCheck } from '../../domain/placement.js';
import { inAcademy, requireLearner } from '../context.js';
import { HttpError } from '../errors.js';
import { answersBody, attemptParams, inPaperOrder } from '../schemas.js';

interface KeyRow {
  id: string;
  correctKey: string;
  rationales: Record<string, string>;
}

interface CheckResult {
  correct: number;
  total: number;
  passed: boolean;
  stars: number;
  feedback: { questionId: string; chosenKey: string | null; correctKey: string; rationale: string }[];
}

const resultSchema = {
  type: 'object',
  required: ['correct', 'total', 'passed', 'stars', 'feedback'],
  properties: {
    correct: { type: 'integer' },
    total: { type: 'integer' },
    passed: { type: 'boolean' },
    stars: { type: 'integer' },
    feedback: {
      type: 'array',
      items: {
        type: 'object',
        required: ['questionId', 'chosenKey', 'correctKey', 'rationale'],
        properties: {
          questionId: { type: 'string' },
          chosenKey: { type: ['string', 'null'] },
          correctKey: { type: 'string' },
          rationale: { type: 'string' },
        },
      },
    },
  },
} as const;

/** Grading is a pure function of the paper and the answers, so a replay reproduces it exactly. */
function grade(keys: KeyRow[], answers: Record<string, string>): CheckResult {
  const feedback = keys.map((q) => {
    const chosenKey = answers[q.id] ?? null;
    const rationale = (chosenKey ? q.rationales[chosenKey] : undefined) ?? q.rationales[q.correctKey] ?? '';
    return { questionId: q.id, chosenKey, correctKey: q.correctKey, rationale };
  });
  const correct = feedback.filter((f) => f.chosenKey === f.correctKey).length;
  return { correct, total: keys.length, ...gradeCheck(correct), feedback };
}

async function recordProgress(db: ScopedDb, userId: string, courseId: string): Promise<void> {
  await db.query(
    `UPDATE app.enrolments e
        SET progress_pct = p.pct,
            state        = CASE WHEN p.pct >= 100 THEN 'completed' ELSE 'in_progress' END,
            completed_at = CASE WHEN p.pct >= 100 THEN COALESCE(e.completed_at, now()) END
       FROM (SELECT LEAST(100, round(100.0 * count(DISTINCT q.lesson_id)
                     / NULLIF((SELECT count(*) FROM platform.lessons WHERE course_id = $2), 0)))::smallint AS pct
               FROM app.quiz_attempts a
               JOIN platform.questions q ON q.id = ANY(a.question_ids)
              WHERE a.user_id = $1 AND a.course_id = $2 AND a.kind = 'knowledge_check' AND a.passed) p
      WHERE e.user_id = $1 AND e.course_id = $2 AND p.pct IS NOT NULL`,
    [userId, courseId],
  );
}

export async function checkRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { attemptId: string }; Body: { answers: Record<string, string> } }>(
    '/checks/:attemptId/submission', {
      schema: { params: attemptParams, body: answersBody(false), response: { 200: resultSchema } },
    }, async (req) => {
      const { attemptId } = req.params;
      const { answers } = req.body;

      return inAcademy(req, async (db): Promise<CheckResult> => {
        const learner = await requireLearner(db, req);
        // Locked, so two submissions racing each other grade once.
        const attempt = await db.maybeOne<{
          courseId: string; questionIds: string[]; stored: Record<string, string>; submitted: boolean;
        }>(
          `SELECT course_id AS "courseId", question_ids AS "questionIds", answers AS stored,
                  submitted_at IS NOT NULL AS submitted
             FROM app.quiz_attempts
            WHERE id = $1 AND user_id = $2 AND kind = 'knowledge_check'
            FOR UPDATE`,
          [attemptId, learner.id],
        );
        if (!attempt) throw new HttpError(404, 'attempt_not_found', 'No such knowledge check.');

        const keys = inPaperOrder(attempt.questionIds, await db.query<KeyRow>(
          'SELECT id, correct_key AS "correctKey", rationales FROM platform.questions WHERE id = ANY($1::uuid[])',
          [attempt.questionIds],
        ));
        if (attempt.submitted) return grade(keys, attempt.stored);

        const onPaper = new Set(attempt.questionIds);
        if (Object.keys(answers).some((id) => !onPaper.has(id))) {
          throw new HttpError(422, 'unknown_question', 'An answer was given for a question not on this paper.');
        }

        const result = grade(keys, answers);
        await db.query(
          `UPDATE app.quiz_attempts
              SET answers = $2::jsonb, correct_count = $3, total_count = $4, passed = $5, stars = $6,
                  submitted_at = now()
            WHERE id = $1`,
          [attemptId, JSON.stringify(answers), result.correct, result.total, result.passed, result.stars],
        );
        if (!result.passed) return result;

        await db.enqueue({
          type: 'progression.verified',
          payload: {
            user_id: learner.id, attempt_id: attemptId, course_id: attempt.courseId,
            correct: result.correct, total: result.total, stars: result.stars,
          },
          idempotencyKey: `check.passed:${attemptId}`,
          partitionKey: learner.id,
        });

        const activated = await db.maybeOne(
          `UPDATE app.users SET lifecycle = 'activated' WHERE id = $1 AND lifecycle = 'placed' RETURNING id`,
          [learner.id],
        );
        if (activated) {
          await db.enqueue({
            type: 'learner.activated',
            payload: { user_id: learner.id, attempt_id: attemptId },
            idempotencyKey: `activated:${learner.id}`,
            partitionKey: learner.id,
          });
        }

        await recordProgress(db, learner.id, attempt.courseId);
        return result;
      });
    });
}

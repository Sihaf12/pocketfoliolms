/**
 * Knowledge-check submission. Two of three correct is a pass, and the
 * first pass of a lesson is the North Star: progression.verified, keyed
 * by learner and lesson. A retake is graded and gets full feedback, but
 * the learner has already verified that lesson, so it emits nothing.
 *
 * The first pass also activates a placed learner. Every pass updates
 * course progress: the share of the course's lessons with a passed check.
 * A course reaching 100% issues its certificate in the same transaction.
 *
 * A second failed check on the same lesson flags the learner as at risk:
 * churn_risk.flagged, once per learner per lesson, is the signal a broker
 * acts on.
 */
import type { FastifyInstance } from 'fastify';
import type { ScopedDb } from '../../db/unitOfWork.js';
import { gradeCheck } from '../../domain/placement.js';
import { newCertificateSerial } from '../../domain/serial.js';
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
  /** Issued by this submission, if it completed a course. */
  certificate: { serial: string; courseTitle: string } | null;
}

const resultSchema = {
  type: 'object',
  required: ['correct', 'total', 'passed', 'stars', 'feedback', 'certificate'],
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
    certificate: {
      type: ['object', 'null'],
      required: ['serial', 'courseTitle'],
      properties: { serial: { type: 'string' }, courseTitle: { type: 'string' } },
    },
  },
} as const;

/** Grades a fresh submission. A replay does not come through here; it reads the stored grade. */
function grade(keys: KeyRow[], answers: Record<string, string>): Omit<CheckResult, 'certificate'> {
  const feedback = keys.map((q) => {
    const chosenKey = answers[q.id] ?? null;
    const rationale = (chosenKey ? q.rationales[chosenKey] : undefined) ?? q.rationales[q.correctKey] ?? '';
    return { questionId: q.id, chosenKey, correctKey: q.correctKey, rationale };
  });
  const correct = feedback.filter((f) => f.chosenKey === f.correctKey).length;
  return { correct, total: keys.length, ...gradeCheck(correct), feedback };
}

/**
 * Progress is the share of the course's lessons that have a passed check,
 * counted from the lesson each attempt recorded at draw. Lessons since
 * removed from the course no longer count.
 */
async function recordProgress(db: ScopedDb, userId: string, courseId: string): Promise<number | null> {
  const row = await db.maybeOne<{ pct: number }>(
    `UPDATE app.enrolments e
        SET progress_pct = p.pct,
            state        = CASE WHEN p.pct >= 100 THEN 'completed' ELSE 'in_progress' END,
            completed_at = CASE WHEN p.pct >= 100 THEN COALESCE(e.completed_at, now()) END
       FROM (SELECT LEAST(100, round(100.0 * count(DISTINCT a.lesson_id)
                     / NULLIF((SELECT count(*) FROM platform.lessons WHERE course_id = $2), 0)))::smallint AS pct
               FROM app.quiz_attempts a
               JOIN platform.lessons l ON l.id = a.lesson_id AND l.course_id = $2
              WHERE a.user_id = $1 AND a.kind = 'knowledge_check' AND a.passed) p
      WHERE e.user_id = $1 AND e.course_id = $2 AND p.pct IS NOT NULL
      RETURNING e.progress_pct::int AS pct`,
    [userId, courseId],
  );
  return row?.pct ?? null;
}

const SERIAL_ATTEMPTS = 5;

/**
 * The certificate for a completed course, issued once.
 *
 * E14-F02 course assessments will replace this trigger: for now, passing
 * a knowledge check on every lesson of a course is what earns it. The
 * holder name and course title are copied at issue, so the certificate
 * says what was true on the day. A serial collision (40 random bits)
 * retries with a fresh serial; an existing certificate for the course
 * means there is nothing to issue.
 */
async function issueCertificate(
  db: ScopedDb, userId: string, courseId: string,
): Promise<{ serial: string; courseTitle: string } | null> {
  for (let i = 0; i < SERIAL_ATTEMPTS; i++) {
    const issued = await db.maybeOne<{ serial: string; courseTitle: string }>(
      `INSERT INTO app.certificates (tenant_id, user_id, course_id, serial, holder_name, course_title)
       SELECT app.current_tenant(), u.id, c.id, $3, u.display_name, c.title
         FROM app.users u, platform.courses c
        WHERE u.id = $1 AND c.id = $2
       ON CONFLICT DO NOTHING
       RETURNING serial, course_title AS "courseTitle"`,
      [userId, courseId, newCertificateSerial()],
    );
    if (issued) {
      await db.enqueue({
        type: 'certificate.issued',
        payload: { user_id: userId, course_id: courseId, serial: issued.serial, course_title: issued.courseTitle },
        idempotencyKey: `cert:${userId}:${courseId}`,
        partitionKey: userId,
      });
      await db.query(
        `UPDATE app.users SET lifecycle = 'certified'
          WHERE id = $1 AND lifecycle IN ('placed', 'activated', 'active')`,
        [userId],
      );
      return issued;
    }
    const held = await db.maybeOne(
      'SELECT 1 FROM app.certificates WHERE user_id = $1 AND course_id = $2',
      [userId, courseId],
    );
    if (held) return null;
  }
  throw new Error('could not find an unused certificate serial');
}

const FAILURES_BEFORE_FLAG = 2;

/** On the second failed check of a lesson, flag the learner once for that lesson. */
async function flagChurnRisk(
  db: ScopedDb, userId: string, lessonId: string, courseId: string, attemptId: string,
): Promise<void> {
  const counts = await db.one<{ failed: number; attempts: number }>(
    `SELECT count(*) FILTER (WHERE NOT passed)::int AS failed, count(*)::int AS attempts
       FROM app.quiz_attempts
      WHERE user_id = $1 AND lesson_id = $2 AND kind = 'knowledge_check' AND submitted_at IS NOT NULL`,
    [userId, lessonId],
  );
  if (counts.failed !== FAILURES_BEFORE_FLAG) return;
  await db.enqueue({
    type: 'churn_risk.flagged',
    payload: {
      user_id: userId, lesson_id: lessonId, course_id: courseId, attempt_id: attemptId,
      failed_attempts: counts.failed, attempts: counts.attempts, reason: 'failed_check_twice',
    },
    idempotencyKey: `churn:${userId}:${lessonId}`,
    partitionKey: userId,
  });
}

interface Answered { correct: boolean; correctKey: string; rationale: string }

export async function checkRoutes(app: FastifyInstance): Promise<void> {
  // One answer at a time, as the learner goes: it is recorded, cannot be
  // changed, and comes back marked with the rationale for the option
  // chosen. The submission that follows must carry the same answers, and
  // is what grades the paper, emits the verified event and issues any
  // certificate. The browser never holds the answer keys.
  app.post<{ Params: { attemptId: string }; Body: { questionId: string; key: string } }>(
    '/checks/:attemptId/answers', {
      schema: {
        params: attemptParams,
        body: {
          type: 'object', additionalProperties: false, required: ['questionId', 'key'],
          properties: { questionId: { type: 'string', format: 'uuid' }, key: { type: 'string', maxLength: 16 } },
        },
        response: {
          200: {
            type: 'object', required: ['correct', 'correctKey', 'rationale'],
            properties: { correct: { type: 'boolean' }, correctKey: { type: 'string' }, rationale: { type: 'string' } },
          },
        },
      },
    }, async (req) => {
      const { attemptId } = req.params;
      const { questionId, key } = req.body;
      return inAcademy(req, async (db): Promise<Answered> => {
        const learner = await requireLearner(db, req);
        const attempt = await db.maybeOne<{ questionIds: string[]; stored: Record<string, string>; submitted: boolean }>(
          `SELECT question_ids AS "questionIds", COALESCE(answers, '{}'::jsonb) AS stored, submitted_at IS NOT NULL AS submitted
             FROM app.quiz_attempts
            WHERE id = $1 AND user_id = $2 AND kind = 'knowledge_check'
            FOR UPDATE`,
          [attemptId, learner.id],
        );
        if (!attempt) throw new HttpError(404, 'attempt_not_found', 'No such knowledge check.');
        if (!attempt.questionIds.includes(questionId)) throw new HttpError(422, 'unknown_question', 'That question is not on this paper.');
        const q = await db.one<KeyRow & { options: { key: string }[] }>(
          'SELECT id, correct_key AS "correctKey", rationales, options FROM platform.questions WHERE id = $1', [questionId]);
        if (!q.options.some((o) => o.key === key)) throw new HttpError(422, 'unknown_option', 'That is not one of the options.');

        const already = attempt.stored[questionId];
        if (already !== undefined && already !== key) {
          throw new HttpError(409, 'already_answered', 'This question has been answered. The first answer stands.');
        }
        if (already === undefined) {
          if (attempt.submitted) throw new HttpError(409, 'already_submitted', 'This check has been submitted.');
          await db.query(
            `UPDATE app.quiz_attempts SET answers = COALESCE(answers, '{}'::jsonb) || jsonb_build_object($2::text, $3::text) WHERE id = $1`,
            [attemptId, questionId, key]);
        }
        return { correct: key === q.correctKey, correctKey: q.correctKey, rationale: q.rationales[key] ?? q.rationales[q.correctKey] ?? '' };
      });
    });

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
          courseId: string; lessonId: string; questionIds: string[]; stored: Record<string, string>; submitted: boolean;
          correctCount: number; totalCount: number; passed: boolean; stars: number;
        }>(
          `SELECT course_id AS "courseId", lesson_id AS "lessonId", question_ids AS "questionIds", answers AS stored,
                  submitted_at IS NOT NULL AS submitted,
                  correct_count AS "correctCount", total_count AS "totalCount", passed, stars
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
        if (attempt.submitted) {
          // The grade given at submission stands, even if an answer key has
          // been corrected since. Feedback is rebuilt from the stored answers.
          return {
            correct: attempt.correctCount,
            total: attempt.totalCount,
            passed: attempt.passed,
            stars: attempt.stars,
            feedback: grade(keys, attempt.stored).feedback,
            certificate: null,
          };
        }

        const onPaper = new Set(attempt.questionIds);
        if (Object.keys(answers).some((id) => !onPaper.has(id))) {
          throw new HttpError(422, 'unknown_question', 'An answer was given for a question not on this paper.');
        }
        // An answer already given one at a time stands: the submission cannot change it.
        const stored = attempt.stored ?? {};
        if (Object.entries(stored).some(([id, key]) => answers[id] !== key)) {
          throw new HttpError(422, 'answer_changed', 'An answer differs from the one already given to that question.');
        }

        const result = grade(keys, answers);
        await db.query(
          `UPDATE app.quiz_attempts
              SET answers = $2::jsonb, correct_count = $3, total_count = $4, passed = $5, stars = $6,
                  submitted_at = now()
            WHERE id = $1`,
          [attemptId, JSON.stringify(answers), result.correct, result.total, result.passed, result.stars],
        );
        if (!result.passed) {
          await flagChurnRisk(db, learner.id, attempt.lessonId, attempt.courseId, attemptId);
          return { ...result, certificate: null };
        }

        // Checked here rather than left to the idempotency key alone, so the
        // rule holds even once delivered outbox rows are pruned. Only one
        // paper per lesson can be open, so no other pass can race this one.
        const passedBefore = await db.maybeOne(
          `SELECT 1 FROM app.quiz_attempts
            WHERE user_id = $1 AND lesson_id = $2 AND kind = 'knowledge_check' AND passed AND id <> $3
            LIMIT 1`,
          [learner.id, attempt.lessonId, attemptId],
        );
        if (!passedBefore) {
          await db.enqueue({
            type: 'progression.verified',
            payload: {
              user_id: learner.id, attempt_id: attemptId, course_id: attempt.courseId, lesson_id: attempt.lessonId,
              correct: result.correct, total: result.total, stars: result.stars,
            },
            idempotencyKey: `check.passed:${learner.id}:${attempt.lessonId}`,
            partitionKey: learner.id,
          });
        }

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

        const pct = await recordProgress(db, learner.id, attempt.courseId);
        const certificate = pct !== null && pct >= 100
          ? await issueCertificate(db, learner.id, attempt.courseId)
          : null;
        return { ...result, certificate };
      });
    });
}

/**
 * Placement: draw a paper, then submit it once for a baseline.
 *
 * baseline = placement * 0.6 + self_rating * 0.4, per tier, from
 * domain/placement.ts. Submitting again returns the stored result and
 * emits nothing, so a retried request cannot place a learner twice.
 */
import type { FastifyInstance } from 'fastify';
import type { ScopedDb } from '../../db/unitOfWork.js';
import {
  TIERS, baselineFrom, gateReason, levelFrom, tierUnlocked,
  type Level, type PlacementAnswer, type Tier, type TierScores,
} from '../../domain/placement.js';
import { drawPlacement } from '../../domain/papers.js';
import { inAcademy, requireLearner } from '../context.js';
import { HttpError } from '../errors.js';
import { answersBody, attemptParams, inPaperOrder, paper, type PaperQuestion } from '../schemas.js';
import { tierScoresSchema } from './onboarding.js';

export interface TierStatus {
  tier: Tier;
  unlocked: boolean;
  gateReason: string | null;
}

export const tierStatusSchema = {
  type: 'object',
  required: ['tier', 'unlocked', 'gateReason'],
  properties: { tier: { type: 'string' }, unlocked: { type: 'boolean' }, gateReason: { type: ['string', 'null'] } },
} as const;

export function tierStatuses(baseline: TierScores): TierStatus[] {
  return TIERS.map((tier) => ({ tier, unlocked: tierUnlocked(tier, baseline), gateReason: gateReason(tier, baseline) }));
}

interface PlacementResult {
  baseline: TierScores;
  level: Level;
  tiers: TierStatus[];
}

const resultSchema = {
  type: 'object',
  required: ['baseline', 'level', 'tiers'],
  properties: { baseline: tierScoresSchema, level: { type: 'string' }, tiers: { type: 'array', items: tierStatusSchema } },
} as const;

async function paperFor(db: ScopedDb, questionIds: string[]): Promise<PaperQuestion[]> {
  const rows = await db.query<PaperQuestion>(
    'SELECT id, tier, prompt, options FROM platform.questions WHERE id = ANY($1::uuid[])',
    [questionIds],
  );
  return inPaperOrder(questionIds, rows);
}

async function storedResult(db: ScopedDb, userId: string): Promise<PlacementResult> {
  const path = await db.one<{ baseline: TierScores; level: Level }>(
    'SELECT baseline, level FROM app.learning_paths WHERE user_id = $1',
    [userId],
  );
  return { baseline: path.baseline, level: path.level, tiers: tierStatuses(path.baseline) };
}

export async function placementRoutes(app: FastifyInstance): Promise<void> {
  app.post('/placement', {
    schema: { response: { 200: paper, 201: paper } },
  }, async (req, reply) => {
    const { status, body } = await inAcademy(req, async (db) => {
      const learner = await requireLearner(db, req);
      if (learner.lifecycle === 'registered') {
        throw new HttpError(409, 'onboarding_required', 'Rate yourself in onboarding before placement.');
      }
      if (learner.lifecycle !== 'onboarded') {
        throw new HttpError(409, 'already_placed', 'Placement is already done.');
      }

      // An open paper is handed back rather than redrawn, so asking again
      // cannot be used to shop for easier questions.
      const open = await db.maybeOne<{ id: string; questionIds: string[] }>(
        `SELECT id, question_ids AS "questionIds" FROM app.quiz_attempts
          WHERE user_id = $1 AND kind = 'placement' AND submitted_at IS NULL
          ORDER BY started_at DESC LIMIT 1`,
        [learner.id],
      );
      if (open) return { status: 200 as const, body: { attemptId: open.id, questions: await paperFor(db, open.questionIds) } };

      const bank = await db.query<PaperQuestion & { tier: Tier }>(
        `SELECT q.id, q.tier, q.prompt, q.options
           FROM platform.questions q
           JOIN platform.courses c ON c.id = q.course_id
          WHERE q.is_placement AND c.review_state = 'published'`,
      );
      const questions = drawPlacement(bank);
      if (questions.length === 0) {
        throw new HttpError(503, 'placement_unavailable', 'Placement is not available yet.');
      }

      const attempt = await db.one<{ id: string }>(
        `INSERT INTO app.quiz_attempts (tenant_id, user_id, kind, question_ids, total_count)
         VALUES (app.current_tenant(), $1, 'placement', $2::uuid[], $3)
         RETURNING id`,
        [learner.id, questions.map((q) => q.id), questions.length],
      );
      return { status: 201 as const, body: { attemptId: attempt.id, questions } };
    });
    return reply.status(status).send(body);
  });

  app.post<{ Params: { attemptId: string }; Body: { answers: Record<string, string | null> } }>(
    '/placement/:attemptId/submission', {
      schema: { params: attemptParams, body: answersBody(true), response: { 200: resultSchema } },
    }, async (req) => {
      const { attemptId } = req.params;
      const { answers } = req.body;

      return inAcademy(req, async (db): Promise<PlacementResult> => {
        const learner = await requireLearner(db, req);
        // Locked, so two submissions racing each other grade once.
        const attempt = await db.maybeOne<{ questionIds: string[]; submitted: boolean }>(
          `SELECT question_ids AS "questionIds", submitted_at IS NOT NULL AS submitted
             FROM app.quiz_attempts
            WHERE id = $1 AND user_id = $2 AND kind = 'placement'
            FOR UPDATE`,
          [attemptId, learner.id],
        );
        if (!attempt) throw new HttpError(404, 'attempt_not_found', 'No such placement attempt.');
        if (attempt.submitted) return storedResult(db, learner.id);

        const onPaper = new Set(attempt.questionIds);
        if (Object.keys(answers).some((id) => !onPaper.has(id))) {
          throw new HttpError(422, 'unknown_question', 'An answer was given for a question not on this paper.');
        }

        const path = await db.maybeOne<{ selfRating: TierScores }>(
          'SELECT self_rating AS "selfRating" FROM app.learning_paths WHERE user_id = $1',
          [learner.id],
        );
        if (!path) throw new HttpError(409, 'onboarding_required', 'Rate yourself in onboarding before placement.');

        const keys = await db.query<{ id: string; tier: Tier; correctKey: string }>(
          'SELECT id, tier, correct_key AS "correctKey" FROM platform.questions WHERE id = ANY($1::uuid[])',
          [attempt.questionIds],
        );
        // An unanswered question is a skip: it scores zero and becomes a lesson.
        const graded: PlacementAnswer[] = keys.map((q) => {
          const given = answers[q.id];
          return { tier: q.tier, correct: given == null ? null : given === q.correctKey };
        });
        const baseline = baselineFrom(graded, path.selfRating);
        const level = levelFrom(baseline);
        const tiers = tierStatuses(baseline);

        await db.query(
          `UPDATE app.quiz_attempts
              SET answers = $2::jsonb, correct_count = $3, total_count = $4, submitted_at = now()
            WHERE id = $1`,
          [attemptId, JSON.stringify(answers), graded.filter((a) => a.correct === true).length, graded.length],
        );
        await db.query(
          `UPDATE app.learning_paths
              SET baseline = $2::jsonb, level = $3, stages = $4::jsonb, computed_at = now()
            WHERE user_id = $1`,
          [learner.id, JSON.stringify(baseline), level, JSON.stringify(tiers)],
        );
        await db.query(
          `UPDATE app.users SET skill_map = $2::jsonb, lifecycle = 'placed'
            WHERE id = $1 AND lifecycle = 'onboarded'`,
          [learner.id, JSON.stringify(baseline)],
        );
        await db.enqueue({
          type: 'learner.placed',
          payload: { user_id: learner.id, attempt_id: attemptId, baseline, level },
          idempotencyKey: `placement:${attemptId}`,
          partitionKey: learner.id,
        });
        return { baseline, level, tiers };
      });
    });
}

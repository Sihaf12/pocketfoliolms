/**
 * Onboarding: the learner's self-rating per tier, which makes up 40% of
 * the placement baseline, plus their goal and daily time. It can be
 * revised until placement is taken, then it is fixed, because the
 * baseline was computed from it.
 */
import type { FastifyInstance } from 'fastify';
import type { TierScores } from '../../domain/placement.js';
import { inAcademy, requireLearner } from '../context.js';
import { HttpError } from '../errors.js';

const rating = { type: 'integer', minimum: 0, maximum: 100 } as const;

export const GOALS = ['new', 'some_experience', 'stop_losing', 'go_deeper'] as const;
export const DAILY_MINUTES = [10, 20, 30] as const;

interface OnboardingBody {
  selfRating: TierScores;
  goal?: (typeof GOALS)[number];
  dailyMinutes?: (typeof DAILY_MINUTES)[number];
}

export const tierScoresSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['learn', 'safeguard', 'apply', 'specialise'],
  properties: { learn: rating, safeguard: rating, apply: rating, specialise: rating },
} as const;

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  app.put<{ Body: OnboardingBody }>('/onboarding', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['selfRating'],
        properties: {
          selfRating: tierScoresSchema,
          goal: { type: 'string', enum: GOALS },
          dailyMinutes: { type: 'integer', enum: DAILY_MINUTES },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['selfRating', 'goal', 'dailyMinutes', 'lifecycle'],
          properties: {
            selfRating: tierScoresSchema,
            goal: { type: ['string', 'null'] },
            dailyMinutes: { type: ['integer', 'null'] },
            lifecycle: { type: 'string' },
          },
        },
      },
    },
  }, async (req) => {
    const { selfRating, goal, dailyMinutes } = req.body;

    return inAcademy(req, async (db) => {
      const learner = await requireLearner(db, req);
      if (learner.lifecycle !== 'registered' && learner.lifecycle !== 'onboarded') {
        throw new HttpError(409, 'already_placed', 'Self-ratings are fixed once placement is done.');
      }

      await db.query(
        `INSERT INTO app.learning_paths (tenant_id, user_id, self_rating)
         VALUES (app.current_tenant(), $1, $2::jsonb)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET self_rating = EXCLUDED.self_rating`,
        [learner.id, JSON.stringify(selfRating)],
      );

      // Omitted answers are left as they were, so they can be given later.
      const answers = await db.one<{ goal: string | null; dailyMinutes: number | null }>(
        `UPDATE app.users
            SET goal = COALESCE($2, goal), daily_minutes = COALESCE($3, daily_minutes)
          WHERE id = $1
          RETURNING goal, daily_minutes AS "dailyMinutes"`,
        [learner.id, goal ?? null, dailyMinutes ?? null],
      );

      // Only the first submission moves the lifecycle, so only it emits.
      const moved = await db.maybeOne(
        `UPDATE app.users SET lifecycle = 'onboarded' WHERE id = $1 AND lifecycle = 'registered' RETURNING id`,
        [learner.id],
      );
      if (moved) {
        await db.enqueue({
          type: 'learner.onboarded',
          payload: { user_id: learner.id, self_rating: selfRating, goal: answers.goal, daily_minutes: answers.dailyMinutes },
          idempotencyKey: `onboarded:${learner.id}`,
          partitionKey: learner.id,
        });
      }
      return { selfRating, ...answers, lifecycle: 'onboarded' };
    });
  });
}

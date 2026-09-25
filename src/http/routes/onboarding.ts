/**
 * Onboarding: the learner's self-rating per tier, which makes up 40% of
 * the placement baseline. It can be revised until placement is taken,
 * then it is fixed, because the baseline was computed from it.
 */
import type { FastifyInstance } from 'fastify';
import type { TierScores } from '../../domain/placement.js';
import { inAcademy, requireLearner } from '../context.js';
import { HttpError } from '../errors.js';

const rating = { type: 'integer', minimum: 0, maximum: 100 } as const;

export const tierScoresSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['learn', 'safeguard', 'apply', 'specialise'],
  properties: { learn: rating, safeguard: rating, apply: rating, specialise: rating },
} as const;

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  app.put<{ Body: { selfRating: TierScores } }>('/onboarding', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['selfRating'],
        properties: { selfRating: tierScoresSchema },
      },
      response: {
        200: {
          type: 'object',
          required: ['selfRating', 'lifecycle'],
          properties: { selfRating: tierScoresSchema, lifecycle: { type: 'string' } },
        },
      },
    },
  }, async (req) => {
    const { selfRating } = req.body;

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

      // Only the first submission moves the lifecycle, so only it emits.
      const moved = await db.maybeOne(
        `UPDATE app.users SET lifecycle = 'onboarded' WHERE id = $1 AND lifecycle = 'registered' RETURNING id`,
        [learner.id],
      );
      if (moved) {
        await db.enqueue({
          type: 'learner.onboarded',
          payload: { user_id: learner.id, self_rating: selfRating },
          idempotencyKey: `onboarded:${learner.id}`,
          partitionKey: learner.id,
        });
      }
      return { selfRating, lifecycle: 'onboarded' };
    });
  });
}

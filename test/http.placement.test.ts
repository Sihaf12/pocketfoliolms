/**
 * Module 3 · onboarding and placement. The baseline is the published
 * 60/40 rule applied to a paper the server drew, graded once.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { shutdown, withControl } from '../src/db/unitOfWork.js';
import {
  NORTHGATE, SABLE, SELF_RATING, asLearner, drawPlacement, onboard, outboxRows, placementAnswers,
  removeHttpAccounts, server, signup,
} from './httpHarness.js';

let app: FastifyInstance;

before(async () => {
  await removeHttpAccounts();
  app = await server();
});

after(async () => {
  await app.close();
  await removeHttpAccounts();
  await shutdown();
});

const put = (host: string, token: string | undefined, selfRating: unknown) =>
  app.inject({
    method: 'PUT',
    url: '/api/v1/onboarding',
    headers: { host, ...(token ? asLearner(token) : {}) },
    payload: { selfRating },
  });

const submit = (token: string, attemptId: string, answers: Record<string, string | null>) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/placement/${attemptId}/submission`,
    headers: { host: NORTHGATE, ...asLearner(token) },
    payload: { answers },
  });

async function lifecycleOf(userId: string): Promise<string> {
  return withControl(async (c) =>
    (await c.query<{ lifecycle: string }>('SELECT lifecycle FROM app.users WHERE id = $1', [userId])).rows[0]!.lifecycle);
}

test('onboarding needs a session from this academy', async () => {
  const { token } = await signup(app, NORTHGATE);
  assert.equal((await put(NORTHGATE, undefined, SELF_RATING)).statusCode, 401);
  const away = await put(SABLE, token, SELF_RATING);
  assert.equal(away.statusCode, 401, "northgate's session means nothing on sable's host");
  assert.equal(away.json().error.code, 'unauthenticated');
});

test('self-ratings must cover every tier within 0 to 100', async () => {
  const { token } = await signup(app, NORTHGATE);
  for (const bad of [{ ...SELF_RATING, learn: 101 }, { ...SELF_RATING, apply: -1 }, { learn: 50 }, { ...SELF_RATING, extra: 1 }]) {
    assert.equal((await put(NORTHGATE, token, bad)).statusCode, 400, JSON.stringify(bad));
  }
});

test('onboarding moves the learner on and emits once, however often it is saved', async () => {
  const { token, userId } = await signup(app, NORTHGATE);
  const first = await put(NORTHGATE, token, SELF_RATING);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json(), { selfRating: SELF_RATING, lifecycle: 'onboarded' });

  const revised = { ...SELF_RATING, learn: 60 };
  assert.equal((await put(NORTHGATE, token, revised)).statusCode, 200);

  assert.equal(await lifecycleOf(userId), 'onboarded');
  const events = await outboxRows(`onboarded:${userId}`);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event_type, 'learner.onboarded');
  const stored = await withControl(async (c) =>
    (await c.query<{ self_rating: unknown }>('SELECT self_rating FROM app.learning_paths WHERE user_id = $1', [userId])).rows[0]!);
  assert.deepEqual(stored.self_rating, revised, 'the latest rating is kept');
});

test('placement cannot start before onboarding', async () => {
  const { token } = await signup(app, NORTHGATE);
  const res = await app.inject({ method: 'POST', url: '/api/v1/placement', headers: { host: NORTHGATE, ...asLearner(token) } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, 'onboarding_required');
});

test('the placement paper spans every tier and never reveals an answer', async () => {
  const { token } = await signup(app, NORTHGATE);
  await onboard(app, NORTHGATE, token);
  const paper = await drawPlacement(app, NORTHGATE, token);
  assert.equal(paper.questions.length, 8);
  for (const tier of ['learn', 'safeguard', 'apply', 'specialise']) {
    assert.equal(paper.questions.filter((q) => q.tier === tier).length, 2, tier);
  }
  for (const q of paper.questions) {
    assert.deepEqual(Object.keys(q).sort(), ['id', 'options', 'prompt', 'tier']);
  }

  const again = await drawPlacement(app, NORTHGATE, token);
  assert.equal(again.attemptId, paper.attemptId, 'an open paper is returned, not redrawn');
});

test('answers must belong to the paper, and the paper to the learner', async () => {
  const owner = await signup(app, NORTHGATE);
  await onboard(app, NORTHGATE, owner.token);
  const paper = await drawPlacement(app, NORTHGATE, owner.token);

  const foreign = await submit(owner.token, paper.attemptId, { '00000000-0000-4000-8000-000000000000': 'a' });
  assert.equal(foreign.statusCode, 422);
  assert.equal(foreign.json().error.code, 'unknown_question');

  const other = await signup(app, NORTHGATE);
  const stolen = await submit(other.token, paper.attemptId, {});
  assert.equal(stolen.statusCode, 404, "another learner's attempt does not exist for them");
});

test('the baseline is placement * 0.6 + self-rating * 0.4, with the published gates', async () => {
  const { token, userId } = await signup(app, NORTHGATE);
  await onboard(app, NORTHGATE, token, SELF_RATING);
  const paper = await drawPlacement(app, NORTHGATE, token);

  // Learn 2/2, Safeguard 1/2, Apply and Specialise skipped.
  const res = await submit(token, paper.attemptId, placementAnswers(paper, { learn: 2, safeguard: 1 }));
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(body.baseline, { learn: 80, safeguard: 30, apply: 40, specialise: 10 });
  assert.equal(body.level, 'learner');
  assert.deepEqual(body.tiers, [
    { tier: 'learn', unlocked: true, gateReason: null },
    { tier: 'safeguard', unlocked: true, gateReason: null },
    { tier: 'apply', unlocked: true, gateReason: null },
    { tier: 'specialise', unlocked: false, gateReason: 'Unlocks at Learn 70 and Safeguard 50. You are at 80 and 30.' },
  ]);

  assert.equal(await lifecycleOf(userId), 'placed');
  const events = await outboxRows(`placement:${paper.attemptId}`);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event_type, 'learner.placed');
  assert.deepEqual(events[0]!.payload.baseline, body.baseline);
});

test('a repeated submission returns the stored result and emits nothing new', async () => {
  const { token } = await signup(app, NORTHGATE);
  await onboard(app, NORTHGATE, token);
  const paper = await drawPlacement(app, NORTHGATE, token);
  const first = await submit(token, paper.attemptId, placementAnswers(paper, { learn: 2 }));
  const second = await submit(token, paper.attemptId, placementAnswers(paper, { learn: 2, safeguard: 2, apply: 2, specialise: 2 }));
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json(), first.json(), 'the first grading stands');
  assert.equal((await outboxRows(`placement:${paper.attemptId}`)).length, 1);
});

test('once placed, onboarding and placement are closed', async () => {
  const { token } = await signup(app, NORTHGATE);
  await onboard(app, NORTHGATE, token);
  const paper = await drawPlacement(app, NORTHGATE, token);
  await submit(token, paper.attemptId, {});

  const rerate = await put(NORTHGATE, token, SELF_RATING);
  assert.equal(rerate.statusCode, 409);
  assert.equal(rerate.json().error.code, 'already_placed');
  const redraw = await app.inject({ method: 'POST', url: '/api/v1/placement', headers: { host: NORTHGATE, ...asLearner(token) } });
  assert.equal(redraw.statusCode, 409);
});

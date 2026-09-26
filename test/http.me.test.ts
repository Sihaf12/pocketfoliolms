/**
 * Demo wiring · stage 1. Prerequisites enforced by the server, the
 * pathway reporting every lesson's state and reason, and the learner's
 * own record and events, all computed from Postgres.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { shutdown, withControl } from '../src/db/unitOfWork.js';
import {
  NORTHGATE, SABLE, SELF_RATING, asLearner, placedLearner, removeHttpAccounts, server, signup, type Paper,
} from './httpHarness.js';

let app: FastifyInstance;
const lessonIds: Record<string, string> = {};

before(async () => {
  await removeHttpAccounts();
  app = await server();
  await withControl(async (c) => {
    const rows = await c.query<{ slug: string; position: number; id: string }>(
      `SELECT c.slug, l.position, l.id FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id`);
    for (const r of rows.rows) lessonIds[`${r.slug}/${r.position}`] = r.id;
  });
});

after(async () => {
  await app.close();
  await removeHttpAccounts();
  await shutdown();
});

const get = (host: string, token: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { host, ...asLearner(token) } });

async function pass(host: string, token: string, lessonKey: string): Promise<string> {
  const paper = (await app.inject({
    method: 'POST', url: `/api/v1/lessons/${lessonIds[lessonKey]}/checks`, headers: { host, ...asLearner(token) },
  })).json<Paper>();
  const res = await app.inject({
    method: 'POST', url: `/api/v1/checks/${paper.attemptId}/submission`, headers: { host, ...asLearner(token) },
    payload: { answers: Object.fromEntries(paper.questions.map((q) => [q.id, 'a'])) },
  });
  assert.equal(res.json().passed, true, `passing ${lessonKey}`);
  return paper.attemptId;
}

interface PathwayLesson { id: string; title: string; minutes: number; xp: number; state: string; gateReason: string | null; requires: string[] }
interface Pathway {
  nextLessonId: string | null;
  tiers: { tier: string; courses: { slug: string; certificate: unknown; lessons: PathwayLesson[] }[] }[];
}
const lessonIn = (p: Pathway, key: string) =>
  p.tiers.flatMap((t) => t.courses.flatMap((c) => c.lessons)).find((l) => l.id === lessonIds[key])!;

test('onboarding stores the goal and daily time, and refuses values outside the lists', async () => {
  const { token, userId } = await signup(app, NORTHGATE);
  const bad = await app.inject({
    method: 'PUT', url: '/api/v1/onboarding', headers: { host: NORTHGATE, ...asLearner(token) },
    payload: { selfRating: SELF_RATING, goal: 'get_rich', dailyMinutes: 45 },
  });
  assert.equal(bad.statusCode, 400);

  const res = await app.inject({
    method: 'PUT', url: '/api/v1/onboarding', headers: { host: NORTHGATE, ...asLearner(token) },
    payload: { selfRating: SELF_RATING, goal: 'stop_losing', dailyMinutes: 20 },
  });
  assert.equal(res.json().goal, 'stop_losing');
  assert.equal(res.json().dailyMinutes, 20);

  // A later save without them keeps what was given.
  await app.inject({
    method: 'PUT', url: '/api/v1/onboarding', headers: { host: NORTHGATE, ...asLearner(token) },
    payload: { selfRating: SELF_RATING },
  });
  const stored = await withControl(async (c) =>
    (await c.query<{ goal: string; daily_minutes: number }>('SELECT goal, daily_minutes FROM app.users WHERE id = $1', [userId])).rows[0]!);
  assert.deepEqual(stored, { goal: 'stop_losing', daily_minutes: 20 });
});

test('a lesson with an unmet prerequisite is refused with the lesson it needs, then opens once it is passed', async () => {
  const { token } = await placedLearner(app, NORTHGATE);
  const tape = `/api/v1/lessons/${lessonIds['reading-the-tape/1']}`;

  const locked = await get(NORTHGATE, token, tape);
  assert.equal(locked.statusCode, 403);
  assert.deepEqual(locked.json().error, { code: 'prerequisite_required', message: 'Requires: Orders and fills' });
  const draw = await app.inject({ method: 'POST', url: `${tape}/checks`, headers: { host: NORTHGATE, ...asLearner(token) } });
  assert.equal(draw.statusCode, 403, 'its check is locked with it');

  await pass(NORTHGATE, token, 'how-markets-work/2');
  assert.equal((await get(NORTHGATE, token, tape)).statusCode, 200);
});

test('the tier gate is reported before any prerequisite', async () => {
  const { token } = await placedLearner(app, NORTHGATE, { correctPerTier: {} });
  const res = await get(NORTHGATE, token, `/api/v1/lessons/${lessonIds['reading-the-tape/1']}`);
  assert.equal(res.json().error.code, 'tier_locked');
});

test('the pathway gives every lesson its state, reason, minutes, XP and requirements', async () => {
  const { token } = await placedLearner(app, NORTHGATE);
  let path = (await get(NORTHGATE, token, '/api/v1/pathway')).json<Pathway>();

  const first = lessonIn(path, 'how-markets-work/1');
  assert.equal(first.state, 'open');
  assert.equal(first.xp, 100);
  assert.ok(first.minutes >= 1);
  assert.equal(path.nextLessonId, lessonIds['how-markets-work/1'], 'the first open lesson in pathway order');

  const tape = lessonIn(path, 'reading-the-tape/1');
  assert.equal(tape.state, 'locked');
  assert.equal(tape.gateReason, 'Requires: Orders and fills');
  assert.deepEqual(tape.requires, [lessonIds['how-markets-work/2']]);
  assert.equal(path.tiers.find((t) => t.tier === 'learn')!.courses[0]!.certificate, null);

  await pass(NORTHGATE, token, 'how-markets-work/1');
  await pass(NORTHGATE, token, 'how-markets-work/2');
  path = (await get(NORTHGATE, token, '/api/v1/pathway')).json<Pathway>();
  assert.equal(lessonIn(path, 'how-markets-work/1').state, 'done');
  assert.equal(lessonIn(path, 'reading-the-tape/1').state, 'open');
  assert.equal(lessonIn(path, 'reading-the-tape/1').gateReason, null);
});

test('/me reports the learner, their placement, and XP counted once per verified lesson', async () => {
  const fresh = await signup(app, NORTHGATE, { ibRefCode: 'IB-9001' });
  const before = (await get(NORTHGATE, fresh.token, '/api/v1/me')).json();
  assert.equal(before.placement, null);
  assert.equal(before.user.ibRefCode, 'IB-9001');
  assert.equal(before.academy.name, 'Northgate Markets');
  assert.deepEqual(before.stats, { xp: 0, streakDays: 0, verifiedLessons: 0, totalLessons: 4 });

  const { token } = await placedLearner(app, NORTHGATE);
  await pass(NORTHGATE, token, 'how-markets-work/1');
  await pass(NORTHGATE, token, 'how-markets-work/1');
  const me = (await get(NORTHGATE, token, '/api/v1/me')).json();
  assert.equal(me.placement.level, 'learner');
  assert.equal(me.stats.xp, 100, 'a lesson passed twice is worth its XP once');
  assert.equal(me.stats.verifiedLessons, 1);
  assert.equal(me.stats.streakDays, 1);
  assert.deepEqual(me.tiers.find((t: { tier: string }) => t.tier === 'learn'), { tier: 'learn', verifiedLessons: 1, totalLessons: 3 });
  assert.equal(me.recent[0].title, 'What a market is');
  assert.deepEqual(me.certificates, []);
});

test('the streak counts consecutive days with a newly verified lesson, and breaks on a gap', async () => {
  const { token, userId } = await placedLearner(app, NORTHGATE);
  await pass(NORTHGATE, token, 'how-markets-work/1');
  await pass(NORTHGATE, token, 'how-markets-work/2');
  await pass(NORTHGATE, token, 'reading-the-tape/1');
  const backdate = (lessonKey: string, days: number) => withControl((c) => c.query(
    `UPDATE app.quiz_attempts SET submitted_at = now() - make_interval(days => $3) WHERE user_id = $1 AND lesson_id = $2`,
    [userId, lessonIds[lessonKey], days]));

  await backdate('how-markets-work/1', 2);
  await backdate('how-markets-work/2', 1);
  assert.equal((await get(NORTHGATE, token, '/api/v1/me')).json().stats.streakDays, 3);

  await backdate('how-markets-work/1', 3);
  assert.equal((await get(NORTHGATE, token, '/api/v1/me')).json().stats.streakDays, 2, 'a missed day starts a new streak');

  await backdate('reading-the-tape/1', 3);
  await backdate('how-markets-work/2', 2);
  assert.equal((await get(NORTHGATE, token, '/api/v1/me')).json().stats.streakDays, 0, 'nothing today or yesterday: no streak');
});

test("/me/events lists this learner's own events, newest first, and no one else's", async () => {
  const mine = await placedLearner(app, NORTHGATE, { ibRefCode: 'IB-4417' });
  const neighbour = await placedLearner(app, NORTHGATE);
  const elsewhere = await placedLearner(app, SABLE);
  await get(NORTHGATE, mine.token, `/api/v1/lessons/${lessonIds['how-markets-work/1']}`);

  const { events } = (await get(NORTHGATE, mine.token, '/api/v1/me/events')).json();
  assert.deepEqual(events.map((e: { type: string }) => e.type),
    ['lead.enrolled', 'learner.placed', 'learner.onboarded', 'lead.registered']);
  assert.equal(events[0].idempotencyKey.startsWith(`enrol:${mine.userId}:`), true);
  assert.equal(events[0].status, 'pending');
  assert.equal(events[0].payload.ib_ref_code, 'IB-4417');
  for (const e of events) assert.equal(e.payload.user_id, mine.userId, 'only this learner');

  const theirs = (await get(NORTHGATE, neighbour.token, '/api/v1/me/events')).json().events;
  assert.ok(theirs.every((e: { payload: { user_id: string } }) => e.payload.user_id === neighbour.userId));
  const away = (await get(SABLE, elsewhere.token, '/api/v1/me/events')).json().events;
  assert.ok(away.every((e: { payload: { user_id: string } }) => e.payload.user_id === elsewhere.userId));

  const write = await app.inject({ method: 'POST', url: '/api/v1/me/events', headers: { host: NORTHGATE, ...asLearner(mine.token) } });
  assert.equal(write.statusCode, 404, 'there is no way to write events from outside');
});

/**
 * Module 3 · pathway, lessons, knowledge checks and enrolment. What a
 * learner can see is decided by RLS and the academy's catalogue; what
 * they can open, by the published gates; and a passed check is the
 * North Star event, counted exactly once.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { shutdown, withControl } from '../src/db/unitOfWork.js';
import {
  NORTHGATE, SABLE, asLearner, onboard, outboxRows, placedLearner, removeHttpAccounts, server, signup,
  type Paper,
} from './httpHarness.js';

let app: FastifyInstance;
const lessonIds: Record<string, string> = {};
const courseIds: Record<string, string> = {};

before(async () => {
  await removeHttpAccounts();
  app = await server();
  await withControl(async (c) => {
    const rows = await c.query<{ slug: string; course_id: string; position: number; id: string }>(
      `SELECT c.slug, c.id AS course_id, l.position, l.id
         FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id`);
    for (const r of rows.rows) {
      lessonIds[`${r.slug}/${r.position}`] = r.id;
      courseIds[r.slug] = r.course_id;
    }
  });
});

after(async () => {
  await app.close();
  await removeHttpAccounts();
  await shutdown();
});

const get = (host: string, token: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { host, ...asLearner(token) } });

async function drawCheck(host: string, token: string, lessonKey: string) {
  return app.inject({
    method: 'POST', url: `/api/v1/lessons/${lessonIds[lessonKey]}/checks`, headers: { host, ...asLearner(token) },
  });
}

/** Seeded check questions are answered by 'a'; answer the first `right` correctly. */
function answersFor(paper: Paper, right: number): Record<string, string> {
  return Object.fromEntries(paper.questions.map((q, i) => [q.id, i < right ? 'a' : 'b']));
}

const northStarKey = (userId: string, lessonKey: string) => `check.passed:${userId}:${lessonIds[lessonKey]}`;

async function northStarCount(userId: string): Promise<number> {
  return withControl(async (c) => Number((await c.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM app.outbox_events
      WHERE event_type = 'progression.verified' AND payload->>'user_id' = $1`, [userId])).rows[0]!.n));
}

const submit = (host: string, token: string, attemptId: string, answers: Record<string, string>) =>
  app.inject({
    method: 'POST', url: `/api/v1/checks/${attemptId}/submission`, headers: { host, ...asLearner(token) },
    payload: { answers },
  });

interface PathwayBody {
  tiers: { tier: string; unlocked: boolean; courses: { slug: string; lessons: unknown[]; progressPct: number; state: string }[] }[];
}
const slugsOn = (body: PathwayBody) => body.tiers.flatMap((t) => t.courses.map((c) => c.slug)).sort();

test('the pathway waits for placement', async () => {
  const { token } = await signup(app, NORTHGATE);
  await onboard(app, NORTHGATE, token);
  const res = await get(NORTHGATE, token, '/api/v1/pathway');
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, 'placement_required');
});

test("the pathway shows this academy's catalogue and nothing private to another", async () => {
  const north = await placedLearner(app, NORTHGATE);
  const northPath = (await get(NORTHGATE, north.token, '/api/v1/pathway')).json<PathwayBody>();
  assert.deepEqual(slugsOn(northPath), ['how-markets-work', 'northgate-desk-rules', 'reading-the-tape'],
    'its own private course is there; the course it switched off is not');
  const markets = northPath.tiers.find((t) => t.tier === 'learn')!.courses.find((c) => c.slug === 'how-markets-work')!;
  assert.equal(markets.lessons.length, 2);

  const sable = await placedLearner(app, SABLE);
  const sablePath = (await get(SABLE, sable.token, '/api/v1/pathway')).json<PathwayBody>();
  assert.deepEqual(slugsOn(sablePath), ['how-markets-work'],
    "northgate's private course stays hidden even though sable's catalogue names it");
});

test('a lesson opens with its content and enrols the learner once, carrying the IB code', async () => {
  const { token, userId } = await placedLearner(app, NORTHGATE, { ibRefCode: 'IB-7781' });
  const res = await get(NORTHGATE, token, `/api/v1/lessons/${lessonIds['how-markets-work/1']}`);
  assert.equal(res.statusCode, 200);
  const lesson = res.json();
  assert.equal(lesson.title, 'What a market is');
  assert.equal(lesson.nextLessonId, lessonIds['how-markets-work/2']);
  assert.equal(lesson.tier, 'learn');
  assert.equal(lesson.courseTitle, 'How markets work');

  await get(NORTHGATE, token, `/api/v1/lessons/${lessonIds['how-markets-work/2']}`);

  const course = courseIds['how-markets-work']!;
  const enrolment = await withControl(async (c) =>
    (await c.query<{ ib_ref_code: string; source: string; state: string }>(
      'SELECT ib_ref_code, source, state FROM app.enrolments WHERE user_id = $1 AND course_id = $2', [userId, course])).rows);
  assert.equal(enrolment.length, 1);
  assert.equal(enrolment[0]!.ib_ref_code, 'IB-7781', 'the code held since signup lands on the enrolment');
  assert.equal(enrolment[0]!.source, 'introducing_broker');

  const events = await outboxRows(`enrol:${userId}:${course}`);
  assert.equal(events.length, 1, 'opening a second lesson in the course does not enrol again');
  assert.equal(events[0]!.event_type, 'lead.enrolled');
  assert.equal(events[0]!.payload.ib_ref_code, 'IB-7781');
});

test("another academy's private lesson is a 404, indistinguishable from none", async () => {
  const sable = await placedLearner(app, SABLE);
  const privateLesson = await withControl(async (c) =>
    (await c.query<{ id: string }>(
      `SELECT l.id FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id
        WHERE c.slug = 'northgate-desk-rules'`)).rows[0]!.id);
  const hidden = await get(SABLE, sable.token, `/api/v1/lessons/${privateLesson}`);
  const missing = await get(SABLE, sable.token, '/api/v1/lessons/00000000-0000-4000-8000-000000000000');
  assert.equal(hidden.statusCode, 404);
  assert.equal(hidden.body, missing.body);
});

test('a lesson switched off in the catalogue is a 404', async () => {
  const { token } = await placedLearner(app, NORTHGATE);
  const res = await get(NORTHGATE, token, `/api/v1/lessons/${lessonIds['risk-basics/1']}`);
  assert.equal(res.statusCode, 404);
});

test('a locked tier is a 403 carrying the published gate', async () => {
  // Everything skipped: Learn = 0 * 0.6 + 50 * 0.4 = 20, so Apply is shut.
  const { token } = await placedLearner(app, NORTHGATE, { correctPerTier: {} });
  const res = await get(NORTHGATE, token, `/api/v1/lessons/${lessonIds['reading-the-tape/1']}`);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json().error, { code: 'tier_locked', message: 'Unlocks at Learn 50 or above. You are at 20.' });
  const draw = await drawCheck(NORTHGATE, token, 'reading-the-tape/1');
  assert.equal(draw.statusCode, 403, 'the check is locked with its lesson');
});

test('a check paper is three questions with no answers, and an open paper is not redrawn', async () => {
  const { token } = await placedLearner(app, NORTHGATE);
  const first = await drawCheck(NORTHGATE, token, 'how-markets-work/1');
  assert.equal(first.statusCode, 201);
  const paper = first.json<Paper>();
  assert.equal(paper.questions.length, 3);
  for (const q of paper.questions) assert.deepEqual(Object.keys(q).sort(), ['id', 'options', 'prompt']);

  const again = await drawCheck(NORTHGATE, token, 'how-markets-work/1');
  assert.equal(again.statusCode, 200);
  assert.equal(again.json<Paper>().attemptId, paper.attemptId);
});

test('two of three passes, emits the North Star once and activates the learner once', async () => {
  const { token, userId } = await placedLearner(app, NORTHGATE);
  const paper = (await drawCheck(NORTHGATE, token, 'how-markets-work/1')).json<Paper>();
  const res = await submit(NORTHGATE, token, paper.attemptId, answersFor(paper, 2));
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.correct, 2);
  assert.equal(body.total, 3);
  assert.equal(body.passed, true);
  assert.equal(body.stars, 2);
  assert.equal(body.feedback[2].chosenKey, 'b');
  assert.equal(body.feedback[2].correctKey, 'a');
  assert.equal(body.feedback[2].rationale, 'That confuses the two sides.');

  const verified = await outboxRows(northStarKey(userId, 'how-markets-work/1'));
  assert.equal(verified.length, 1);
  assert.equal(verified[0]!.event_type, 'progression.verified');
  assert.equal((await outboxRows(`activated:${userId}`)).length, 1);

  const replay = await submit(NORTHGATE, token, paper.attemptId, answersFor(paper, 3));
  assert.deepEqual(replay.json(), body, 'the first grading stands');
  assert.equal((await outboxRows(northStarKey(userId, 'how-markets-work/1'))).length, 1);

  // A second pass is another North Star event, but not another activation.
  const second = (await drawCheck(NORTHGATE, token, 'how-markets-work/2')).json<Paper>();
  await submit(NORTHGATE, token, second.attemptId, answersFor(second, 3));
  assert.equal((await outboxRows(northStarKey(userId, 'how-markets-work/2'))).length, 1);
  assert.equal((await outboxRows(`activated:${userId}`)).length, 1);

  const lifecycle = await withControl(async (c) =>
    (await c.query<{ lifecycle: string }>('SELECT lifecycle FROM app.users WHERE id = $1', [userId])).rows[0]!.lifecycle);
  assert.equal(lifecycle, 'certified', 'activated on the first pass, certified when the course completed');

  const path = (await get(NORTHGATE, token, '/api/v1/pathway')).json<PathwayBody>();
  const markets = path.tiers.find((t) => t.tier === 'learn')!.courses.find((c) => c.slug === 'how-markets-work')!;
  assert.equal(markets.progressPct, 100, 'both lessons have a passed check');
  assert.equal(markets.state, 'completed');
});

test('a retake of a passed lesson still grades, but cannot emit a second North Star', async () => {
  const { token, userId } = await placedLearner(app, NORTHGATE);
  const first = (await drawCheck(NORTHGATE, token, 'how-markets-work/1')).json<Paper>();
  assert.equal((await submit(NORTHGATE, token, first.attemptId, answersFor(first, 2))).json().passed, true);

  const draw = await drawCheck(NORTHGATE, token, 'how-markets-work/1');
  assert.equal(draw.statusCode, 201, 'a submitted paper is closed, so a retake is a fresh paper');
  const retake = draw.json<Paper>();
  assert.notEqual(retake.attemptId, first.attemptId);

  const res = await submit(NORTHGATE, token, retake.attemptId, answersFor(retake, 3));
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.passed, true);
  assert.equal(body.stars, 3);
  assert.equal(body.feedback.length, 3, 'the retake is graded with full feedback');

  const events = await outboxRows(northStarKey(userId, 'how-markets-work/1'));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.payload.attempt_id, first.attemptId, 'the event is the first pass');
  assert.equal(await northStarCount(userId), 1, 'one lesson, one North Star event, however often it is passed');
});

test('a lesson failed first and passed on a retake emits the North Star once, on the pass', async () => {
  const { token, userId } = await placedLearner(app, NORTHGATE);
  const failed = (await drawCheck(NORTHGATE, token, 'how-markets-work/1')).json<Paper>();
  await submit(NORTHGATE, token, failed.attemptId, answersFor(failed, 0));
  assert.equal(await northStarCount(userId), 0);

  const retake = (await drawCheck(NORTHGATE, token, 'how-markets-work/1')).json<Paper>();
  await submit(NORTHGATE, token, retake.attemptId, answersFor(retake, 2));
  const events = await outboxRows(northStarKey(userId, 'how-markets-work/1'));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.payload.attempt_id, retake.attemptId);
});

test('a replayed submission returns the stored grade, not a regrade', async () => {
  const { token } = await placedLearner(app, NORTHGATE);
  const paper = (await drawCheck(NORTHGATE, token, 'how-markets-work/1')).json<Paper>();
  const first = (await submit(NORTHGATE, token, paper.attemptId, answersFor(paper, 2))).json();
  assert.equal(first.correct, 2);

  // Change the answer key after the fact. A regrade would now score 1/3.
  const changed = paper.questions[0]!.id;
  await withControl((c) => c.query(`UPDATE platform.questions SET correct_key = 'b' WHERE id = $1`, [changed]));
  try {
    const replay = (await submit(NORTHGATE, token, paper.attemptId, answersFor(paper, 2))).json();
    assert.equal(replay.correct, 2, 'correct_count as stored');
    assert.equal(replay.passed, true, 'passed as stored');
    assert.equal(replay.stars, 2, 'stars as stored');
    assert.equal(replay.total, 3);
  } finally {
    await withControl((c) => c.query(`UPDATE platform.questions SET correct_key = 'a' WHERE id = $1`, [changed]));
  }
});

test('progress counts the lessons recorded on passed attempts, not how questions are tagged', async () => {
  const { token } = await placedLearner(app, NORTHGATE);
  const lessonTwo = (await drawCheck(NORTHGATE, token, 'how-markets-work/2')).json<Paper>();
  await submit(NORTHGATE, token, lessonTwo.attemptId, answersFor(lessonTwo, 3));

  // A lesson-1 paper whose questions are re-tagged to lesson 2 before it
  // is submitted. By tags it would add nothing; by attempt it is lesson 1.
  const lessonOne = (await drawCheck(NORTHGATE, token, 'how-markets-work/1')).json<Paper>();
  const ids = lessonOne.questions.map((q) => q.id);
  await withControl((c) => c.query('UPDATE platform.questions SET lesson_id = $2 WHERE id = ANY($1::uuid[])',
    [ids, lessonIds['how-markets-work/2']]));
  try {
    await submit(NORTHGATE, token, lessonOne.attemptId, answersFor(lessonOne, 3));
  } finally {
    await withControl((c) => c.query('UPDATE platform.questions SET lesson_id = $2 WHERE id = ANY($1::uuid[])',
      [ids, lessonIds['how-markets-work/1']]));
  }

  const path = (await get(NORTHGATE, token, '/api/v1/pathway')).json<PathwayBody>();
  const markets = path.tiers.find((t) => t.tier === 'learn')!.courses.find((c) => c.slug === 'how-markets-work')!;
  assert.equal(markets.progressPct, 100, 'both lessons passed, whatever the questions now say');
});

test('one of three fails and emits nothing', async () => {
  const { token, userId } = await placedLearner(app, NORTHGATE);
  const paper = (await drawCheck(NORTHGATE, token, 'how-markets-work/1')).json<Paper>();
  const res = await submit(NORTHGATE, token, paper.attemptId, answersFor(paper, 1));
  assert.equal(res.json().passed, false);
  assert.equal(res.json().stars, 1);
  assert.equal((await outboxRows(northStarKey(userId, 'how-markets-work/1'))).length, 0);
  assert.equal((await outboxRows(`activated:${userId}`)).length, 0);
});

test("answers must belong to the paper, and the paper to the learner", async () => {
  const owner = await placedLearner(app, NORTHGATE);
  const paper = (await drawCheck(NORTHGATE, owner.token, 'how-markets-work/1')).json<Paper>();
  const foreign = await submit(NORTHGATE, owner.token, paper.attemptId, { '00000000-0000-4000-8000-000000000000': 'a' });
  assert.equal(foreign.statusCode, 422);

  const other = await placedLearner(app, NORTHGATE);
  assert.equal((await submit(NORTHGATE, other.token, paper.attemptId, {})).statusCode, 404);

  const sable = await placedLearner(app, SABLE);
  assert.equal((await submit(SABLE, sable.token, paper.attemptId, {})).statusCode, 404,
    "another academy's attempt does not exist under RLS");
});

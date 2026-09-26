/**
 * Module 3 · one open paper at a time. Concurrent draws must converge on
 * a single open placement paper per learner and a single open check
 * paper per learner per lesson, enforced by the database, not by timing.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { shutdown, withControl } from '../src/db/unitOfWork.js';
import { NORTHGATE, asLearner, onboard, placedLearner, removeHttpAccounts, server, signup } from './httpHarness.js';

let app: FastifyInstance;
let lessonId = '';

before(async () => {
  await removeHttpAccounts();
  app = await server();
  lessonId = await withControl(async (c) =>
    (await c.query<{ id: string }>(
      `SELECT l.id FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id
        WHERE c.slug = 'how-markets-work' AND l.position = 1`)).rows[0]!.id);
});

after(async () => {
  await app.close();
  await removeHttpAccounts();
  await shutdown();
});

async function openPapers(userId: string, kind: string) {
  return withControl(async (c) =>
    (await c.query<{ id: string; lesson_id: string | null }>(
      `SELECT id, lesson_id FROM app.quiz_attempts WHERE user_id = $1 AND kind = $2 AND submitted_at IS NULL`,
      [userId, kind])).rows);
}

test('concurrent placement draws converge on one open paper', async () => {
  const { token, userId } = await signup(app, NORTHGATE);
  await onboard(app, NORTHGATE, token);
  const draws = await Promise.all(Array.from({ length: 6 }, () =>
    app.inject({ method: 'POST', url: '/api/v1/placement', headers: { host: NORTHGATE, ...asLearner(token) } })));

  for (const d of draws) assert.ok(d.statusCode === 200 || d.statusCode === 201, d.body);
  assert.equal(new Set(draws.map((d) => d.json().attemptId)).size, 1, 'every caller gets the same paper');
  assert.equal(draws.filter((d) => d.statusCode === 201).length, 1, 'exactly one draw created it');
  assert.equal((await openPapers(userId, 'placement')).length, 1);
});

test('concurrent check draws for one lesson converge on one open paper, recording the lesson', async () => {
  const { token, userId } = await placedLearner(app, NORTHGATE);
  const draws = await Promise.all(Array.from({ length: 6 }, () =>
    app.inject({ method: 'POST', url: `/api/v1/lessons/${lessonId}/checks`, headers: { host: NORTHGATE, ...asLearner(token) } })));

  for (const d of draws) assert.ok(d.statusCode === 200 || d.statusCode === 201, d.body);
  assert.equal(new Set(draws.map((d) => d.json().attemptId)).size, 1, 'every caller gets the same paper');
  const open = await openPapers(userId, 'knowledge_check');
  assert.equal(open.length, 1);
  assert.equal(open[0]!.lesson_id, lessonId, 'the paper records the lesson it was drawn for');
});

test('the database refuses a second open paper even if a handler tried', async () => {
  const { token, userId } = await placedLearner(app, NORTHGATE);
  await app.inject({ method: 'POST', url: `/api/v1/lessons/${lessonId}/checks`, headers: { host: NORTHGATE, ...asLearner(token) } });
  await assert.rejects(
    withControl((c) => c.query(
      `INSERT INTO app.quiz_attempts (tenant_id, user_id, course_id, lesson_id, kind, question_ids)
       SELECT tenant_id, user_id, course_id, lesson_id, kind, question_ids
         FROM app.quiz_attempts WHERE user_id = $1 AND kind = 'knowledge_check'`, [userId])),
    /uq_attempts_open_check/,
  );
});

/**
 * Demo wiring · stage 2. Completing a course issues its certificate in
 * the same transaction, once; failing a lesson's check twice flags the
 * learner, once. And the whole journey, sign-up to a publicly verified
 * certificate, through the API alone.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { shutdown, withControl } from '../src/db/unitOfWork.js';
import { SERIAL_PATTERN } from '../src/domain/serial.js';
import {
  NORTHGATE, PASSWORD, asLearner, outboxRows, placedLearner, removeHttpAccounts, server, sessionToken, uniqueEmail,
  type Paper,
} from './httpHarness.js';

let app: FastifyInstance;
const lessonIds: Record<string, string> = {};
let courseId = '';

before(async () => {
  await removeHttpAccounts();
  app = await server();
  await withControl(async (c) => {
    const rows = await c.query<{ slug: string; position: number; id: string; course_id: string }>(
      `SELECT c.slug, l.position, l.id, c.id AS course_id FROM platform.lessons l JOIN platform.courses c ON c.id = l.course_id`);
    for (const r of rows.rows) {
      lessonIds[`${r.slug}/${r.position}`] = r.id;
      if (r.slug === 'how-markets-work') courseId = r.course_id;
    }
  });
});

after(async () => {
  await app.close();
  await removeHttpAccounts();
  await shutdown();
});

/** Seeded check questions are answered by 'a'. */
async function attempt(token: string, lessonKey: string, right: number) {
  const paper = (await app.inject({
    method: 'POST', url: `/api/v1/lessons/${lessonIds[lessonKey]}/checks`, headers: { host: NORTHGATE, ...asLearner(token) },
  })).json<Paper>();
  const res = await app.inject({
    method: 'POST', url: `/api/v1/checks/${paper.attemptId}/submission`, headers: { host: NORTHGATE, ...asLearner(token) },
    payload: { answers: Object.fromEntries(paper.questions.map((q, i) => [q.id, i < right ? 'a' : 'b'])) },
  });
  return res.json();
}

async function certificatesOf(userId: string) {
  return withControl(async (c) =>
    (await c.query<{ serial: string; holder_name: string; course_title: string }>(
      'SELECT serial, holder_name, course_title FROM app.certificates WHERE user_id = $1', [userId])).rows);
}

test('completing a course issues one certificate, with its event, in the same transaction', async () => {
  const { token, userId } = await placedLearner(app, NORTHGATE);
  const first = await attempt(token, 'how-markets-work/1', 3);
  assert.equal(first.certificate, null, 'half a course earns nothing');

  const second = await attempt(token, 'how-markets-work/2', 2);
  assert.match(second.certificate.serial, SERIAL_PATTERN);
  assert.equal(second.certificate.courseTitle, 'How markets work');

  const held = await certificatesOf(userId);
  assert.equal(held.length, 1);
  assert.equal(held[0]!.serial, second.certificate.serial);
  assert.equal(held[0]!.holder_name, 'Test Learner');

  const events = await outboxRows(`cert:${userId}:${courseId}`);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event_type, 'certificate.issued');
  assert.equal(events[0]!.payload.serial, second.certificate.serial);

  const lifecycle = await withControl(async (c) =>
    (await c.query<{ lifecycle: string }>('SELECT lifecycle FROM app.users WHERE id = $1', [userId])).rows[0]!.lifecycle);
  assert.equal(lifecycle, 'certified');

  const retake = await attempt(token, 'how-markets-work/1', 3);
  assert.equal(retake.passed, true);
  assert.equal(retake.certificate, null, 'a completed course is not certified again');
  assert.equal((await certificatesOf(userId)).length, 1);
  assert.equal((await outboxRows(`cert:${userId}:${courseId}`)).length, 1);
});

test('failing the same lesson twice flags the learner once, with the lesson and attempt count', async () => {
  const { token, userId } = await placedLearner(app, NORTHGATE);
  const key = `churn:${userId}:${lessonIds['how-markets-work/1']}`;

  await attempt(token, 'how-markets-work/1', 1);
  assert.equal((await outboxRows(key)).length, 0, 'one failure is not a pattern');

  await attempt(token, 'how-markets-work/1', 0);
  const flagged = await outboxRows(key);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0]!.event_type, 'churn_risk.flagged');
  assert.equal(flagged[0]!.payload.lesson_id, lessonIds['how-markets-work/1']);
  assert.equal(flagged[0]!.payload.failed_attempts, 2);
  assert.equal(flagged[0]!.payload.attempts, 2);

  await attempt(token, 'how-markets-work/1', 1);
  assert.equal((await outboxRows(key)).length, 1, 'a third failure does not flag again');

  await attempt(token, 'how-markets-work/2', 0);
  assert.equal((await outboxRows(`churn:${userId}:${lessonIds['how-markets-work/2']}`)).length, 0,
    'failures are counted per lesson');
});

test('sign-up to a publicly verified certificate, through the API alone', async () => {
  const host = { host: NORTHGATE };
  const signup = await app.inject({
    method: 'POST', url: '/api/v1/auth/signup', headers: host,
    payload: { email: uniqueEmail('journey'), password: PASSWORD, displayName: 'Journey Learner', ibRefCode: 'IB-4417' },
  });
  assert.equal(signup.statusCode, 201);
  const auth = { ...host, ...asLearner(sessionToken(signup)!) };

  const onboarded = await app.inject({
    method: 'PUT', url: '/api/v1/onboarding', headers: auth,
    payload: { selfRating: { learn: 60, safeguard: 40, apply: 20, specialise: 0 }, goal: 'new', dailyMinutes: 10 },
  });
  assert.equal(onboarded.statusCode, 200);

  const placement = (await app.inject({ method: 'POST', url: '/api/v1/placement', headers: auth })).json<Paper>();
  const placed = await app.inject({
    method: 'POST', url: `/api/v1/placement/${placement.attemptId}/submission`, headers: auth,
    payload: { answers: Object.fromEntries(placement.questions.map((q) => [q.id, 'a'])) },
  });
  assert.equal(placed.statusCode, 200);

  let path = (await app.inject({ method: 'GET', url: '/api/v1/pathway', headers: auth })).json();
  let certificate: { serial: string } | null = null;
  // Follow the server's own "next lesson" until the course is certified.
  for (let step = 0; step < 5 && !certificate; step++) {
    const lessonId: string = path.nextLessonId;
    assert.ok(lessonId, 'the pathway always names what is next');
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/lessons/${lessonId}`, headers: auth })).statusCode, 200);
    const paper = (await app.inject({ method: 'POST', url: `/api/v1/lessons/${lessonId}/checks`, headers: auth })).json<Paper>();
    const result = (await app.inject({
      method: 'POST', url: `/api/v1/checks/${paper.attemptId}/submission`, headers: auth,
      payload: { answers: Object.fromEntries(paper.questions.map((q) => [q.id, 'a'])) },
    })).json();
    assert.equal(result.passed, true);
    certificate = result.certificate;
    path = (await app.inject({ method: 'GET', url: '/api/v1/pathway', headers: auth })).json();
  }
  assert.ok(certificate, 'the course was completed and certified');

  const me = (await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth })).json();
  assert.equal(me.user.lifecycle, 'certified');
  assert.equal(me.certificates[0].serial, certificate.serial);

  const verified = await app.inject({ method: 'GET', url: `/api/v1/certificates/${certificate.serial}`, headers: { host: 'anyone.example' } });
  assert.equal(verified.statusCode, 200);
  assert.deepEqual(verified.json().holderName, 'Journey Learner');

  const types = (await app.inject({ method: 'GET', url: '/api/v1/me/events', headers: auth })).json()
    .events.map((e: { type: string }) => e.type);
  for (const expected of ['lead.registered', 'learner.onboarded', 'learner.placed', 'lead.enrolled',
    'progression.verified', 'learner.activated', 'certificate.issued']) {
    assert.ok(types.includes(expected), `${expected} is in the learner's events`);
  }
});

test('a check can be answered one question at a time; each answer stands, and the submission must match', async () => {
  const learner = await placedLearner(app, NORTHGATE);
  const headers = { host: NORTHGATE, ...asLearner(learner.token) };
  const paper = (await app.inject({ method: 'POST', url: `/api/v1/lessons/${lessonIds['how-markets-work/1']}/checks`, headers })).json<Paper>();
  const [q1, q2, q3] = paper.questions;
  const answer = (questionId: string, key: string) =>
    app.inject({ method: 'POST', url: `/api/v1/checks/${paper.attemptId}/answers`, headers, payload: { questionId, key } });

  const right = await answer(q1!.id, 'a');
  assert.equal(right.statusCode, 200, right.body);
  assert.equal(right.json().correct, true);
  assert.ok(right.json().rationale.length > 0);
  const wrong = await answer(q2!.id, 'b');
  assert.deepEqual([wrong.json().correct, wrong.json().correctKey], [false, 'a']);
  assert.equal((await answer(q2!.id, 'b')).statusCode, 200, 'the same answer again is fine');
  assert.equal((await answer(q2!.id, 'a')).json().error.code, 'already_answered', 'but it cannot be changed');
  assert.equal((await answer(q1!.id, 'z')).statusCode, 422);

  const submit = (answers: Record<string, string>) =>
    app.inject({ method: 'POST', url: `/api/v1/checks/${paper.attemptId}/submission`, headers, payload: { answers } });
  assert.equal((await submit({ [q1!.id]: 'a', [q2!.id]: 'a', [q3!.id]: 'a' })).json().error.code, 'answer_changed');
  const graded = await submit({ [q1!.id]: 'a', [q2!.id]: 'b', [q3!.id]: 'a' });
  assert.equal(graded.statusCode, 200, graded.body);
  assert.deepEqual([graded.json().correct, graded.json().passed], [2, true]);

  const week = (await app.inject({ method: 'GET', url: '/api/v1/me', headers })).json().week as { date: string; learned: boolean }[];
  assert.equal(week.length, 7);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(week.find((d) => d.date === today)?.learned, true, 'today counts as a day learned');
  assert.equal(new Date(`${week[0]!.date}T00:00:00Z`).getUTCDay(), 1, 'the week starts on Monday');
});

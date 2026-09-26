/**
 * Module 4a · stage 3: the content workflow, through the studio and the
 * console. Drafts stay invisible to learners until three things have
 * happened in order: submitted, approved, published, by the right people.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { shutdown, withControl } from '../src/db/unitOfWork.js';
import { stepOf, totpAt } from '../src/auth/totp.js';
import {
  CONSOLE, NORTHGATE, PASSWORD, SABLE, asLearner, asStaff, asStudio, ownerPool, placedLearner, removeConsoleFixtures,
  removeContentFixtures, removeHttpAccounts, server, staffMember, studioLogin, studioMember,
} from './httpHarness.js';

let app: FastifyInstance;
let n = 0;
const title = (what: string) => `http-${what}-${process.pid}-${++n}`;

interface Team { author: string; reviewer: string; compliance: string; everything: string; everythingId: string; admin: string }
let team: Team;

before(async () => {
  await removeHttpAccounts();
  await removeContentFixtures();
  app = await server();
  const login = async (roles: string[]) => {
    const m = await studioMember('northgate', roles);
    return { id: m.id, token: (await studioLogin(app, NORTHGATE, m.email)).token! };
  };
  const all = await login(['author', 'reviewer', 'compliance']);
  team = {
    author: (await login(['author'])).token, reviewer: (await login(['reviewer'])).token,
    compliance: (await login(['compliance'])).token, everything: all.token, everythingId: all.id,
    admin: (await login(['tenant_admin'])).token,
  };
});

after(async () => {
  await app.close();
  await withControl((c) => c.query(`DELETE FROM app.tenant_settings WHERE tenant_id = (SELECT id FROM app.tenants WHERE slug = 'northgate')`));
  await removeHttpAccounts();
  await removeContentFixtures();
  await removeConsoleFixtures();
  await ownerPool.end();
  await shutdown();
});

const studio = (method: string, url: string, token: string, payload?: Record<string, unknown>, host = NORTHGATE) =>
  app.inject({ method: method as 'GET', url: `/api/studio${url}`, headers: { host, ...asStudio(token) }, ...(payload ? { payload } : {}) });

const question = (prompt: string) => ({
  prompt,
  options: [{ key: 'a', text: 'Right' }, { key: 'b', text: 'Wrong' }, { key: 'c', text: 'Also wrong' }],
  correctKey: 'a',
  rationales: { a: 'That is the definition.', b: 'That confuses the two sides.', c: 'That is a different idea.' },
});

const lessonBody = (lessonTitle: string, position = 1, extra: Record<string, unknown> = {}) => ({
  position, title: lessonTitle, minutes: 8, xp: 90,
  bodyMd: '## What it is\nA plain explanation.\n\n## Why it matters\nBecause it does.\n\n> **In practice**\n> Write it down first.',
  transcript: [{ at: '0:00', text: 'An introduction.' }],
  questions: [question('Q1'), question('Q2'), question('Q3'), question('Q4'), question('Q5')],
  ...extra,
});

const courseBody = (courseTitle: string) => ({ title: courseTitle, summary: 'A private course for testing.', tier: 'learn', estMinutes: 20 });

/** Submit, approve and publish a version with three different people. */
async function throughReview(versionId: string, publisher = team.compliance) {
  for (const [action, who] of [['submit', team.author], ['approve', team.reviewer], ['publish', publisher]] as const) {
    const res = await studio('POST', `/versions/${versionId}/${action}`, who);
    assert.equal(res.statusCode, 200, `${action}: ${res.body}`);
  }
}

async function newCourse() {
  const res = await studio('POST', '/courses', team.author, courseBody(title('course')));
  assert.equal(res.statusCode, 201, res.body);
  return res.json().version as { id: string; entityId: string };
}

async function newLesson(courseId: string, lessonTitle = title('lesson'), position = 1, extra: Record<string, unknown> = {}) {
  const res = await studio('POST', `/courses/${courseId}/lessons`, team.author, lessonBody(lessonTitle, position, extra));
  assert.equal(res.statusCode, 201, res.body);
  return res.json().version as { id: string; entityId: string; snapshot: { questions: { id: string }[] } };
}

async function auditOf(entityId: string): Promise<string[]> {
  return withControl(async (c) =>
    (await c.query<{ action: string }>('SELECT action FROM app.system_audit_log WHERE entity_id = $1 ORDER BY seq', [entityId])).rows.map((r) => r.action));
}

async function enableForNorthgate(courseId: string) {
  await withControl((c) => c.query(
    `INSERT INTO app.tenant_catalogues (tenant_id, course_id, enabled, position)
     SELECT id, $1, true, 50 FROM app.tenants WHERE slug = 'northgate' ON CONFLICT DO NOTHING`, [courseId]));
}

test('drafts are invisible to learners until course and lesson are both published', async () => {
  const course = await newCourse();
  const lesson = await newLesson(course.entityId);
  await enableForNorthgate(course.entityId);
  const learner = await placedLearner(app, NORTHGATE);
  const pathway = async () => (await app.inject({ method: 'GET', url: '/api/v1/pathway', headers: { host: NORTHGATE, ...asLearner(learner.token) } })).json();
  const titles = (p: { tiers: { courses: { id: string; lessons: { title: string }[] }[] }[] }) =>
    p.tiers.flatMap((t) => t.courses).filter((c) => c.id === course.entityId).flatMap((c) => c.lessons.map((l) => l.title));

  assert.equal((await pathway()).tiers.flatMap((t: { courses: { id: string }[] }) => t.courses).some((c: { id: string }) => c.id === course.entityId), false,
    'a draft course is not on anyone\'s path');

  await throughReview(course.id);
  assert.deepEqual(titles(await pathway()), [], 'the course is live, its lesson is still a draft');

  await throughReview(lesson.id);
  const [lessonTitle] = titles(await pathway());
  assert.ok(lessonTitle?.startsWith('http-lesson'), 'now the lesson is live');

  const live = await app.inject({ method: 'GET', url: `/api/v1/lessons/${lesson.entityId}`, headers: { host: NORTHGATE, ...asLearner(learner.token) } });
  assert.equal(live.statusCode, 200);
  assert.equal(live.json().authorName, 'Studio Member', 'the author is the person who sent it for review');
  assert.equal(live.json().reviewerName, 'Studio Member');
  assert.ok(live.json().reviewedAt);
  assert.deepEqual(await auditOf(lesson.entityId), ['content.created', 'content.submit', 'content.approve', 'content.publish']);
});

test('four check questions are not enough: a lesson needs five, so each paper is a different draw', async () => {
  const course = await newCourse();
  const four = await newLesson(course.entityId, title('four'), 1, { questions: [question('Q1'), question('Q2'), question('Q3'), question('Q4')] });
  const refused = await studio('POST', `/versions/${four.id}/submit`, team.author);
  assert.equal(refused.statusCode, 422);
  assert.deepEqual(refused.json().error.problems,
    ['A lesson needs at least 5 check questions, so each knowledge check is a different draw of 3. It has 4.']);
  await studio('PUT', `/lessons/${four.entityId}/draft`, team.author, lessonBody(title('four'), 1));
  assert.equal((await studio('POST', `/versions/${four.id}/submit`, team.author)).statusCode, 200, 'with five it goes');
});

test('a draft must be ready before review, and is frozen once sent', async () => {
  const course = await newCourse();
  const lesson = await newLesson(course.entityId, title('lesson'), 1, { questions: [question('Only one')], bodyMd: 'No steps here.' });
  const refused = await studio('POST', `/versions/${lesson.id}/submit`, team.author);
  assert.equal(refused.statusCode, 422);
  assert.equal(refused.json().error.code, 'not_ready');
  const problems: string[] = refused.json().error.problems;
  assert.ok(problems.some((p) => p.includes('at least one step')));
  assert.ok(problems.some((p) => p === 'A lesson needs at least 5 check questions, so each knowledge check is a different draw of 3. It has 1.'));

  const edited = await studio('PUT', `/lessons/${lesson.entityId}/draft`, team.author, lessonBody('http-fixed-lesson'));
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal((await studio('POST', `/versions/${lesson.id}/submit`, team.author)).statusCode, 200);
  const frozen = await studio('PUT', `/lessons/${lesson.entityId}/draft`, team.author, lessonBody('http-sneaky'));
  assert.equal(frozen.statusCode, 409);
  assert.equal(frozen.json().error.code, 'in_review');
});

test('each step belongs to its role', async () => {
  const course = await newCourse();
  assert.equal((await studio('POST', '/courses', team.reviewer, courseBody(title('x')))).statusCode, 403, 'only authors create');
  assert.equal((await studio('POST', '/courses', team.admin, courseBody(title('x')))).statusCode, 403, 'an admin alone is not an author');
  assert.equal((await studio('POST', `/versions/${course.id}/submit`, team.author)).statusCode, 200);
  assert.equal((await studio('POST', `/versions/${course.id}/approve`, team.author)).json().error.code, 'wrong_role');
  assert.equal((await studio('POST', `/versions/${course.id}/approve`, team.reviewer)).statusCode, 200);
  assert.equal((await studio('POST', `/versions/${course.id}/publish`, team.reviewer)).json().error.code, 'wrong_role');
  assert.equal((await studio('POST', `/versions/${course.id}/publish`, team.compliance)).statusCode, 200);
});

test('sending back needs notes; the rejected version stays; revising opens the next draft', async () => {
  const course = await newCourse();
  await studio('POST', `/versions/${course.id}/submit`, team.author);
  const noNotes = await studio('POST', `/versions/${course.id}/reject`, team.reviewer, { notes: '  ' });
  assert.equal(noNotes.statusCode, 400);
  assert.equal(noNotes.json().error.code, 'notes_required');
  const rejected = await studio('POST', `/versions/${course.id}/reject`, team.reviewer, { notes: 'The summary is too vague.' });
  assert.equal(rejected.json().version.state, 'rejected');
  assert.equal(rejected.json().version.rejectionNotes, 'The summary is too vague.');

  const revised = await studio('POST', `/versions/${course.id}/revise`, team.author);
  assert.equal(revised.statusCode, 201);
  assert.equal(revised.json().version.number, 2);
  assert.equal(revised.json().version.state, 'draft');
  const history = (await studio('GET', `/entities/course/${course.entityId}/versions`, team.reviewer)).json().versions;
  assert.deepEqual(history.map((v: { number: number; state: string }) => [v.number, v.state]), [[2, 'draft'], [1, 'rejected']]);
  assert.deepEqual(await auditOf(course.entityId), ['content.created', 'content.submit', 'content.reject', 'content.revise']);
});

test('a revision replaces the live content only when published, retiring the version before it', async () => {
  const course = await newCourse();
  await throughReview(course.id);
  const lesson = await newLesson(course.entityId, 'http-first-title');
  await throughReview(lesson.id);

  const v2 = (await studio('POST', `/versions/${lesson.id}/revise`, team.author)).json().version;
  await studio('PUT', `/lessons/${lesson.entityId}/draft`, team.author, lessonBody('http-second-title'));
  const liveTitle = async () => (await ownerPool.query('SELECT title FROM platform.lessons WHERE id = $1', [lesson.entityId])).rows[0].title;
  assert.equal(await liveTitle(), 'http-first-title', 'the draft changes nothing live');

  const view = (await studio('GET', `/versions/${v2.id}`, team.reviewer)).json();
  assert.ok(view.changedFields.includes('title'), 'the reviewer sees what changed');

  await throughReview(v2.id);
  assert.equal(await liveTitle(), 'http-second-title');
  const states = (await studio('GET', `/entities/lesson/${lesson.entityId}/versions`, team.author)).json().versions
    .map((v: { number: number; state: string }) => [v.number, v.state]);
  assert.deepEqual(states, [[2, 'published'], [1, 'retired']]);
});

test('the author never publishes their own work; at three, never approves it either', async () => {
  const course = await studio('POST', '/courses', team.everything, courseBody(title('own')));
  const id = course.json().version.id;
  await studio('POST', `/versions/${id}/submit`, team.everything);
  const approve = await studio('GET', `/versions/${id}`, team.everything);
  assert.deepEqual(approve.json().actions, ['approve', 'reject'], 'at two, holding every role, they may approve their own');
  assert.equal((await studio('POST', `/versions/${id}/approve`, team.everything)).statusCode, 200);
  assert.deepEqual((await studio('GET', `/versions/${id}`, team.everything)).json().actions, ['reject'], 'but publishing is not offered');
  const publishOwn = await studio('POST', `/versions/${id}/publish`, team.everything);
  assert.equal(publishOwn.statusCode, 409);
  assert.equal(publishOwn.json().error.code, 'separation');
  assert.equal((await studio('POST', `/versions/${id}/publish`, team.compliance)).statusCode, 200, 'someone else publishes it');

  await withControl((c) => c.query(
    `INSERT INTO app.tenant_settings (tenant_id, review_signoffs) SELECT id, 3 FROM app.tenants WHERE slug = 'northgate'
     ON CONFLICT (tenant_id) DO UPDATE SET review_signoffs = 3`));
  try {
    const three = (await studio('POST', '/courses', team.everything, courseBody(title('three')))).json().version.id;
    await studio('POST', `/versions/${three}/submit`, team.everything);
    const refused = await studio('POST', `/versions/${three}/approve`, team.everything);
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error.code, 'separation');
    assert.equal((await studio('POST', `/versions/${three}/approve`, team.reviewer)).statusCode, 200);
    assert.equal((await studio('POST', `/versions/${three}/publish`, team.compliance)).statusCode, 200, 'three people');
  } finally {
    await withControl((c) => c.query(`DELETE FROM app.tenant_settings WHERE tenant_id = (SELECT id FROM app.tenants WHERE slug = 'northgate')`));
  }
});

test('the queue shows each person what waits for them', async () => {
  const course = await newCourse();
  await studio('POST', `/versions/${course.id}/submit`, team.author);
  const reviewerQueue = (await studio('GET', '/review/queue', team.reviewer)).json().items;
  assert.ok(reviewerQueue.some((i: { versionId: string; state: string }) => i.versionId === course.id && i.state === 'in_expert_review'));
  assert.equal((await studio('GET', '/review/queue', team.compliance)).json().items.some((i: { versionId: string }) => i.versionId === course.id), false);
  await studio('POST', `/versions/${course.id}/approve`, team.reviewer);
  assert.ok((await studio('GET', '/review/queue', team.compliance)).json().items.some((i: { versionId: string }) => i.versionId === course.id));
  assert.deepEqual((await studio('GET', '/review/queue', team.author)).json().items, [], 'an author reviews nothing');
});

test('platform courses are read-only in an academy studio, and another academy sees nothing', async () => {
  const platform = await ownerPool.query(`SELECT id FROM platform.courses WHERE slug = 'how-markets-work'`);
  const platformId = platform.rows[0].id;
  const listed = (await studio('GET', '/courses', team.author)).json().courses;
  assert.equal(listed.find((c: { id: string }) => c.id === platformId)?.readOnly, true);
  const add = await studio('POST', `/courses/${platformId}/lessons`, team.author, lessonBody(title('smuggled')));
  assert.equal(add.statusCode, 403);
  assert.equal(add.json().error.code, 'read_only');

  const course = await newCourse();
  const sable = await studioMember('sable', ['author', 'reviewer', 'compliance']);
  const { token } = await studioLogin(app, SABLE, sable.email);
  assert.equal((await studio('GET', `/versions/${course.id}`, token!, undefined, SABLE)).statusCode, 404);
  assert.equal((await studio('POST', `/versions/${course.id}/submit`, token!, undefined, SABLE)).statusCode, 404);
  assert.equal((await studio('GET', `/courses/${course.entityId}`, token!, undefined, SABLE)).statusCode, 404);
});

test('a draft cannot claim another lesson\'s question', async () => {
  const course = await newCourse();
  const first = await newLesson(course.entityId, title('first'), 1);
  const second = await newLesson(course.entityId, title('second'), 2);
  const stolenId = first.snapshot.questions[0]!.id;
  const res = await studio('PUT', `/lessons/${second.entityId}/draft`, team.author,
    lessonBody(title('second'), 2, { questions: [{ id: stolenId, ...question('Mine now') }, question('Q2'), question('Q3'), question('Q4'), question('Q5')] }));
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, 'unknown_question_id');
  const own = await studio('PUT', `/lessons/${second.entityId}/draft`, team.author,
    lessonBody(title('second'), 2, { questions: [{ id: second.snapshot.questions[0]!.id, ...question('Edited') }, question('Q2'), question('Q3'), question('Q4'), question('Q5')] }));
  assert.equal(own.statusCode, 200, 'its own questions keep their ids');
});

test('requirements must exist, cannot point at the lesson itself, and cannot loop', async () => {
  const course = await newCourse();
  await throughReview(course.id);
  const x = await newLesson(course.entityId, title('x'), 1);
  await throughReview(x.id);
  const y = await newLesson(course.entityId, title('y'), 2, { requires: [x.entityId] });
  await throughReview(y.id);

  const ghost = await newLesson(course.entityId, title('ghost'), 3, { requires: ['00000000-0000-4000-8000-000000000000'] });
  assert.ok((await studio('POST', `/versions/${ghost.id}/submit`, team.author)).json().error.problems
    .some((p: string) => p.includes('must already be published')));

  const loop = (await studio('POST', `/versions/${x.id}/revise`, team.author)).json().version;
  await studio('PUT', `/lessons/${x.entityId}/draft`, team.author, lessonBody(title('x'), 1, { requires: [y.entityId, x.entityId] }));
  const refused = (await studio('POST', `/versions/${loop.id}/submit`, team.author)).json().error.problems;
  assert.ok(refused.some((p: string) => p.includes('loop')), 'x requires y, which requires x');
  assert.ok(refused.some((p: string) => p.includes('cannot require itself')));
});

test('retiring a course takes it off every learner\'s path', async () => {
  const course = await newCourse();
  await throughReview(course.id);
  assert.equal((await studio('POST', `/entities/course/${course.entityId}/retire`, team.author)).statusCode, 403);
  const retired = await studio('POST', `/entities/course/${course.entityId}/retire`, team.compliance);
  assert.equal(retired.statusCode, 200, retired.body);
  assert.equal((await ownerPool.query('SELECT review_state FROM platform.courses WHERE id = $1', [course.entityId])).rows[0].review_state, 'retired');
});

test('platform content goes through three different staff, and academies then read it', async () => {
  const [author, reviewer, compliance] = [await staffMember('platform_author'), await staffMember('platform_reviewer'), await staffMember('platform_compliance')];
  const owner = await staffMember('platform_owner');
  const signIn = async (m: { email: string; secret: string | null }) => (await app.inject({
    method: 'POST', url: '/api/console/auth/login', headers: { host: CONSOLE },
    payload: { email: m.email, password: PASSWORD, ...(m.secret ? { code: totpAt(m.secret, stepOf(Date.now() / 1000)) } : {}) },
  })).cookies.find((c) => c.name === 'console_session')!.value;
  const tokens = { author: await signIn(author), reviewer: await signIn(reviewer), compliance: await signIn(compliance), owner: await signIn(owner) };
  const staffCall = (method: string, url: string, token: string, payload?: Record<string, unknown>) =>
    app.inject({ method: method as 'GET', url: `/api/console/content${url}`, headers: { host: CONSOLE, ...asStaff(token) }, ...(payload ? { payload } : {}) });

  const course = (await staffCall('POST', '/courses', tokens.author, courseBody(title('platform')))).json().version;
  const term = (await staffCall('POST', '/glossary', tokens.author, { term: title('term'), definition: 'A thing worth knowing.' })).json().version;
  for (const v of [course, term]) {
    assert.equal((await staffCall('POST', `/versions/${v.id}/submit`, tokens.author)).statusCode, 200);
    assert.equal((await staffCall('POST', `/versions/${v.id}/approve`, tokens.owner)).json().error.code, 'wrong_role', 'the owner has no review duty');
    assert.equal((await staffCall('POST', `/versions/${v.id}/approve`, tokens.reviewer)).statusCode, 200);
    assert.equal((await staffCall('POST', `/versions/${v.id}/publish`, tokens.compliance)).statusCode, 200);
  }

  const studioCourses = (await studio('GET', '/courses', team.author)).json().courses;
  assert.equal(studioCourses.find((c: { id: string }) => c.id === course.entityId)?.readOnly, true, 'an academy now sees it, read-only');
  const glossary = (await studio('GET', '/glossary', team.author)).json().terms;
  assert.ok(glossary.some((t: { term: string }) => t.term === term.snapshot.term));
  assert.equal((await studio('POST', '/glossary', team.author, { term: title('nope'), definition: 'x' })).statusCode, 404,
    'the glossary is edited only on the console');

  const audit = await ownerPool.query('SELECT action FROM platform.audit_log WHERE entity_id = $1 ORDER BY seq', [course.entityId]);
  assert.deepEqual(audit.rows.map((r: { action: string }) => r.action), ['content.created', 'content.submit', 'content.approve', 'content.publish']);
});

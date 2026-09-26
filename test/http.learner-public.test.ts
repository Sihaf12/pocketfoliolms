/**
 * Module 4b · stage 1: what anyone may read about an academy before
 * signing up. Its name and brand, and the courses it offers.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { shutdown } from '../src/db/unitOfWork.js';
import { NORTHGATE, PASSWORD, removeHttpAccounts, server, uniqueEmail } from './httpHarness.js';

let app: FastifyInstance;
before(async () => { app = await server(); });
after(async () => { await app.close(); await removeHttpAccounts(); await shutdown(); });

const get = (url: string, host = NORTHGATE) => app.inject({ method: 'GET', url, headers: { host } });

test('the academy\'s name and brand are public; nothing else is', async () => {
  const res = await get('/api/v1/academy');
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(Object.keys(res.json()).sort(), ['name', 'sub', 'tokens']);
  assert.equal(res.json().tokens['--brand'], '#1A6DC2');
  assert.equal((await get('/api/v1/academy', 'learn.unknown.example')).statusCode, 404);
});

test('the public catalogue lists the courses this academy offers, in tier order, with what opens each', async () => {
  const res = await get('/api/v1/catalogue');
  assert.equal(res.statusCode, 200, res.body);
  const courses = res.json().courses as { title: string; tier: string; lessons: number; requirement: string | null; lessonTitles: string[] }[];
  const titles = courses.map((c) => c.title);
  assert.ok(titles.includes('How markets work') && titles.includes('Northgate desk rules'));
  assert.ok(!titles.includes('Risk basics'), 'a course switched off in the catalogue is not offered');
  const order = ['learn', 'safeguard', 'apply', 'specialise'];
  assert.deepEqual(courses.map((c) => order.indexOf(c.tier)), [...courses.map((c) => order.indexOf(c.tier))].sort((a, b) => a - b));
  for (const c of courses) {
    assert.equal(c.lessonTitles.length, c.lessons);
    assert.equal(c.requirement, c.tier === 'apply' ? 'Unlocks at Learn 50' : c.tier === 'specialise' ? 'Unlocks at Learn 70 and Safeguard 50' : null);
  }
});

test('a taken email is refused beside the email field', async () => {
  const email = uniqueEmail('taken');
  const signup = () => app.inject({ method: 'POST', url: '/api/v1/auth/signup', headers: { host: NORTHGATE }, payload: { email, password: PASSWORD, displayName: 'Taken' } });
  assert.equal((await signup()).statusCode, 201);
  const again = await signup();
  assert.equal(again.statusCode, 409);
  assert.deepEqual(again.json().error.fields.map((f: { field: string }) => f.field), ['email']);
});

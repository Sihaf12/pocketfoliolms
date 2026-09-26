/**
 * Shared setup for the HTTP suites. Requests go through app.inject(), so
 * every hook, schema and handler runs, against the real database.
 *
 * Accounts made here use http-*@example.com and are removed before and
 * after each suite, taking their sessions, attempts and enrolments with
 * them, so the seeded counts the SQL proof relies on stay put.
 */
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { withControl } from '../src/db/unitOfWork.js';
import { buildServer, type ServerOptions } from '../src/http/server.js';

export const NORTHGATE = 'learn.northgate.ae';
export const SABLE = 'training.sablewealth.io';
export const PASSWORD = 'correct horse battery';

/**
 * Every suite sends all its requests from 127.0.0.1, so the tenant-wide
 * limit is lifted here unless a test sets it; the rate-limit tests do.
 */
export async function server(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = await buildServer({ ...opts, limits: { tenant: { max: 100_000, windowMs: 60_000 }, ...opts.limits } });
  await app.ready();
  return app;
}

export async function tenantId(slug: string): Promise<string> {
  return withControl(async (c) =>
    (await c.query<{ id: string }>('SELECT id FROM app.tenants WHERE slug = $1', [slug])).rows[0]!.id);
}

export async function removeHttpAccounts(): Promise<void> {
  await withControl(async (c) => {
    await c.query(`DELETE FROM app.users WHERE email LIKE 'http-%@example.com'`);
  });
}

/** The session token from a Set-Cookie header, if one was set. */
export function sessionToken(res: LightMyRequestResponse): string | undefined {
  return res.cookies.find((c) => c.name === 'session')?.value;
}

export function asLearner(token: string) {
  return { cookie: `session=${token}` };
}

let counter = 0;
export function uniqueEmail(label: string): string {
  counter += 1;
  return `http-${label}-${process.pid}-${counter}@example.com`;
}

export async function signup(
  app: FastifyInstance,
  host: string,
  overrides: Partial<{ email: string; ibRefCode: string }> = {},
): Promise<{ token: string; userId: string; email: string }> {
  const email = overrides.email ?? uniqueEmail('learner');
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    headers: { host },
    payload: { email, password: PASSWORD, displayName: 'Test Learner', ...overrides },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  return { token: sessionToken(res)!, userId: res.json<{ user: { id: string } }>().user.id, email };
}

export const SELF_RATING = { learn: 50, safeguard: 0, apply: 100, specialise: 25 };

export async function onboard(app: FastifyInstance, host: string, token: string, selfRating = SELF_RATING) {
  const res = await app.inject({
    method: 'PUT', url: '/api/v1/onboarding', headers: { host, ...asLearner(token) }, payload: { selfRating },
  });
  if (res.statusCode !== 200) throw new Error(`onboarding failed: ${res.statusCode} ${res.body}`);
  return res;
}

export interface Paper {
  attemptId: string;
  questions: { id: string; tier?: string; prompt: string; options: { key: string; text: string }[] }[];
}

export async function drawPlacement(app: FastifyInstance, host: string, token: string): Promise<Paper> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/placement', headers: { host, ...asLearner(token) } });
  if (res.statusCode !== 201 && res.statusCode !== 200) throw new Error(`draw failed: ${res.statusCode} ${res.body}`);
  return res.json<Paper>();
}

/**
 * Every seeded placement question is answered by 'a'. `correctPerTier`
 * says how many to get right in each tier; the rest are skipped.
 */
export function placementAnswers(paper: Paper, correctPerTier: Record<string, number>): Record<string, string | null> {
  const used: Record<string, number> = {};
  const answers: Record<string, string | null> = {};
  for (const q of paper.questions) {
    const tier = q.tier ?? '';
    used[tier] = (used[tier] ?? 0) + 1;
    answers[q.id] = used[tier]! <= (correctPerTier[tier] ?? 0) ? 'a' : null;
  }
  return answers;
}

/**
 * A learner through sign-up, onboarding and placement. By default Learn
 * and Safeguard are fully correct, which opens every tier.
 */
export async function placedLearner(
  app: FastifyInstance,
  host: string,
  opts: { correctPerTier?: Record<string, number>; ibRefCode?: string } = {},
) {
  const learner = await signup(app, host, opts.ibRefCode ? { ibRefCode: opts.ibRefCode } : {});
  await onboard(app, host, learner.token);
  const paper = await drawPlacement(app, host, learner.token);
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/placement/${paper.attemptId}/submission`,
    headers: { host, ...asLearner(learner.token) },
    payload: { answers: placementAnswers(paper, opts.correctPerTier ?? { learn: 2, safeguard: 2 }) },
  });
  if (res.statusCode !== 200) throw new Error(`placement failed: ${res.statusCode} ${res.body}`);
  return learner;
}

export async function outboxRows(idempotencyKey: string) {
  return withControl(async (c) =>
    (await c.query<{ tenant_id: string; event_type: string; payload: Record<string, unknown> }>(
      'SELECT tenant_id, event_type, payload FROM app.outbox_events WHERE idempotency_key = $1',
      [idempotencyKey],
    )).rows);
}

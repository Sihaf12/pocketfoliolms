/**
 * Shared setup for the HTTP suites. Requests go through app.inject(), so
 * every hook, schema and handler runs, against the real database.
 *
 * Accounts made here use http-*@example.com and are removed before and
 * after each suite, taking their sessions, attempts and enrolments with
 * them, so the seeded counts the SQL proof relies on stay put.
 */
import pg from 'pg';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { withConsole, withControl } from '../src/db/unitOfWork.js';
import { buildServer, type ServerOptions } from '../src/http/server.js';
import { hashPassword } from '../src/auth/password.js';
import { keyFrom, seal } from '../src/auth/secretBox.js';
import { newTotpSecret } from '../src/auth/totp.js';
import type { StaffRole } from '../src/auth/staffSession.js';

export const NORTHGATE = 'learn.northgate.ae';
export const SABLE = 'training.sablewealth.io';
export const CONSOLE = 'console.academy.test';
export const PASSWORD = 'correct horse battery';
/** A fixed test key. Real deployments take CONSOLE_TOTP_KEY from the environment. */
export const TEST_TOTP_KEY = Buffer.alloc(32, 7).toString('base64');

/**
 * The database owner, for clean-up only: platform staff and audit rows
 * belong to no request role that may delete them, which is the point.
 */
export const ownerPool = new pg.Pool({
  connectionString: process.env.OWNER_DATABASE_URL ?? 'postgres:///academy', max: 2, allowExitOnIdle: true,
});

/** A server as the tests use it: the console enabled, and rate limits lifted unless a test sets them. */
export async function server(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = await buildServer({
    console: { host: CONSOLE, totpKey: TEST_TOTP_KEY },
    ...opts,
    // Every suite signs in many times from 127.0.0.1. The rate-limit tests
    // set their own limits; everything else runs without them.
    limits: {
      tenant: { max: 100_000, windowMs: 60_000 }, console: { max: 100_000, windowMs: 60_000 },
      login: { max: 100_000, windowMs: 60_000 }, ...opts.limits,
    },
  });
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
    await c.query(`DELETE FROM app.studio_invitations WHERE email LIKE 'http-%@example.com'`);
  });
}

/**
 * Removes what the console tests made: academies, staff, and their
 * invitations. An academy's audit history is append-only and cascades
 * with it, so, for test clean-up alone, the owner lifts that trigger for
 * one transaction. Nothing on the request path can.
 */
export async function removeConsoleFixtures(): Promise<void> {
  const c = await ownerPool.connect();
  try {
    await c.query('BEGIN');
    await c.query('ALTER TABLE app.system_audit_log DISABLE TRIGGER trg_audit_immutable');
    await c.query(`DELETE FROM app.tenants WHERE slug LIKE 'http-%'`);
    await c.query('ALTER TABLE app.system_audit_log ENABLE TRIGGER trg_audit_immutable');
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
  await ownerPool.query(`DELETE FROM platform.staff_invitations WHERE email LIKE 'http-%@example.com'`);
  await ownerPool.query(`DELETE FROM platform.staff WHERE email LIKE 'http-%@example.com'`);
}

/** A studio member made directly, as a seed would, so tests start from a known team. */
export async function studioMember(tenantSlug: string, roles: string[], label = 'studio') {
  const email = uniqueEmail(label);
  const passwordHash = await hashPassword(PASSWORD);
  const id = await withControl(async (c) => (await c.query<{ id: string }>(
    `INSERT INTO app.users (tenant_id, email, display_name, password_hash, studio_roles)
     SELECT id, $2, 'Studio Member', $3, $4::text[] FROM app.tenants WHERE slug = $1 RETURNING id`,
    [tenantSlug, email, passwordHash, roles])).rows[0]!.id);
  return { id, email };
}

export async function studioLogin(app: FastifyInstance, host: string, email: string, password = PASSWORD) {
  const res = await app.inject({ method: 'POST', url: '/api/studio/auth/login', headers: { host }, payload: { email, password } });
  return { res, token: res.cookies.find((c) => c.name === 'studio_session')?.value };
}

export const asStudio = (token: string) => ({ cookie: `studio_session=${token}` });
export const asStaff = (token: string) => ({ cookie: `console_session=${token}` });

/** Platform staff made directly. An owner always gets a TOTP secret; others only if asked. */
export async function staffMember(role: StaffRole, opts: { totp?: boolean } = {}) {
  const email = uniqueEmail('staff');
  const secret = role === 'platform_owner' || opts.totp ? newTotpSecret() : null;
  const passwordHash = await hashPassword(PASSWORD);
  const id = await withConsole({ actor: 'test' }, async (db) => (await db.one<{ id: string }>(
    `INSERT INTO platform.staff (email, display_name, role, password_hash, totp_secret) VALUES ($1, 'Staff Member', $2, $3, $4) RETURNING id`,
    [email, role, passwordHash, secret ? seal(secret, keyFrom(TEST_TOTP_KEY)) : null])).id);
  return { id, email, secret };
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

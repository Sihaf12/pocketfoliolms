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

export async function server(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = await buildServer(opts);
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

export async function outboxRows(idempotencyKey: string) {
  return withControl(async (c) =>
    (await c.query<{ tenant_id: string; event_type: string; payload: Record<string, unknown> }>(
      'SELECT tenant_id, event_type, payload FROM app.outbox_events WHERE idempotency_key = $1',
      [idempotencyKey],
    )).rows);
}

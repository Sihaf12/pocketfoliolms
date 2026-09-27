/**
 * The HTTP server, built as three sibling scopes.
 *
 *   public   no tenant; the handful of routes that must work for anyone
 *   tenant   the host decides the academy: learner routes at /api/v1,
 *            and the studio at /api/studio, nested inside it
 *   console  the platform console at /api/console, on CONSOLE_HOST only
 *
 * Which scope a route is registered in is the whole of its tenancy.
 * There is no per-route flag to forget.
 *
 * Before any scope, forwarding.ts decides the public host and the
 * client's address, and refuses forwarded headers that did not come
 * from the front end.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { HttpError, errorBody, handleError } from './errors.js';
import { tenantScope } from './tenantScope.js';
import { authRoutes } from './routes/auth.js';
import { academyRoutes } from './routes/academy.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { placementRoutes } from './routes/placement.js';
import { pathwayRoutes } from './routes/pathway.js';
import { lessonRoutes } from './routes/lessons.js';
import { checkRoutes } from './routes/checks.js';
import { meRoutes } from './routes/me.js';
import { certificateRoutes } from './routes/public/certificates.js';
import { studioAccountRoutes } from './routes/studio/account.js';
import { studioUserRoutes } from './routes/studio/users.js';
import { consoleAccountRoutes } from './routes/console/account.js';
import { consoleStaffRoutes } from './routes/console/staff.js';
import { consoleTenantRoutes } from './routes/console/tenants.js';
import { consoleOutboxRoutes } from './routes/console/outbox.js';
import { studioCatalogueRoutes } from './routes/studio/catalogue.js';
import { studioLearnerRoutes } from './routes/studio/learners.js';
import { studioOutboxRoutes } from './routes/studio/outbox.js';
import { studioSettingsRoutes, type ResolveTxt } from './routes/studio/settings.js';
import { contentRoutes, type ContentRunner } from './routes/content.js';
import { inStudio, requireStudio } from './studioScope.js';
import { inConsole, requireStaff } from './consoleScope.js';
import { dutiesOf } from '../domain/review.js';
import { forwarding } from './forwarding.js';
import { studioScope } from './studioScope.js';
import { consoleScope } from './consoleScope.js';

/** Studio content: this academy's private courses, as the signed-in studio user. */
const studioContent: ContentRunner = (req, fn) =>
  inStudio(req, async (db) => {
    const user = await requireStudio(db, req);
    return fn({ db, scope: { owner: req.tenantId, people: 'users' }, actor: { id: user.id, duties: dutiesOf(user.roles) } });
  });

/** Console content: platform courses and the glossary, as the signed-in staff member. */
const consoleContent: ContentRunner = (req, fn) =>
  inConsole(async (db) => {
    const staff = await requireStaff(db, req);
    return fn({ db, scope: { owner: null, people: 'staff' }, actor: { id: staff.id, duties: dutiesOf([staff.role]) } });
  });
import { normaliseHost } from './tenantScope.js';
import { keyFrom } from '../auth/secretBox.js';
import { resolveTenantByHost } from '../db/unitOfWork.js';
import { config } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Every route registered, for the test that audits which scope each lives in. */
    routeList: ReadonlyArray<{ method: string; url: string }>;
    /** False only under the development cookie switch. */
    sessionCookieSecure: boolean;
  }
}

export interface RouteLimit {
  max: number;
  windowMs: number;
}

export interface ServerOptions {
  /** Shared with the front end. Forwarded headers without it are refused. Empty: no front end. */
  proxySecret?: string;
  /** Per-IP request limits, by the client address forwarding.ts decided. */
  limits?: { tenant?: RouteLimit; login?: RouteLimit; certificates?: RouteLimit; console?: RouteLimit };
  /** The console's one host, and the key TOTP secrets are sealed with. No host: no console. */
  console?: { host: string; totpKey: string };
  /**
   * Development only: send the session cookie without Secure, so a
   * browser keeps it over plain HTTP on a local .test host. Refused
   * outright when NODE_ENV is production.
   */
  insecureDevCookie?: boolean;
  /** How a domain change's TXT record is looked up. DNS unless a test supplies one. */
  resolveTxt?: ResolveTxt;
}

export class ConsoleHostIsAnAcademyError extends Error {
  constructor(host: string) {
    super(`CONSOLE_HOST ${host} is an academy's primary domain. Refusing to start.`);
    this.name = 'ConsoleHostIsAnAcademyError';
  }
}

export class InsecureCookieInProductionError extends Error {
  constructor() {
    super('DEV_INSECURE_COOKIE is set while NODE_ENV is production. Refusing to start.');
    this.name = 'InsecureCookieInProductionError';
  }
}

const DEFAULT_LIMITS = {
  tenant: { max: 300, windowMs: 60_000 },
  login: { max: 10, windowMs: 60_000 },
  certificates: { max: 30, windowMs: 60_000 },
  console: { max: 120, windowMs: 60_000 },
} as const;

export async function buildServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  if (opts.insecureDevCookie && process.env.NODE_ENV === 'production') throw new InsecureCookieInProductionError();

  const consoleOpts = opts.console ?? { host: config.console.host, totpKey: config.console.totpKey };
  const consoleHost = consoleOpts.host.trim().toLowerCase();
  if (consoleHost) {
    if (normaliseHost(consoleHost) !== consoleHost) throw new Error(`CONSOLE_HOST ${consoleHost} is not a plain host name.`);
    // The console's host can never be an academy's: that would put both
    // behind one address. Checked before the server takes a request.
    if (await resolveTenantByHost(consoleHost)) throw new ConsoleHostIsAnAcademyError(consoleHost);
  }

  const app = Fastify({
    logger: false,
    // Forwarded headers are handled by forwarding.ts, with the shared secret.
    trustProxy: false,
    bodyLimit: 64 * 1024,
    // Fastify's default strips unknown fields silently. A client sending
    // a field we do not accept, tenant_id above all, gets a 400 instead.
    // allErrors: a refused form hears about every field at once, not one per try.
    // Bodies are capped at 64 KB above, which bounds the work.
    ajv: { customOptions: { removeAdditional: false, allErrors: true } },
  });

  const routes: { method: string; url: string }[] = [];
  app.decorate('routeList', routes);
  app.decorate('sessionCookieSecure', !opts.insecureDevCookie);
  app.addHook('onRoute', (r) => {
    for (const method of [r.method].flat()) routes.push({ method, url: r.url });
  });

  app.setErrorHandler(handleError);
  app.setNotFoundHandler((_req, reply) => reply.status(404).send(errorBody('not_found', 'Not found.')));
  forwarding(app, opts.proxySecret ?? config.http.proxySecret);
  await app.register(cookie);
  // Opt-in per route. Counters live in this process; several instances
  // behind a balancer each allow the limit, until a shared store is added.
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => req.clientIp,
    errorResponseBuilder: (_req, ctx) =>
      new HttpError(429, 'rate_limited', `Too many requests. Try again in ${ctx.after}.`),
  });
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };


  await app.register(async (publicScope) => {
    await publicScope.register(certificateRoutes, { prefix: '/api/v1', limit: limits.certificates });
  });

  await app.register(async (scope) => {
    tenantScope(scope, { limit: limits.tenant, consoleHost });
    await scope.register(async (studio) => {
      studioScope(studio);
      await studio.register(studioAccountRoutes, { loginLimit: limits.login });
      await studio.register(studioUserRoutes);
      await studio.register(contentRoutes, { run: studioContent, platform: false });
      await studio.register(studioCatalogueRoutes);
      await studio.register(studioLearnerRoutes);
      await studio.register(studioSettingsRoutes, { consoleHost, ...(opts.resolveTxt ? { resolveTxt: opts.resolveTxt } : {}) });
      await studio.register(studioOutboxRoutes);
    }, { prefix: '/api/studio' });
    await scope.register(async (api) => {
      await api.register(academyRoutes);
      await api.register(authRoutes, { loginLimit: limits.login });
      await api.register(onboardingRoutes);
      await api.register(placementRoutes);
      await api.register(pathwayRoutes);
      await api.register(lessonRoutes);
      await api.register(checkRoutes);
      await api.register(meRoutes);
    }, { prefix: '/api/v1' });
  });

  if (consoleHost) {
    app.decorate('totpKey', keyFrom(consoleOpts.totpKey));
    await app.register(async (console) => {
      consoleScope(console, { host: consoleHost, limit: limits.console });
      await console.register(consoleAccountRoutes, { loginLimit: limits.login });
      await console.register(consoleStaffRoutes);
      await console.register(consoleTenantRoutes, { consoleHost });
      await console.register(consoleOutboxRoutes);
      await console.register(contentRoutes, { prefix: '/content', run: consoleContent, platform: true });
    }, { prefix: '/api/console' });
  }

  return app;
}

/**
 * The HTTP server, built as two sibling scopes.
 *
 *   public   no tenant; the handful of routes that must work for anyone
 *   tenant   every other route; the host decides the academy
 *
 * Which scope a route is registered in is the whole of its tenancy.
 * There is no per-route flag to forget.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { HttpError, errorBody, handleError } from './errors.js';
import { tenantScope } from './tenantScope.js';
import { authRoutes } from './routes/auth.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { placementRoutes } from './routes/placement.js';
import { pathwayRoutes } from './routes/pathway.js';
import { lessonRoutes } from './routes/lessons.js';
import { checkRoutes } from './routes/checks.js';
import { certificateRoutes } from './routes/public/certificates.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Every route registered, for the test that audits which scope each lives in. */
    routeList: ReadonlyArray<{ method: string; url: string }>;
  }
}

export interface RouteLimit {
  max: number;
  windowMs: number;
}

export interface ServerOptions {
  /** Addresses of proxies allowed to set X-Forwarded-*. Nobody else is believed. */
  trustProxy?: string[];
  /** Per-IP request limits. The client IP is only as good as trustProxy. */
  limits?: { login?: RouteLimit; certificates?: RouteLimit };
}

const DEFAULT_LIMITS = {
  login: { max: 10, windowMs: 60_000 },
  certificates: { max: 30, windowMs: 60_000 },
} as const;

export async function buildServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const trustProxy = opts.trustProxy && opts.trustProxy.length > 0 ? opts.trustProxy : false;
  const app = Fastify({
    logger: false,
    trustProxy,
    bodyLimit: 64 * 1024,
    // Fastify's default strips unknown fields silently. A client sending
    // a field we do not accept, tenant_id above all, gets a 400 instead.
    ajv: { customOptions: { removeAdditional: false } },
  });

  const routes: { method: string; url: string }[] = [];
  app.decorate('routeList', routes);
  app.addHook('onRoute', (r) => {
    for (const method of [r.method].flat()) routes.push({ method, url: r.url });
  });

  app.setErrorHandler(handleError);
  app.setNotFoundHandler((_req, reply) => reply.status(404).send(errorBody('not_found', 'Not found.')));
  await app.register(cookie);
  // Opt-in per route. Counters live in this process; several instances
  // behind a balancer each allow the limit, until a shared store is added.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) =>
      new HttpError(429, 'rate_limited', `Too many requests. Try again in ${ctx.after}.`),
  });
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };

  await app.register(async (publicScope) => {
    await publicScope.register(certificateRoutes, { limit: limits.certificates });
  }, { prefix: '/api/v1' });

  await app.register(async (scope) => {
    tenantScope(scope);
    await scope.register(authRoutes, { loginLimit: limits.login });
    await scope.register(onboardingRoutes);
    await scope.register(placementRoutes);
    await scope.register(pathwayRoutes);
    await scope.register(lessonRoutes);
    await scope.register(checkRoutes);
  }, { prefix: '/api/v1' });

  return app;
}

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
import { errorBody, handleError } from './errors.js';
import { tenantScope } from './tenantScope.js';
import { authRoutes } from './routes/auth.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { placementRoutes } from './routes/placement.js';
import { pathwayRoutes } from './routes/pathway.js';
import { lessonRoutes } from './routes/lessons.js';
import { checkRoutes } from './routes/checks.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Every route registered, for the test that audits which scope each lives in. */
    routeList: ReadonlyArray<{ method: string; url: string }>;
  }
}

export interface ServerOptions {
  /** Addresses of proxies allowed to set X-Forwarded-*. Nobody else is believed. */
  trustProxy?: string[];
}

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

  await app.register(async (_publicScope) => {
    // Public certificate verification arrives in stage 4.
  }, { prefix: '/api/v1' });

  await app.register(async (scope) => {
    tenantScope(scope);
    await scope.register(authRoutes);
    await scope.register(onboardingRoutes);
    await scope.register(placementRoutes);
    await scope.register(pathwayRoutes);
    await scope.register(lessonRoutes);
    await scope.register(checkRoutes);
  }, { prefix: '/api/v1' });

  return app;
}

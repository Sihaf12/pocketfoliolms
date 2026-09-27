import { config } from '../config.js';
import { shutdown } from '../db/unitOfWork.js';
import { logger } from '../logger.js';
import { buildServer } from './server.js';
import { buildTlsAskServer } from './tlsAsk.js';

// Only the limits the environment sets; the rest keep the server's defaults.
const limits = Object.fromEntries(Object.entries({
  tenant: config.limits.tenantPerMinute, login: config.limits.loginPerMinute, console: config.limits.consolePerMinute,
}).flatMap(([scope, max]) => (max ? [[scope, { max, windowMs: 60_000 }]] : [])));

const app = await buildServer({
  proxySecret: config.http.proxySecret,
  limits,
  console: { host: config.console.host, totpKey: config.console.totpKey },
  insecureDevCookie: config.http.insecureDevCookie,
});
if (config.http.insecureDevCookie) {
  logger.warn({}, 'DEV_INSECURE_COOKIE is on: session cookies are sent without Secure. Never use this outside local development.');
}
await app.listen({ host: config.http.host, port: config.http.port });
logger.info({ host: config.http.host, port: config.http.port }, 'http server listening');

// Caddy's on-demand TLS question, on its own internal port.
const askPort = config.http.tlsAskPort;
const ask = askPort
  ? await buildTlsAskServer({ consoleHost: config.console.host, callbackHost: config.google.clientId ? config.google.callbackHost : '' })
  : null;
if (ask && askPort) {
  await ask.listen({ host: config.http.host, port: askPort });
  logger.info({ host: config.http.host, port: askPort }, 'tls ask server listening');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void Promise.all([app.close(), ask?.close()]).then(shutdown).then(() => process.exit(0));
  });
}

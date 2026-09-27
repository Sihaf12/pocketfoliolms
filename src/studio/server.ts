/**
 * The Next.js front end's own HTTP server: the studio, the console, and
 * the learner page, with every /api request forwarded to Fastify.
 *
 * It exists for one reason. Next.js keeps an X-Forwarded-For that a
 * browser sent, and only fills it in when it is missing, so the address
 * it reports could be anyone's choosing. This server decides the
 * client's address before Next.js sees the request (see edge.ts): the
 * socket's, or the one a reverse proxy in front names when it presents
 * the shared secret. The route that forwards to Fastify then signs what
 * it passes on with the same secret. /healthz is answered here.
 *
 *   STUDIO_PORT      port                    (default 3100)
 *   STUDIO_HOST      address to listen on    (default 127.0.0.1)
 *   STUDIO_DEV       1 for next dev          (default production)
 *   BACKEND_URL      Fastify                 (default http://127.0.0.1:3000)
 *   PROXY_SECRET     shared with Fastify     (required)
 *   PUBLIC_PROTO     scheme browsers use     (default https)
 *   CONSOLE_HOST     the console's host      (empty: no console)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { admit, isHealthCheck } from './edge.js';

/**
 * The part of Next.js this file uses. Loaded at run time rather than
 * imported, so Next's global type declarations stay out of the API build.
 */
interface NextApp {
  prepare(): Promise<void>;
  getRequestHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}
type CreateNext = (opts: { dev: boolean; dir: string; hostname: string; port: number }) => NextApp;
const next = createRequire(import.meta.url)('next') as CreateNext;


async function main(): Promise<void> {
  if (!process.env.PROXY_SECRET) {
    throw new Error('PROXY_SECRET is not set. The front end signs what it forwards with it; refusing to start without one.');
  }
  const dev = process.env.STUDIO_DEV === '1';
  const port = Number(process.env.STUDIO_PORT ?? 3100);
  const hostname = process.env.STUDIO_HOST ?? '127.0.0.1';
  const dir = fileURLToPath(new URL('../../../studio', import.meta.url));

  const app = next({ dev, dir, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const secret = process.env.PROXY_SECRET;
  createServer((req, res) => {
    if (isHealthCheck(req.url)) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end('ok');
      return;
    }
    if (!admit(req, secret)) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Forwarded requests are accepted only from the academy\'s proxy.');
      return;
    }
    void handle(req, res);
  }).listen(port, hostname, () => {
    process.stdout.write(`studio listening on http://${hostname}:${port} (${dev ? 'development' : 'production'})\n`);
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

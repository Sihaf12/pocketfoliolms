import { config } from '../config.js';
import { shutdown } from '../db/unitOfWork.js';
import { logger } from '../logger.js';
import { buildServer } from './server.js';

const app = await buildServer({ trustProxy: config.http.trustProxy });
await app.listen({ host: config.http.host, port: config.http.port });
logger.info({ host: config.http.host, port: config.http.port }, 'http server listening');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(shutdown).then(() => process.exit(0));
  });
}

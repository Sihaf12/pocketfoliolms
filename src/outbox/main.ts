/**
 * The outbox relay as its own process (npm run worker, and the relay
 * container in staging). It needs only CONTROL_DATABASE_URL. On SIGTERM it
 * finishes the pass under way, then closes its connections.
 */
import { shutdown } from '../db/unitOfWork.js';
import { logger } from '../logger.js';
import { OutboxRelay } from './relay.js';

const relay = new OutboxRelay();
relay.start();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'outbox relay stopping');
    void relay.stop().then(shutdown).then(() => process.exit(0));
  });
}

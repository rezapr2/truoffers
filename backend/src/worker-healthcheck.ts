import { hostname } from 'node:os';
import { createRedis } from './scraper/infra/redis';
import { WORKER_HEARTBEAT_PREFIX } from './scraper/queue/queue.constants';

// Docker healthcheck for the worker container: healthy while this host's worker keeps its heartbeat fresh.
async function main() {
  const redis = createRedis({ maxRetriesPerRequest: 1, connectTimeout: 3_000 });
  try {
    const keys = await redis.keys(`${WORKER_HEARTBEAT_PREFIX}${hostname()}:*`);
    process.exit(keys.length > 0 ? 0 : 1);
  } catch {
    process.exit(1);
  } finally {
    redis.disconnect();
  }
}

void main();

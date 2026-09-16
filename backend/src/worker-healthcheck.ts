import { hostname } from 'node:os';
import { createRedis } from './scraper/infra/redis';
import { isRenderWorker, RENDER_WORKER_HEARTBEAT_PREFIX, WORKER_HEARTBEAT_PREFIX } from './scraper/queue/queue.constants';

// Docker healthcheck for a worker container (crawling or rendering): healthy while its heartbeat is fresh.
async function main() {
  const redis = createRedis({ maxRetriesPerRequest: 1, connectTimeout: 3_000 });
  try {
    const prefix = isRenderWorker() ? RENDER_WORKER_HEARTBEAT_PREFIX : WORKER_HEARTBEAT_PREFIX;
    const keys = await redis.keys(`${prefix}${hostname()}:*`);
    process.exit(keys.length > 0 ? 0 : 1);
  } catch {
    process.exit(1);
  } finally {
    redis.disconnect();
  }
}

void main();

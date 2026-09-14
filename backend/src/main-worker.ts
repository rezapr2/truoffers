import { NestFactory } from '@nestjs/core';
import { JsonLogger } from './scraper/infra/json-logger';
import { loadFixtureHosts } from './scraper/safety/fixture-hosts';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  // Fails fast if fixture hosts are configured in production.
  const fixtureHosts = loadFixtureHosts();
  const logger = new JsonLogger();
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger });
  app.enableShutdownHooks();
  logger.log({ msg: 'Scraper worker started', fixtureHosts: [...fixtureHosts] }, 'Bootstrap');
}

bootstrap().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'fatal', msg: (err as Error).message })}\n`);
  process.exit(1);
});

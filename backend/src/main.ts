import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadFixtureHosts } from './scraper/safety/fixture-hosts';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('dev-secret'))
  ) {
    throw new Error('Refusing to start in production with a default JWT_SECRET');
  }
  // Refuses to start if scraper fixture hosts are configured in production (or aren't .test names).
  loadFixtureHosts();

  // rawBody is required to verify Stripe webhook signatures
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureApp(app);
  app.enableShutdownHooks();

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`TruOffers API running on http://localhost:${port}/api`);
}
bootstrap();

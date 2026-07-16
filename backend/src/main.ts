import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  // rawBody is required to verify Stripe webhook signatures
  const app = await NestFactory.create(AppModule, { rawBody: true });

  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('dev-secret'))
  ) {
    throw new Error('Refusing to start in production with a default JWT_SECRET');
  }

  app.setGlobalPrefix('api');
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.enableCors({
    origin: process.env.FRONTEND_URL?.split(',') || true,
    credentials: true,
  });
  app.enableShutdownHooks();

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`TruOffers API running on http://localhost:${port}/api`);
}
bootstrap();

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

// HTTP configuration shared by main.ts and the API tests, so tests exercise what production runs.
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  // One reverse proxy (Caddy) sits in front in production: use the client address it forwards, so
  // per-IP throttles apply to clients rather than to the proxy.
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.enableCors({
    origin: process.env.FRONTEND_URL?.split(',') || true,
    credentials: true,
  });
  return app;
}

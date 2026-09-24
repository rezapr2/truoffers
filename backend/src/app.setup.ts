import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

// HTTP configuration shared by main.ts and the API tests, so tests exercise what production runs.
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  // One reverse proxy (Caddy) sits in front in production: use the client address it forwards, so
  // per-IP throttles apply to clients rather than to the proxy.
  app.set('trust proxy', 1);
  // Express 4 parses `?status[$ne]=x` into an object, which reaches Mongo filters as an operator. Every query
  // parameter this API takes is a single string, so parse each to its first value and nothing else.
  app.set('query parser', parseFlatQuery);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.enableCors({
    // Any origin is only for local development; production without FRONTEND_URL allows none.
    origin: process.env.FRONTEND_URL?.split(',') || process.env.NODE_ENV !== 'production',
    credentials: true,
  });
  return app;
}

export function parseFlatQuery(queryString: string): Record<string, string> {
  const query: Record<string, string> = Object.create(null);
  for (const [key, value] of new URLSearchParams(queryString)) {
    if (!(key in query)) query[key] = value;
  }
  return query;
}

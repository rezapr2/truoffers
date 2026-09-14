// Tests never touch the dev database or the default Redis db.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ??= 'mongodb://localhost:27017/truoffers_test';
process.env.REDIS_URL ??= 'redis://localhost:6379/15';
process.env.SITE_URL ??= 'http://localhost:3000';
process.env.JWT_SECRET ??= 'test-only-jwt-secret';

if (!/truoffers_test/.test(process.env.MONGODB_URI)) {
  throw new Error(`Refusing to run tests against a non-test database: ${process.env.MONGODB_URI}`);
}

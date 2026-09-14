/** @type {import('ts-jest').JestConfigWithTsJest} */
const project = (name, extra = {}) => ({
  displayName: name,
  rootDir: __dirname,
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: [`<rootDir>/test/${name}/**/*.spec.ts`],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  transform: {
    // `npm run typecheck` covers test files, so skip per-file diagnostics here for speed.
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }],
  },
  ...extra,
});

module.exports = {
  projects: [
    project('unit'),
    project('integration', { testTimeout: 30_000 }),
    project('e2e', { testTimeout: 120_000 }),
  ],
};

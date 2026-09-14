/** @type {import('ts-jest').JestConfigWithTsJest} */
const project = (name, extra = {}) => ({
  displayName: name,
  rootDir: __dirname,
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: [`<rootDir>/test/${name}/**/*.spec.ts`],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  transform: {
    // Transpile-only (isolatedModules): a full type-checking program per worker needs gigabytes of heap.
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  ...extra,
});

module.exports = {
  projects: [
    project('unit'),
    // testTimeout is a global option that projects ignore, so timeouts are set per project here.
    project('integration', { setupFilesAfterEnv: ['<rootDir>/test/setup-timeout-integration.ts'] }),
    project('e2e', { setupFilesAfterEnv: ['<rootDir>/test/setup-timeout-e2e.ts'] }),
  ],
};

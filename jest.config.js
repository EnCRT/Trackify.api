/** Jest configuration for the Trackify.API integration test suite.
 *
 * One worker: every test file boots its own Strapi instance against an
 * isolated SQLite database (see tests/helpers.ts), and a single worker keeps
 * resource usage and file locks sane.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  maxWorkers: 1,
  testTimeout: 180000, // Strapi bootstrap + seeds are slow on Windows
  verbose: true,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};

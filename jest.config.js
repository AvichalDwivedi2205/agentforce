export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapping: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.spec.ts', '**/tests/**/*Test.ts'],
  collectCoverageFrom: [
    '**/*.ts',
    '!**/node_modules/**',
    '!**/tests/**',
  ],
  maxWorkers: 1,
  workerIdleMemoryLimit: '512MB',
  testTimeout: 30000,
};

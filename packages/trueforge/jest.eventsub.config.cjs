/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(m?js|tsx?)$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: true, dynamicImport: true },
          target: 'es2022',
        },
        module: { type: 'commonjs' },
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@truefoundry/trueforge-sdk$': '<rootDir>/../trueforge-sdk/src/index.ts',
    '^@truefoundry/trueforge-core/agent-session/(.*)$': '<rootDir>/../trueforge-core/src/agent-session/$1',
    '^@truefoundry/trueforge-core/core/(.*)$': '<rootDir>/../trueforge-core/src/core/$1',
  },
  testTimeout: 30_000,
  maxWorkers: '50%',
  roots: ['<rootDir>/tests/runtime/event-subscription'],
  testMatch: ['<rootDir>/tests/runtime/event-subscription/**/*.test.ts'],
};

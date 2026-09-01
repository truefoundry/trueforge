/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/db/postgres/globalSetup.ts',
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
    '^@truefoundry/trueforge-core/agent-session$': '<rootDir>/../trueforge-core/src/agent-session/index.ts',
    '^@truefoundry/trueforge-core/agent-session/(.*)$': '<rootDir>/../trueforge-core/src/agent-session/$1',
    '^@truefoundry/trueforge-core/core$': '<rootDir>/../trueforge-core/src/core/index.ts',
    '^@truefoundry/trueforge-core/core/(.*)$': '<rootDir>/../trueforge-core/src/core/$1',
  },
  transformIgnorePatterns: ['/node_modules/(?!.*kysely)'],
  testTimeout: 120_000,
  maxWorkers: '50%',
  roots: ['<rootDir>/tests/db', '<rootDir>/src'],
  testMatch: ['<rootDir>/tests/db/**/postgres/**/*.test.ts'],
};

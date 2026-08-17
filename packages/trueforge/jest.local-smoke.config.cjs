/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: true, dynamicImport: true },
          target: 'es2022',
        },
        module: { type: 'commonjs' },
      },
    ],
    '^.+\\.m?js$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'ecmascript', dynamicImport: true },
          target: 'es2022',
        },
        module: { type: 'commonjs' },
      },
    ],
  },
  transformIgnorePatterns: [],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@truefoundry/trueforge-core/agent-session$': '<rootDir>/../trueforge-core/src/agent-session/index.ts',
    '^@truefoundry/trueforge-core/agent-session/(.*)$': '<rootDir>/../trueforge-core/src/agent-session/$1',
    '^@truefoundry/trueforge-core/request-reply$': '<rootDir>/../trueforge-core/src/request-reply/index.ts',
    '^@truefoundry/trueforge-core/request-reply/(.*)$': '<rootDir>/../trueforge-core/src/request-reply/$1',
    '^@truefoundry/trueforge-core/core$': '<rootDir>/../trueforge-core/src/core/index.ts',
    '^@truefoundry/trueforge-core/core/(.*)$': '<rootDir>/../trueforge-core/src/core/$1',
  },
  testTimeout: 120_000,
  maxWorkers: 1,
  roots: ['<rootDir>/tests/sandbox/local'],
  testMatch: ['<rootDir>/tests/sandbox/local/smoke.test.ts'],
};

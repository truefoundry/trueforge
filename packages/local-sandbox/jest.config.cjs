/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: true },
          target: 'es2022',
        },
        module: { type: 'commonjs' },
      },
    ],
    // Dependencies that ship as ESM — compile them to CJS for Jest (same as trueforge-core).
    '^.+\\.js$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'ecmascript' },
          target: 'es2022',
        },
        module: { type: 'commonjs' },
      },
    ],
  },
  transformIgnorePatterns: [],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@truefoundry/trueforge-core/core/(.*)$': '<rootDir>/../trueforge-core/src/core/$1',
    '^@truefoundry/trueforge-core/core$': '<rootDir>/../trueforge-core/src/core/index.ts',
    '^@truefoundry/trueforge-core$': '<rootDir>/../trueforge-core/src/index.ts',
  },
  testTimeout: 120_000,
  maxWorkers: '50%',
  roots: ['<rootDir>/test'],
  testMatch: ['**/test/**/*.test.ts'],
};

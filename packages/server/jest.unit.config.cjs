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
    // Vercel AI SDK and provider packages ship as ESM — compile them to CJS for Jest.
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
  // pnpm stores packages under node_modules/.pnpm/; AI SDK + transitive deps ship as ESM.
  transformIgnorePatterns: [],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@truefoundry/utils/agent-session$': '<rootDir>/../harness/src/agent-session/index.ts',
    '^@truefoundry/utils/agent-session/(.*)$': '<rootDir>/../harness/src/agent-session/$1',
    '^@truefoundry/utils/request-reply$': '<rootDir>/../harness/src/request-reply/index.ts',
    '^@truefoundry/utils/request-reply/(.*)$': '<rootDir>/../harness/src/request-reply/$1',
    '^@truefoundry/utils/core$': '<rootDir>/../harness/src/core/index.ts',
    '^@truefoundry/utils/core/(.*)$': '<rootDir>/../harness/src/core/$1',
  },
  testTimeout: 30_000,
  maxWorkers: '50%',
  roots: ['<rootDir>/tests/unit'],
  testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
};

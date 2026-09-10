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
    '^@truefoundry/trueforge-sdk$': '<rootDir>/../trueforge-sdk/src/index.ts',
    '^@truefoundry/trueforge-core/agent-session$': '<rootDir>/../trueforge-core/src/agent-session/index.ts',
    '^@truefoundry/trueforge-core/agent-session/(.*)$': '<rootDir>/../trueforge-core/src/agent-session/$1',
    '^@truefoundry/trueforge-core/request-reply$': '<rootDir>/../trueforge-core/src/request-reply/index.ts',
    '^@truefoundry/trueforge-core/request-reply/(.*)$': '<rootDir>/../trueforge-core/src/request-reply/$1',
    '^@truefoundry/trueforge-core/core$': '<rootDir>/../trueforge-core/src/core/index.ts',
    '^@truefoundry/trueforge-core/core/(.*)$': '<rootDir>/../trueforge-core/src/core/$1',
  },
  testTimeout: 30_000,
  maxWorkers: '50%',
  roots: ['<rootDir>/tests/unit'],
  testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
  // SRT contract suites need a real host sandbox; run via `pnpm test:local-sandbox:contract`.
  testPathIgnorePatterns: ['contract\\.test\\.ts$'],
};

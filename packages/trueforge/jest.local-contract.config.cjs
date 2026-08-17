/** @type {import('jest').Config} */
const unit = require('./jest.unit.config.cjs');

module.exports = {
  ...unit,
  testPathIgnorePatterns: [],
  testMatch: ['<rootDir>/tests/unit/sandbox/local/**/*.contract.test.ts'],
  testTimeout: 120_000,
  maxWorkers: 1,
};

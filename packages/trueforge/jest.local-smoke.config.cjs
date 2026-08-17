/** @type {import('jest').Config} */
const unit = require('./jest.unit.config.cjs');

module.exports = {
  ...unit,
  roots: ['<rootDir>/tests/sandbox/local'],
  testMatch: ['<rootDir>/tests/sandbox/local/smoke.test.ts'],
  testTimeout: 120_000,
  maxWorkers: 1,
};

/**
 * jest.config.e2e.js
 *
 * Jest configuration used exclusively by the Detox E2E runner (Detox 20.x).
 * This file is referenced by .detoxrc.js testRunner.args.config.
 *
 * Detox 20 migration notes:
 *   - testEnvironment → detox/runners/jest/testEnvironment (directory, not streamlineReporter)
 *   - reporters       → detox/runners/jest/reporter (not streamlineReporter)
 *   - testRunner      → jest-circus/runner (required by Detox 20)
 *   - streamlineReporter is DEPRECATED in Detox 20 and must NOT be used
 */
/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  rootDir: '.',
  testMatch: ['<rootDir>/tests/e2e/**/*.e2e.ts'],
  testTimeout: 120_000,
  maxWorkers: 1, // Detox requires serial (single-worker) execution

  // ── Detox 20 required runner ───────────────────────────────────────────────
  testRunner: 'jest-circus/runner',

  // ── Detox 20 environment (replaces deprecated streamlineReporter setup) ─────
  testEnvironment: 'detox/runners/jest/testEnvironment',

  // ── Detox 20 lifecycle hooks ───────────────────────────────────────────────
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',

  // ── TypeScript transform ───────────────────────────────────────────────────
  transform: {
    '^.+\\.(ts|tsx)$': 'babel-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],

  // ── Reporters ─────────────────────────────────────────────────────────────
  // detox/runners/jest/reporter is the Detox 20 replacement for streamlineReporter
  reporters: [
    'detox/runners/jest/reporter',
  ],

  // ── Exclusions ──────────────────────────────────────────────────────────────
  // Prevent jest-haste-map from scanning deployment infrastructure folders.
  // Lambda package.json and S3 JSON configs are not Node/RN packages.
  modulePathIgnorePatterns: [
    '<rootDir>/deploy',
    '<rootDir>/node_modules',
  ],
  watchPathIgnorePatterns: [
    '<rootDir>/deploy',
    '<rootDir>/node_modules',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/deploy/',
    '<rootDir>/android/',
    '<rootDir>/ios/',
  ],

  verbose: true,
};

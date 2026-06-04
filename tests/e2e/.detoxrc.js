/**
 * tests/e2e/.detoxrc.js
 *
 * Extends the root .detoxrc.js. This file exists so that Detox CLI
 * invocations from the tests/e2e directory also resolve correctly.
 * The authoritative config lives at the project root.
 */
const rootConfig = require('../../.detoxrc.js');

module.exports = rootConfig;

#!/usr/bin/env node
'use strict';

// Must run before anything requires playwright-core: on Android the browser
// registry resolves its cache directory at import time and throws.
const { applyEnvDefaults } = require('../src/termux');
applyEnvDefaults();

const { run } = require('../src/cli');

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });

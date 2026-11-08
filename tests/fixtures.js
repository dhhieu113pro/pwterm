'use strict';

// Test fixtures with stealth browser defaults.
//
// playwright.config.js injects the stealth launch flags/UA; this module
// extends the `context` fixture so the stealth init script runs in every
// page, including ones the runner spawns directly.
//
// In specs, import from here instead of '@playwright/test':
//   const { test, expect } = require('./fixtures');
// `test.expect` works too (Playwright attaches expect to the test object).

const base = require('@playwright/test');
const stealth = require('../src/stealth');

const test = base.test.extend({
  context: async ({ context }, use) => {
    if (stealth.enabled()) {
      await context.addInitScript(stealth.INIT_SCRIPT);
    }
    await use(context);
  },
});

module.exports = { test, expect: base.expect, stealth };

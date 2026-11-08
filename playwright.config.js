require('dotenv/config');
const { defineConfig } = require('@playwright/test');
const stealth = require('./src/stealth');
const { findChromium } = require('./src/termux');

const executablePath = process.env.CHROMIUM_PATH || findChromium();
const baseArgs = ['--no-sandbox', '--disable-gpu'];

// Stealth launch flags/UA for the test runner; the per-context init script
// comes from tests/fixtures.js. PWTERM_NO_STEALTH=1 turns it all off.
const stealthLaunch = stealth.enabled()
  ? stealth.launchOptions({ args: baseArgs, headless: true, executablePath })
  : { args: baseArgs };

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    headless: true,
    // Termux has no Playwright-managed browsers: use system Chromium.
    launchOptions: {
      executablePath,
      args: stealthLaunch.args,
      ...(stealthLaunch.ignoreDefaultArgs
        ? { ignoreDefaultArgs: stealthLaunch.ignoreDefaultArgs }
        : {}),
    },
  },
});

'use strict';

const { chromium } = require('playwright-core');

const { findChromium } = require('./termux');
const { UserError } = require('./util');

const DEFAULT_ARGS = ['--no-sandbox', '--disable-gpu'];

async function launch(options = {}) {
  const executablePath = options.executablePath || findChromium();
  if (!executablePath) {
    throw new UserError(
      [
        'Chromium not found.',
        'Install it in Termux:  pkg install x11-repo && pkg install chromium',
        'Then either add it to PATH or set CHROMIUM_PATH in .env / the environment.',
      ].join('\n')
    );
  }

  return chromium.launch({
    executablePath,
    headless: options.headless !== false,
    args: [...DEFAULT_ARGS, ...(options.args || [])],
  });
}

async function withBrowser(options, fn) {
  const browser = await launch(options);
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { launch, withBrowser };

'use strict';

const { chromium } = require('playwright-core');

const { findChromium } = require('./termux');
const stealth = require('./stealth');
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

  // Stealth is on by default (PWTERM_NO_STEALTH=1 or stealth:false opts out).
  const useStealth = stealth.enabled(options);
  // stealth.launchOptions already composes the caller's args; when stealth
  // is off, fall back to them directly.
  const extra = useStealth
    ? stealth.launchOptions({ ...options, executablePath })
    : { args: options.args || [] };

  const browser = await chromium.launch({
    executablePath,
    headless: options.headless !== false,
    args: [...DEFAULT_ARGS, ...extra.args],
    ...(extra.ignoreDefaultArgs ? { ignoreDefaultArgs: extra.ignoreDefaultArgs } : {}),
  });

  if (useStealth) stealth.harden(browser);

  return browser;
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

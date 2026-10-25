'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const isTermux =
  process.platform === 'android' ||
  (process.env.PREFIX || '').includes('com.termux');

// Runs before playwright-core is required: its registry resolves the browser
// cache directory at import time, and on Android that path throws.
function applyEnvDefaults() {
  if (isTermux && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
  }
  if (!process.env.PWTERM_HOME) {
    process.env.PWTERM_HOME = path.join(os.homedir(), '.pwterm');
  }
}

function which(bin) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not here, keep looking
    }
  }
  return null;
}

const CHROMIUM_NAMES = [
  'chromium-browser',
  'chromium',
  'chromium-browser-stable',
  'google-chrome',
  'chrome',
];

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  for (const name of CHROMIUM_NAMES) {
    const found = which(name);
    if (found) return found;
  }
  if (isTermux && process.env.PREFIX) {
    for (const name of CHROMIUM_NAMES) {
      const candidate = path.join(process.env.PREFIX, 'bin', name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function stateDir() {
  return process.env.PWTERM_HOME || path.join(os.homedir(), '.pwterm');
}

module.exports = {
  applyEnvDefaults,
  findChromium,
  isTermux,
  stateDir,
  which,
};

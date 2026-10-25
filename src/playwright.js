'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { UserError } = require('./util');

// Walk up from the project directory so `pwterm test` works wherever it is run.
function findTestCli(start = process.cwd()) {
  let dir = start;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', '@playwright', 'test', 'cli.js');
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function runPlaywright(subcommand, args) {
  const cli = findTestCli();
  if (!cli) {
    throw new UserError(
      '@playwright/test is not installed in this project. Run: npm i -D @playwright/test'
    );
  }

  const env = { ...process.env };
  if (!env.PLAYWRIGHT_BROWSERS_PATH) env.PLAYWRIGHT_BROWSERS_PATH = '0';

  const result = spawnSync(process.execPath, [cli, subcommand, ...args], {
    stdio: 'inherit',
    env,
  });

  return result.status ?? 1;
}

const runTest = (args) => runPlaywright('test', args);
const runReport = (args) => runPlaywright('show-report', args);

module.exports = { findTestCli, runReport, runTest };

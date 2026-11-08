'use strict';

const fs = require('fs');

const { launch } = require('./browser');
const stealth = require('./stealth');
const c = require('./style');
const { findChromium, isTermux } = require('./termux');
const { formatMs } = require('./util');

async function doctor() {
  const rows = [];
  const add = (name, ok, detail, hint) => rows.push({ name, ok, detail, hint });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 18, process.version, 'pwterm needs Node 18 or newer');
  add(
    'platform',
    true,
    isTermux ? 'Termux / Android' : `${process.platform} (not Termux)`
  );

  const chromium = findChromium();
  add(
    'chromium',
    Boolean(chromium),
    chromium || 'not found',
    'pkg install x11-repo && pkg install chromium  (or set CHROMIUM_PATH)'
  );

  add(
    'CHROMIUM_PATH',
    Boolean(process.env.CHROMIUM_PATH) || Boolean(chromium),
    process.env.CHROMIUM_PATH || `(unset, autodetected ${chromium || 'none'})`,
    'set CHROMIUM_PATH in .env if autodetection picks the wrong binary'
  );

  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  add(
    'PLAYWRIGHT_BROWSERS_PATH',
    browsersPath === '0',
    browsersPath || '(unset)',
    'On Termux this must be 0 — pwterm sets it automatically'
  );

  const shimPath = process.env.PREFIX ? `${process.env.PREFIX}/bin/pwterm` : null;
  const hasShim = Boolean(shimPath && fs.existsSync(shimPath));

  const hasEnv = fs.existsSync('/usr/bin/env');
  add(
    '/usr/bin/env',
    hasEnv || hasShim,
    hasEnv ? 'present' : hasShim ? 'missing (pwterm shim in place)' : 'missing',
    'npm bin shims need termux-exec in LD_PRELOAD, or the pwterm wrapper'
  );

  const preload = process.env.LD_PRELOAD || '';
  const hasTermuxExec = preload.includes('libtermux-exec');
  add(
    'termux-exec',
    hasTermuxExec || hasEnv || hasShim,
    hasTermuxExec ? 'loaded in LD_PRELOAD' : hasEnv ? 'not needed' : hasShim ? 'not needed (pwterm shim)' : 'not loaded',
    'add to ~/.bashrc:  export LD_PRELOAD="$PREFIX/lib/libtermux-exec.so"'
  );

  add(
    'pwterm shim',
    hasShim,
    hasShim ? shimPath : 'not installed (run: npm install -g .)'
  );

  add(
    'display',
    true,
    process.env.DISPLAY || '(none — headless only)'
  );

  add(
    'stealth',
    true,
    stealth.enabled() ? 'on — automation tells patched (flags + init script)' : 'off (PWTERM_NO_STEALTH)'
  );

  let launchError = null;
  let launched = null;
  if (chromium) {
    const started = Date.now();
    try {
      const browser = await launch({ headless: true });
      launched = { version: browser.version(), ms: Date.now() - started };
      await browser.close();
    } catch (err) {
      launchError = err;
    }
  }

  console.log(c.bold('pwterm doctor') + '\n');
  for (const row of rows) {
    const mark = row.ok ? c.green('✔') : c.yellow('!');
    console.log(`${mark} ${row.name.padEnd(26)} ${c.dim(row.detail || '')}`);
    if (!row.ok && row.hint) console.log(`  ${c.dim(row.hint)}`);
  }

  console.log('');
  if (launched) {
    console.log(
      `${c.green('✔')} ${'browser launch'.padEnd(26)} ${c.dim(`Chromium ${launched.version} in ${formatMs(launched.ms)}`)}`
    );
  } else if (launchError) {
    console.log(`${c.red('✖')} ${'browser launch'.padEnd(26)} ${c.dim('failed')}`);
    console.log(`  ${c.dim(launchError.message.split('\n').slice(0, 6).join('\n  '))}`);
  } else {
    console.log(`${c.red('✖')} ${'browser launch'.padEnd(26)} ${c.dim('skipped (no Chromium)')}`);
  }

  const criticalOk = Boolean(launched);
  console.log('');
  console.log(
    criticalOk
      ? c.green('ready — try: pwterm run examples/login.yaml')
      : c.yellow('not ready — fix the items marked with "!" above')
  );

  return criticalOk ? 0 : 1;
}

module.exports = { doctor };

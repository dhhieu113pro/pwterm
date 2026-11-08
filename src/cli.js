'use strict';

const path = require('path');

const { launch } = require('./browser');
const { doctor } = require('./doctor');
const { FlowError, runFlow } = require('./flow');
const { runReport, runTest } = require('./playwright');
const { startRepl } = require('./repl');
const c = require('./style');
const { UserError, formatMs, parseVars, resolvePath, shortErr } = require('./util');

const VERSION = require('../package.json').version;

const HELP = `
${c.bold('pwterm')} — Playwright automation on Termux (system Chromium, no downloads)

${c.bold('usage')}
  pwterm run <flow.yaml>          run a YAML/JSON flow
  pwterm open                     interactive shell with a warm browser
  pwterm shot <url> [file]        screenshot (or PDF) of a page
  pwterm test [args...]           pass through to @playwright/test
  pwterm report                   serve the last HTML report
  pwterm doctor                   check Chromium, env and launch
  pwterm --version | help

${c.bold('options')}
  --headed            show the browser (needs Termux:X11 + DISPLAY)
  --no-stealth        launch stock Chromium (stealth patches are on by default)
  --var key=value     set a flow variable (repeatable)
  --timeout <ms>      override the default timeout
  --full-page         shot: capture the whole page
  --quiet, -q         step-less output for run
`;

function parseOptions(argv) {
  const opts = { _: [], vars: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      opts._.push(...argv.slice(index + 1));
      break;
    }
    if (arg === '--headed') opts.headed = true;
    else if (arg === '--no-stealth') opts.stealth = false;
    else if (arg === '--quiet' || arg === '-q') opts.quiet = true;
    else if (arg === '--full-page') opts.fullPage = true;
    else if (arg === '--no-fail-shot') opts.failShot = false;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '-v' || arg === '--version') opts.version = true;
    else if (arg === '--timeout') {
      opts.timeout = Number(argv[++index]);
      if (!Number.isFinite(opts.timeout)) throw new UserError('--timeout expects milliseconds');
    } else if (arg.startsWith('--var=')) {
      Object.assign(opts.vars, parseVars([arg.slice('--var='.length)]));
    } else if (arg === '--var') {
      const pair = argv[++index];
      if (!pair) throw new UserError('--var expects key=value');
      Object.assign(opts.vars, parseVars([pair]));
    } else if (arg === '--wait-for') {
      opts.waitFor = argv[++index];
      if (!opts.waitFor) throw new UserError('--wait-for expects a selector');
    } else if (arg.startsWith('-')) {
      throw new UserError(`unknown option: ${arg}`);
    } else {
      opts._.push(arg);
    }
  }
  return opts;
}

async function shot(opts) {
  const [url, out] = opts._;
  if (!url) throw new UserError('usage: pwterm shot <url> [file.png|file.pdf] [--full-page]');

  const target = resolvePath(out || `pwterm-${Date.now()}.png`);
  const isPdf = /\.pdf$/i.test(target);
  if (isPdf && opts.headed) throw new UserError('PDF export only works headless');

  const browser = await launch({ headless: !opts.headed, stealth: opts.stealth });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load' });
    if (opts.waitFor) await page.locator(opts.waitFor).first().waitFor({ state: 'visible' });

    if (isPdf) {
      await page.pdf({ path: target, printBackground: true });
    } else {
      await page.screenshot({ path: target, fullPage: Boolean(opts.fullPage) });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(`${c.green('✔')} saved ${target}`);
  return 0;
}

async function main(argv) {
  // Pass everything through untouched for the Playwright test runner, so
  // `pwterm test --version` is Playwright's flag, not ours.
  if (argv[0] === 'test') return runTest(argv.slice(1));
  if (argv[0] === 'report') return runReport(argv.slice(1));

  const opts = parseOptions(argv);

  if (opts.version) {
    console.log(VERSION);
    return 0;
  }

  const command = opts._.shift();
  if (!command || command === 'help' || opts.help) {
    console.log(HELP);
    return 0;
  }

  switch (command) {
    case 'run': {
      const file = opts._[0];
      if (!file) throw new UserError('usage: pwterm run <flow.yaml> [--headed] [--var key=value]');

      try {
        const result = await runFlow(file, opts);
        console.log(
          `${c.green('✔')} ${path.basename(file)} — ${result.steps} steps in ${formatMs(result.duration)}`
        );
      } catch (err) {
        if (!(err instanceof FlowError)) throw err;
        console.error(`${c.red('✖')} ${err.message}`);
        if (err.screenshot) console.error(c.dim(`  screenshot: ${err.screenshot}`));
        return 1;
      }
      return 0;
    }

    case 'open':
      await startRepl(opts);
      return 0;

    case 'shot':
      return shot(opts);

    case 'doctor':
      return doctor();

    default:
      throw new UserError(`unknown command "${command}" (run "pwterm help")`);
  }
}

async function run(argv) {
  try {
    return await main(argv);
  } catch (err) {
    if (err instanceof UserError) {
      console.error(c.red('error: ') + err.message);
      return 2;
    }
    console.error(c.red('error: ') + shortErr(err));
    if (process.env.PWTERM_DEBUG) console.error(err.stack);
    return 1;
  }
}

module.exports = { run };

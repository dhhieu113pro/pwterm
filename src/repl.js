'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const YAML = require('yaml');

const { launch } = require('./browser');
const c = require('./style');
const {
  UserError,
  formatMs,
  resolvePath,
  shortErr,
  splitArgs,
} = require('./util');

const HELP = `
${c.bold('browser')}
  goto <url>              navigate (recorded)
  reload                  reload the page (recorded)
  back                    go back in history (recorded)
  viewport <w> <h>        resize the viewport (recorded)
  close                   close the browser session

${c.bold('actions')}
  click <selector>                        (recorded)
  fill <selector> <value>                 (recorded)
  type <selector> <value>                 like a human, key by key (recorded)
  press <key>                             e.g. Enter, Tab, Control+A (recorded)
  check <selector> / uncheck <selector>   (recorded)
  select <selector> <value>               (recorded)
  scroll <y>                              (recorded)
  wait <ms>                               (recorded)
  shot [file.png]                         full-page screenshot (recorded)

${c.bold('inspect')}
  title                   page title
  url                     current URL
  text [selector]         inner text (defaults to body)
  eval <js>               evaluate an expression and print the result

${c.bold('recording')}
  steps                   print recorded steps as YAML
  save [file.yaml]        write the recorded steps to a flow file

${c.bold('other')}
  help / quit

Selectors use Playwright syntax: "#id", "text=Log in", "a:has-text('Log out')".
`;

function requiresDisplay(headless) {
  if (!headless && !process.env.DISPLAY) {
    throw new UserError(
      'Headed mode needs an X display. Start Termux:X11 and export DISPLAY (for example DISPLAY=:0).'
    );
  }
}

async function startRepl(options = {}) {
  const headless = !options.headed;
  requiresDisplay(headless);

  const session = {
    browser: null,
    context: null,
    page: null,
    recorded: [],
  };

  async function ensurePage() {
    if (session.page && !session.page.isClosed()) return session.page;
    if (!session.browser || !session.browser.isConnected()) {
      session.browser = await launch({ headless, stealth: options.stealth });
      session.context = await session.browser.newContext({});
    }
    session.page = await session.context.newPage();
    session.page.setDefaultTimeout(30000);
    return session.page;
  }

  function record(step) {
    session.recorded.push(step);
    console.log(c.dim(`  + ${JSON.stringify(step)}`));
  }

  function save(file) {
    const target = resolvePath(file);
    const doc = {
      name: path.basename(target).replace(/\.ya?ml$/i, ''),
      steps: session.recorded,
    };
    fs.writeFileSync(target, YAML.stringify(doc));
    console.log(c.green('✔') + ` saved ${session.recorded.length} step(s) to ${target}`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
    prompt: c.cyan('pw> '),
  });

  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    rl.close();
    if (session.browser) await session.browser.close().catch(() => {});
  }

  rl.on('SIGINT', () => {
    process.stdout.write('\n');
    shutdown();
  });

  async function handle(line) {
    const parts = splitArgs(line);
    const command = parts[0];
    const args = parts.slice(1);

    switch (command) {
      case 'help':
        console.log(HELP);
        return false;

      case 'quit':
      case 'exit':
        return true;

      case 'close':
        if (session.browser) await session.browser.close().catch(() => {});
        session.browser = null;
        session.context = null;
        session.page = null;
        console.log(c.dim('session closed'));
        return false;

      case 'goto': {
        if (!args[0]) throw new UserError('usage: goto <url>');
        const page = await ensurePage();
        await page.goto(args[0]);
        record({ goto: args[0] });
        console.log(c.dim(`  ${page.url()}`));
        return false;
      }

      case 'reload': {
        const page = await ensurePage();
        await page.reload();
        record({ reload: true });
        return false;
      }

      case 'back': {
        const page = await ensurePage();
        await page.goBack();
        record({ goBack: true });
        console.log(c.dim(`  ${page.url()}`));
        return false;
      }

      case 'viewport': {
        if (!args[0] || !args[1]) throw new UserError('usage: viewport <width> <height>');
        const page = await ensurePage();
        await page.setViewportSize({ width: Number(args[0]), height: Number(args[1]) });
        record({ setViewport: { width: Number(args[0]), height: Number(args[1]) } });
        return false;
      }

      case 'click': {
        if (!args[0]) throw new UserError('usage: click <selector>');
        const page = await ensurePage();
        await page.locator(args[0]).first().click();
        record({ click: args[0] });
        return false;
      }

      case 'fill':
      case 'type': {
        if (args.length < 2) throw new UserError(`usage: ${command} <selector> <value>`);
        const selector = args[0];
        const value = args.slice(1).join(' ');
        const page = await ensurePage();
        const locator = page.locator(selector).first();
        if (command === 'fill') await locator.fill(value);
        else await locator.pressSequentially(value);
        record({ [command]: { selector, value } });
        return false;
      }

      case 'press': {
        if (!args[0]) throw new UserError('usage: press <key>');
        const page = await ensurePage();
        await page.keyboard.press(args[0]);
        record({ press: args[0] });
        return false;
      }

      case 'check':
      case 'uncheck': {
        if (!args[0]) throw new UserError(`usage: ${command} <selector>`);
        const page = await ensurePage();
        await page.locator(args[0]).first()[command]();
        record({ [command]: args[0] });
        return false;
      }

      case 'select': {
        if (args.length < 2) throw new UserError('usage: select <selector> <value>');
        const selector = args[0];
        const value = args.slice(1).join(' ');
        const page = await ensurePage();
        await page.locator(selector).first().selectOption(value);
        record({ select: { selector, value } });
        return false;
      }

      case 'scroll': {
        const y = Number(args[0] || 0);
        const page = await ensurePage();
        await page.evaluate((offset) => window.scrollBy(0, offset), y);
        record({ scroll: { y } });
        return false;
      }

      case 'wait': {
        const ms = Number(args[0]);
        if (!Number.isFinite(ms)) throw new UserError('usage: wait <milliseconds>');
        const page = await ensurePage();
        await page.waitForTimeout(ms);
        record({ wait: ms });
        return false;
      }

      case 'shot': {
        const file = args[0] || `screenshot-${Date.now()}.png`;
        const target = resolvePath(file);
        const page = await ensurePage();
        const started = Date.now();
        await page.screenshot({ path: target, fullPage: true });
        record({ screenshot: { path: file, fullPage: true } });
        console.log(c.dim(`  -> ${target} (${formatMs(Date.now() - started)})`));
        return false;
      }

      case 'title': {
        const page = await ensurePage();
        console.log(await page.title());
        return false;
      }

      case 'url': {
        const page = await ensurePage();
        console.log(page.url() || c.dim('(blank)'));
        return false;
      }

      case 'text': {
        const page = await ensurePage();
        const selector = args.join(' ') || 'body';
        const text = await page.locator(selector).first().innerText();
        console.log(text.trim());
        return false;
      }

      case 'eval': {
        const expression = args.join(' ');
        if (!expression) throw new UserError('usage: eval <javascript>');
        const page = await ensurePage();
        const result = await page.evaluate(expression);
        console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
        return false;
      }

      case 'steps': {
        if (session.recorded.length === 0) {
          console.log(c.dim('nothing recorded yet'));
          return false;
        }
        console.log(YAML.stringify({ steps: session.recorded }));
        return false;
      }

      case 'save': {
        if (session.recorded.length === 0) throw new UserError('nothing recorded yet');
        save(args[0] || `flow-${Date.now()}.yaml`);
        return false;
      }

      default:
        throw new UserError(`unknown command "${command}" (type "help")`);
    }
  }

  console.log(c.bold('pwterm') + c.dim(' interactive — "help" for commands, "save flow.yaml" to export'));
  if (process.stdin.isTTY) rl.prompt();

  try {
    for await (const line of rl) {
      const text = line.trim();
      if (text && !text.startsWith('#')) {
        try {
          if (await handle(text)) break;
        } catch (err) {
          console.error(c.red('error: ') + shortErr(err));
        }
      }
      if (process.stdin.isTTY) rl.prompt();
    }
  } finally {
    await shutdown();
  }
}

module.exports = { startRepl };

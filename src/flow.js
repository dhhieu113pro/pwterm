'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const { launch } = require('./browser');
const c = require('./style');
const {
  UserError,
  ensureDir,
  formatMs,
  parseRegex,
  resolvePath,
  shortErr,
  template,
} = require('./util');

class FlowError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FlowError';
    this.step = details.step;
    this.screenshot = details.screenshot;
  }
}

function selectorOf(value, action) {
  const selector = typeof value === 'string' ? value : value && value.selector;
  if (!selector) throw new UserError(`${action} needs a selector`);
  return selector;
}

function pairOf(value, action) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UserError(`${action} needs { selector, value }`);
  }
  const raw = value.value ?? value.text;
  if (value.selector == null || raw == null) {
    throw new UserError(`${action} needs both selector and value`);
  }
  return { selector: value.selector, value: raw };
}

function mismatch(label, expected, actual) {
  return new Error(
    `${label} mismatch\n  expected: ${expected}\n  actual:   ${JSON.stringify(actual)}`
  );
}

function checkText(actual, spec, label) {
  const text = String(actual).trim();

  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    if (spec.contains != null) {
      if (!text.includes(String(spec.contains))) throw mismatch(label, `containing ${JSON.stringify(spec.contains)}`, text);
      return;
    }
    if (spec.regex != null) {
      if (!new RegExp(spec.regex, spec.flags || '').test(text)) throw mismatch(label, `matching /${spec.regex}/${spec.flags || ''}`, text);
      return;
    }
    const expected = spec.equals ?? spec.text;
    if (expected != null) {
      if (text !== String(expected).trim()) throw mismatch(label, JSON.stringify(expected), text);
      return;
    }
    throw new UserError(`${label}: expected a string, or an object with contains/equals/regex`);
  }

  const regex = parseRegex(spec);
  if (regex) {
    if (!regex.test(text)) throw mismatch(label, String(spec), text);
    return;
  }
  if (text !== String(spec).trim()) throw mismatch(label, JSON.stringify(spec), text);
}

function checkUrl(actual, spec) {
  const value = spec && typeof spec === 'object' ? (spec.regex ?? spec.url) : spec;
  if (value == null) throw new UserError('expectUrl needs a URL or a regex');

  const regex = spec && typeof spec === 'object' && spec.regex != null
    ? new RegExp(spec.regex, spec.flags || '')
    : parseRegex(value);

  if (regex) {
    if (!regex.test(actual)) throw mismatch('URL', `matching ${value}`, actual);
    return;
  }
  if (!actual.includes(String(value))) throw mismatch('URL', `containing ${JSON.stringify(value)}`, actual);
}

const actions = {
  async goto(ctx, value) {
    const opts = typeof value === 'string' ? { url: value } : value || {};
    const url = template(opts.url, ctx.vars);
    if (!url) throw new UserError('goto needs a url');
    await ctx.page.goto(url, {
      waitUntil: opts.waitUntil || ctx.waitUntil,
      timeout: opts.timeout,
    });
  },

  async click(ctx, value) {
    const selector = template(selectorOf(value, 'click'), ctx.vars);
    await ctx.page.locator(selector).first().click();
  },

  async fill(ctx, value) {
    const { selector, value: raw } = pairOf(value, 'fill');
    await ctx.page
      .locator(template(selector, ctx.vars))
      .first()
      .fill(template(String(raw), ctx.vars));
  },

  async type(ctx, value) {
    const { selector, value: raw } = pairOf(value, 'type');
    await ctx.page
      .locator(template(selector, ctx.vars))
      .first()
      .pressSequentially(template(String(raw), ctx.vars), { delay: value.delay || 0 });
  },

  async press(ctx, value) {
    if (typeof value === 'string') {
      await ctx.page.keyboard.press(template(value, ctx.vars));
      return;
    }
    const key = template(String(value.key), ctx.vars);
    if (value.selector) {
      await ctx.page.locator(template(value.selector, ctx.vars)).first().press(key);
    } else {
      await ctx.page.keyboard.press(key);
    }
  },

  async upload(ctx, value) {
    const files = value && value.files != null ? value.files : value && value.value;
    if (!value || !value.selector || !files) throw new UserError('upload needs { selector, files }');
    const list = (Array.isArray(files) ? files : [files]).map((file) =>
      resolvePath(template(String(file), ctx.vars))
    );
    await ctx.page.locator(template(value.selector, ctx.vars)).first().setInputFiles(list);
  },

  async wait(ctx, value) {
    const ms = Number(template(String(value), ctx.vars));
    if (!Number.isFinite(ms)) throw new UserError(`wait needs milliseconds, got "${value}"`);
    await ctx.page.waitForTimeout(ms);
  },

  async waitFor(ctx, value) {
    const opts = typeof value === 'string' ? { selector: value } : value || {};
    if (!opts.selector) throw new UserError('waitFor needs a selector');
    await ctx.page.locator(template(opts.selector, ctx.vars)).first().waitFor({
      state: opts.state || 'visible',
      timeout: opts.timeout,
    });
  },

  async waitForUrl(ctx, value) {
    const opts = typeof value === 'string' ? { url: value } : value || {};
    const raw = template(opts.url, ctx.vars);
    if (!raw) throw new UserError('waitForUrl needs a url or regex');
    await ctx.page.waitForURL(parseRegex(raw) || raw, {
      timeout: opts.timeout,
      waitUntil: opts.waitUntil,
    });
  },

  async expectText(ctx, value) {
    const opts = typeof value === 'object' && value !== null ? value : { text: value };
    const selector = opts.selector ? template(opts.selector, ctx.vars) : 'body';
    const actual = (await ctx.page.locator(selector).first().innerText()).trim();
    checkText(actual, opts, `Text of ${selector}`);
  },

  async expectTitle(ctx, value) {
    checkText(await ctx.page.title(), value, 'Title');
  },

  async expectUrl(ctx, value) {
    checkUrl(ctx.page.url(), value);
  },

  async expectVisible(ctx, value) {
    const selector = template(selectorOf(value, 'expectVisible'), ctx.vars);
    await ctx.page.locator(selector).first().waitFor({ state: 'visible' });
  },

  async expectHidden(ctx, value) {
    const selector = template(selectorOf(value, 'expectHidden'), ctx.vars);
    await ctx.page.locator(selector).first().waitFor({ state: 'hidden' });
  },

  async screenshot(ctx, value) {
    const opts = typeof value === 'string' ? { path: value } : value || {};
    if (!opts.path) throw new UserError('screenshot needs a path');
    const target = resolvePath(template(opts.path, ctx.vars));
    if (opts.selector) {
      await ctx.page.locator(template(opts.selector, ctx.vars)).first().screenshot({ path: target });
    } else {
      await ctx.page.screenshot({ path: target, fullPage: Boolean(opts.fullPage) });
    }
    ctx.output(`screenshot -> ${target}`);
  },

  async pdf(ctx, value) {
    if (!ctx.headless) throw new UserError('pdf only works headless');
    const opts = typeof value === 'string' ? { path: value } : value || {};
    if (!opts.path) throw new UserError('pdf needs a path');
    const target = resolvePath(template(opts.path, ctx.vars));
    await ctx.page.pdf({
      path: target,
      format: opts.format,
      printBackground: opts.printBackground !== false,
    });
    ctx.output(`pdf -> ${target}`);
  },

  async eval(ctx, value) {
    const expression = template(String(value), ctx.vars);
    const result = await ctx.page.evaluate(expression);
    ctx.output(`eval -> ${JSON.stringify(result)}`);
  },

  async select(ctx, value) {
    const { selector, value: raw } = pairOf(value, 'select');
    await ctx.page
      .locator(template(selector, ctx.vars))
      .first()
      .selectOption(template(String(raw), ctx.vars));
  },

  async check(ctx, value) {
    await ctx.page.locator(template(selectorOf(value, 'check'), ctx.vars)).first().check();
  },

  async uncheck(ctx, value) {
    await ctx.page.locator(template(selectorOf(value, 'uncheck'), ctx.vars)).first().uncheck();
  },

  async scroll(ctx, value) {
    const opts = typeof value === 'number' ? { y: value } : value || {};
    await ctx.page.evaluate(
      ([x, y]) => window.scrollBy(x, y),
      [Number(opts.x || 0), Number(opts.y || 0)]
    );
  },

  async setViewport(ctx, value) {
    if (!value || !value.width || !value.height) {
      throw new UserError('setViewport needs { width, height }');
    }
    await ctx.page.setViewportSize({ width: Number(value.width), height: Number(value.height) });
  },

  async reload(ctx) {
    await ctx.page.reload({ waitUntil: ctx.waitUntil });
  },

  async goBack(ctx) {
    await ctx.page.goBack({ waitUntil: ctx.waitUntil });
  },

  async log(ctx, value) {
    ctx.output(template(String(value), ctx.vars));
  },
};

const ACTIONS = new Set(Object.keys(actions));

function loadFlow(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new UserError(`Flow file not found: ${file}`);

  let doc;
  try {
    const raw = fs.readFileSync(abs, 'utf8');
    doc = /\.ya?ml$/i.test(abs) ? YAML.parse(raw) : JSON.parse(raw);
  } catch (err) {
    throw new UserError(`Cannot parse ${file}: ${err.message}`);
  }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new UserError(`Flow must be a YAML/JSON object: ${file}`);
  }
  if (!Array.isArray(doc.steps) || doc.steps.length === 0) {
    throw new UserError(`Flow needs a non-empty "steps" list: ${file}`);
  }

  return { doc, dir: path.dirname(abs), file: abs };
}

function normalizeStep(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new UserError(`Step ${index + 1}: expected a mapping like "- click: '#submit'"`);
  }
  const keys = Object.keys(raw);
  if (keys.length !== 1) {
    throw new UserError(`Step ${index + 1}: expected exactly one action, got ${keys.join(', ')}`);
  }
  const action = keys[0];
  if (!ACTIONS.has(action)) {
    throw new UserError(
      `Step ${index + 1}: unknown action "${action}" (available: ${[...ACTIONS].sort().join(', ')})`
    );
  }
  return { action, value: raw[action], line: index + 1 };
}

async function captureFailure(page, flowFile) {
  const dir = ensureDir(path.join(process.cwd(), 'pwterm-failures'));
  const base = path.basename(flowFile).replace(/\.(ya?ml|json)$/i, '');
  const target = path.join(dir, `${base}-${Date.now()}.png`);
  await page.screenshot({ path: target, fullPage: true });
  return target;
}

async function runFlow(file, options = {}) {
  const { doc, file: abs } = loadFlow(file);
  const steps = doc.steps.map(normalizeStep);

  const headless = options.headed ? false : doc.headless !== false;
  if (!headless && !process.env.DISPLAY) {
    throw new UserError(
      'Headed mode needs an X display. Start Termux:X11 and export DISPLAY (for example DISPLAY=:0).'
    );
  }

  const vars = {
    ...(doc.vars || {}),
    ...(options.vars || {}),
    env: process.env,
  };

  const timeout = Number(doc.timeout ?? options.timeout ?? 30000);
  const stateFile = doc.storageState ? resolvePath(template(doc.storageState, vars)) : null;
  if (stateFile && !fs.existsSync(stateFile)) {
    console.log(c.dim(`  note: ${stateFile} does not exist, starting with a fresh session`));
  }

  // Flow-level `stealth: false` wins over the CLI flag.
  const stealthEnabled = doc.stealth !== undefined ? Boolean(doc.stealth) : options.stealth;
  const browser = await launch({ headless, executablePath: options.executablePath, stealth: stealthEnabled });
  const context = await browser.newContext({
    baseURL: doc.baseUrl ? template(doc.baseUrl, vars) : undefined,
    viewport: doc.viewport || undefined,
    storageState: stateFile && fs.existsSync(stateFile) ? stateFile : undefined,
  });
  context.setDefaultTimeout(timeout);

  const page = await context.newPage();
  page.setDefaultTimeout(timeout);

  const ctx = {
    page,
    context,
    headless,
    vars,
    waitUntil: doc.waitUntil || 'load',
    messages: [],
    output: (message) => ctx.messages.push(message),
  };

  const started = Date.now();
  let current = null;
  let pendingLine = false;

  try {
    for (let index = 0; index < steps.length; index += 1) {
      current = steps[index];
      const label = `${String(index + 1).padStart(2)} ${current.action}`.padEnd(20);
      const stepStarted = Date.now();

      if (!options.quiet) {
        process.stdout.write(`${c.dim(label)} `);
        pendingLine = true;
      }

      await actions[current.action](ctx, current.value, current);

      if (!options.quiet) {
        process.stdout.write(`${c.green('ok')} ${c.dim(formatMs(Date.now() - stepStarted))}\n`);
        for (const message of ctx.messages.splice(0)) {
          console.log(c.dim(`     ${message}`));
        }
        pendingLine = false;
      }
    }

    if (doc.saveState) {
      const target = resolvePath(template(doc.saveState, vars));
      await context.storageState({ path: target });
      console.log(c.dim(`  state -> ${target}`));
    }
  } catch (err) {
    if (pendingLine) process.stdout.write('\n');
    for (const message of ctx.messages.splice(0)) {
      console.log(c.dim(`     ${message}`));
    }
    const screenshot = options.failShot === false || err instanceof UserError
      ? null
      : await captureFailure(page, abs).catch(() => null);

    throw new FlowError(
      `Step ${current.line} (${current.action}) failed: ${shortErr(err)}`,
      { step: current, screenshot }
    );
  } finally {
    await browser.close().catch(() => {});
  }

  return { steps: steps.length, duration: Date.now() - started };
}

module.exports = { FlowError, runFlow };

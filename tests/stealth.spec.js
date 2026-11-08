// Verifies the stealth layer: launch through pwterm's own launch() (stealth
// on by default) and evaluate the checks anti-bot pages run first.
const { test, expect } = require('@playwright/test');

const { launch } = require('../src/browser');

test('stealth: no automation tells in a page', async () => {
  const browser = await launch({ headless: true });
  const page = await (await browser.newContext({})).newPage();
  try {
    await page.goto('data:text/html,<title>stealth probe</title>');

    const checks = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('webgl');
      const dbg = ctx && ctx.getExtension('WEBGL_debug_renderer_info');
      return {
        webdriver: navigator.webdriver,
        plugins: navigator.plugins.length,
        mimeTypes: navigator.mimeTypes.length,
        pluginIsArray: navigator.plugins instanceof PluginArray,
        pluginIsPlugin: navigator.plugins[0] instanceof Plugin,
        pluginString: window.navigator.plugins[0].toString(),
        mimeIsArray: navigator.mimeTypes instanceof MimeTypeArray,
        chrome: typeof window.chrome === 'object',
        ua: navigator.userAgent,
        languages: navigator.languages.join(','),
        renderer: dbg && String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL)),
      };
    });

    const permissionOk = await page.evaluate(async () => {
      try {
        const p = await navigator.permissions.query({ name: 'notifications' });
        return Boolean(p && p.state);
      } catch {
        return false;
      }
    });

    expect(checks.webdriver, 'navigator.webdriver must read as false').toBe(false);
    expect(checks.plugins, 'plugins list must be populated').toBeGreaterThan(0);
    expect(checks.mimeTypes).toBeGreaterThan(0);
    expect(checks.pluginIsArray, 'plugins instanceof PluginArray').toBe(true);
    expect(checks.mimeIsArray, 'mimeTypes instanceof MimeTypeArray').toBe(true);
    expect(checks.pluginIsPlugin, 'plugins[0] instanceof Plugin').toBe(true);
    expect(checks.pluginString, '"[object Plugin]" toString').toBe('[object Plugin]');
    expect(checks.chrome, 'window.chrome present').toBe(true);
    expect(checks.ua, 'UA must not leak "Headless"').not.toMatch(/Headless/i);
    expect(checks.languages).not.toBe('');
    expect(permissionOk, 'permissions.query must resolve, not throw').toBe(true);
    if (checks.renderer) {
      expect(String(checks.renderer).toLowerCase()).not.toMatch(/swiftshader|llvmpipe/);
    }
  } finally {
    await browser.close();
  }
});

test('stealth: opt-out restores the stock browser', async () => {
  const browser = await launch({ headless: true, stealth: false });
  const page = await (await browser.newContext({})).newPage();
  try {
    await page.goto('data:text/html,<title>stock probe</title>');
    const ua = await page.evaluate(() => navigator.userAgent);
    expect(ua).toMatch(/Headless/);
  } finally {
    await browser.close();
  }
});

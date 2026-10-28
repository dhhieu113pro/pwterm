/* Stand-in smoke check for the Vue /settings page — to be replaced/rewritten
   by the real settings spec once the UI migration is stable. */
const { test, expect } = require('@playwright/test');

const BASE = (process.env.VIENEU_STUDIO_URL || 'http://127.0.0.1:7861')
  .replace(/\/+$/, '');

test.describe.configure({ mode: 'serial' });
let original = null;

test.beforeAll(async ({ request }) => {
  original = (await (await request.get(`${BASE}/api/defaults`)).json()).defaults;
});

test.afterAll(async ({ request }) => {
  await request.put(`${BASE}/api/defaults`, { data: original });
});

test('boots without script errors and shows the preview sentence', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      errors.push(`console: ${m.text()}`);
  });

  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#s-lang')).toBeVisible();
  await expect(page).toHaveTitle(/VieNeu/);
  const preview = (await page.locator('#preview').textContent()).trim();
  expect(preview).toMatch(/Whisper base/);
  expect(errors).toEqual([]);
  expect(await page.locator('#saveBtn').isDisabled()).toBe(true);

  await page.selectOption('#s-lang', 'ja');
  await expect(page.locator('#saveNote')).toHaveText('Unsaved changes');

  const saved = page.waitForResponse((r) =>
    r.url().includes('/api/defaults') && r.request().method() === 'PUT');
  await page.click('#saveBtn');
  expect((await saved).ok()).toBeTruthy();

  const now = await request.get(`${BASE}/api/defaults`);
  expect((await now.json()).defaults.lang).toBe('ja');
});

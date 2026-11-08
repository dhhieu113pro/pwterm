/* Stand-in smoke checks for the Vue home page — to be replaced/rewritten by
   the real gallery spec after the UI migration. */
const { test, expect } = require('./fixtures');

const BASE = (process.env.VIENEU_STUDIO_URL || 'http://127.0.0.1:7861')
  .replace(/\/+$/, '');

test.describe.configure({ mode: 'serial' });

test('boots without script errors and lists every project', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      errors.push(`console: ${m.text()}`);
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.vcard').first()).toBeVisible();

  const n = await page.locator('.vcard').count();
  expect((await page.locator('#count').textContent()).trim())
    .toBe(`${n} video${n === 1 ? '' : 's'}`);
  expect(errors).toEqual([]);
});

test('search filters the grid', async ({ page }) => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.vcard, #empty:not(.hidden)');

  const first = (await page.locator('.vcard .vtitle').first().textContent()).trim();
  await page.fill('#search', `${first.slice(0, -1)}zz`);
  await expect(page.locator('#grid')).toContainText('No video matches that search.');
  await page.fill('#search', first.slice(0, 4));
  await expect(page.locator('#grid p.hint')).toHaveCount(0);
});

test('New dubbing opens the editor; its card deletes cleanly', async ({ page }) => {
  const created = await (await page.request.post(`${BASE}/api/projects`)).json();
  // unique title so card locators can't collide with other untitled projects
  const title = `Smoke ${created.id}`;
  await page.request.patch(`${BASE}/api/projects/${created.id}`,
    { data: { title } });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.vcard');
  await page.locator(`.vcard[aria-label="Open ${title}"]`).click();
  await page.waitForURL(/\/project\//);

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.vcard');
  page.once('dialog', (d) => d.accept());
  await page.locator(`.vcard[aria-label="Open ${title}"] .vdel`).click();
  await expect(page.locator(`.vcard[aria-label="Open ${title}"]`)).toHaveCount(0);

  const res = await page.request.get(`${BASE}/api/projects`);
  expect((await res.json()).projects.some((p) => p.id === created.id)).toBe(false);
});

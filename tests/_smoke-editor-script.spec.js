/* Stand-in smoke checks for the Vue editor script editing (phase 4b):
   add cues, edit their text, delete — the debounced PUT /script round-trip.
   Uses its own throwaway project, deleted at the end. */
const { test, expect } = require('@playwright/test');

const BASE = (process.env.VIENEU_STUDIO_URL || 'http://127.0.0.1:7861')
  .replace(/\/+$/, '');

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function cuesOf(request, pid) {
  const d = await (await request.get(`${BASE}/api/projects/${pid}`)).json();
  return d.cues || [];
}

test('script editing saves through PUT /script', async ({ page, request }) => {
  const errors = watchErrors(page);
  const created = await (await request.post(`${BASE}/api/projects`)).json();
  const pid = created.id;

  // no video: timeline still works (duration falls back to 8s+)
  await page.goto(`${BASE}/project/${pid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#addCueBtn');
  expect(errors).toEqual([]);

  // add two cues
  await page.click('#addCueBtn');
  await page.waitForSelector('#cueText');
  await page.fill('#cueText', 'Зdravstvuy');   // text a
  await page.click('#addCueBtn');

  await expect.poll(async () =>
    (await cuesOf(request, pid)).map((c) => c.text).sort(),
    { timeout: 10000 }).toEqual(['New line', 'Зdravstvuy']);

  // the save indicator went back to Saved
  await expect(page.locator('#saveIndicator')).toHaveText('Saved');

  // edit via the transcript list (double-click opens the inline editor)
  await page.click('#tlMode button[data-mode="list"]');
  await page.waitForSelector('.tl-row');
  await page.dblclick('.tl-row >> nth=0');
  await page.waitForSelector('.rr-edit');
  await page.fill('.rr-edit', 'Edited line');
  await page.press('.rr-edit', 'Enter');

  await page.click('.tl-row >> nth=0');
  await expect.poll(async () =>
    (await cuesOf(request, pid)).map((c) => c.text),
    { timeout: 10000 }).toContain('Edited line');

  await page.click('#delCueBtn');
  await expect.poll(async () => (await cuesOf(request, pid)).length,
    { timeout: 10000 }).toBe(1);
  await expect(page.locator('#saveIndicator')).toHaveText('Saved');
  expect(errors).toEqual([]);

  await request.delete(`${BASE}/api/projects/${pid}`);
});

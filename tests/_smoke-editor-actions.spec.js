/* Stand-in smoke checks for the Vue editor step actions (phase 4c):
   inspector tabs, job line/gates, settings PATCH persistence, provider
   manage CRUD. Uses a throwaway project and throwaway provider. */
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

async function providersOf(request) {
  return (await (await request.get(`${BASE}/api/providers`)).json()).providers || [];
}
async function detail(request, pid) {
  return (await (await request.get(`${BASE}/api/projects/${pid}`)).json());
}

test('inspector tabs, gates, settings persist to the project', async ({ page, request }) => {
  const errors = watchErrors(page);
  const created = await (await request.post(`${BASE}/api/projects`)).json();
  const pid = created.id;

  await page.goto(`${BASE}/project/${pid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#inspTabs');
  // empty project: no video, no cues, no job
  await expect(page.locator('#jobLine')).toContainText('Transcribe to fill the timeline');
  await page.click('#inspTabs button:has-text("Transcript")');
  await expect(page.locator('#transcribeBtn')).toBeDisabled();
  await expect(page.locator('#dubBtn'), "dub is on the actions bar").toBeDisabled();
  if (await page.locator('#cancelBtn').count()) {
    await expect(page.locator('#cancelBtn')).toBeDisabled();
  }
  expect(errors).toEqual([]);

  await page.click('#inspTabs button:has-text("Transcript")');
  await page.selectOption('#whisper', 'small');
  await expect.poll(async () => (await detail(request, pid)).options,
    { timeout: 8000 }).toHaveProperty('whisper', 'small');

  await request.delete(`${BASE}/api/projects/${pid}`);
});

test('providers manage: create, appears in Translate tab, delete', async ({ page, request }) => {
  const errors = watchErrors(page);
  // unique endpoint so the select fallback mapping can't cross others
  const endpoint = `https://smoke-${Date.now()}.example.com/v1/chat/completions`;
  await page.goto(`${BASE}/project/x-smoke`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#inspTabs');

  await page.click('#inspTabs button:has-text("Translate")');
  await page.selectOption('#translator', 'openai');
  await expect(page.locator('#cloudFields')).toBeVisible();

  await page.click('.provider-field button');
  await page.waitForSelector('#providersModal:not(.hidden)');
  await page.fill('#provName', 'Smoke Endpoint');
  await page.fill('#provEndpoint', endpoint);
  await page.fill('#provModel', 'smoke-model');
  await page.fill('#provKey', 'smk-key');
  await page.click('#provSave');
  await expect(page.locator('#providersModal')).toHaveClass(/hidden/);

  const rows = await providersOf(request);
  const mine = rows.find((r) => r.endpoint === endpoint);
  expect(mine, JSON.stringify(rows.map((r) => r.endpoint))).toBeTruthy();

  // delete through the same form (the confirm dialog must be accepted)
  await page.click('.provider-field button');
  await page.waitForSelector('#providersModal:not(.hidden)');
  page.on('dialog', (d) => d.accept());   // every confirm in this flow: accept
  await page.click(`.provider-row:has-text("Smoke Endpoint")`);
  await page.click('#provDelete');
  await expect.poll(async () =>
      (await providersOf(request)).some((r) => r.endpoint === endpoint),
    { timeout: 8000 }).toBe(false);
  expect(errors).toEqual([]);
});

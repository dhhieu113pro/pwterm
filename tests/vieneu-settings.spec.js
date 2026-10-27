/**
 * VieNeu Studio — the /settings defaults page.
 *
 *   vieneu-studio start
 *   cd ~/playwright-automation
 *   VIENEU_STUDIO_URL=http://127.0.0.1:7861 \
 *     npm test -- tests/vieneu-settings.spec.js
 *
 * The defaults file is one global on this phone, so these tests share it:
 * they run in order, each sets the state it needs through the API, and the
 * original settings are put back at the end.
 */
const { test, expect } = require('@playwright/test');

const BASE = (process.env.VIENEU_STUDIO_URL || 'http://127.0.0.1:7861')
  .replace(/\/+$/, '');

test.describe.configure({ mode: 'serial' });

/** Any uncaught script/console error fails the test: silent breakage is the
 *  failure mode this suite exists for. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Failed to load resource/.test(text)) return;   // optional assets
    errors.push(`console: ${text}`);
  });
  return errors;
}

async function getDefaults(request) {
  const res = await request.get(`${BASE}/api/defaults`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).defaults;
}

async function putDefaults(request, body) {
  const res = await request.put(`${BASE}/api/defaults`, { data: body });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).defaults;
}

async function resetDefaults(request) {
  const res = await request.delete(`${BASE}/api/defaults`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).defaults;
}

async function listProviders(request) {
  const res = await request.get(`${BASE}/api/providers`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).providers || [];
}

let original = null;

test.beforeAll(async ({ request }) => {
  original = await getDefaults(request);
});

test.afterAll(async ({ request }) => {
  const factory = await resetDefaults(request);
  if (JSON.stringify(original) !== JSON.stringify(factory)) {
    await putDefaults(request, original);
  }
});

test('the page boots with the three groups and no script errors', async ({ page, request }) => {
  const errors = watchErrors(page);
  await resetDefaults(request);

  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/VieNeu/);
  const heads = page.locator('#settingsForm h2');
  await expect(heads).toHaveText(['Transcript', 'Translate', 'Dub']);
  await expect(page.locator('#settingsForm .card')).toHaveCount(3);
  await expect(page.locator('#saveBtn')).toBeDisabled();
  await expect(page.locator('#preview')).toContainText('Whisper base');

  expect(errors).toEqual([]);
});

test('saving language and Whisper survives a reload', async ({ page, request }) => {
  const errors = watchErrors(page);
  await resetDefaults(request);

  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.selectOption('#s-lang', 'ja');
  await page.selectOption('#s-whisper', 'small');
  await expect(page.locator('#saveBtn')).toBeEnabled();

  const saved = page.waitForResponse((r) =>
    r.url().includes('/api/defaults') && r.request().method() === 'PUT');
  await page.click('#saveBtn');
  expect((await saved).ok()).toBeTruthy();
  await expect(page.locator('#toast')).toContainText('Defaults saved');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#s-lang')).toHaveValue('ja');
  await expect(page.locator('#s-whisper')).toHaveValue('small');

  const defaults = await getDefaults(request);
  expect(defaults.lang).toBe('ja');
  expect(defaults.whisper).toBe('small');
  expect(errors).toEqual([]);
});

test('a new project inherits the saved defaults', async ({ request }) => {
  await putDefaults(request, { lang: 'ja', whisper: 'small' });

  const created = await request.post(`${BASE}/api/projects`);
  expect(created.ok(), await created.text()).toBeTruthy();
  const project = await created.json();

  const detail = await request.get(`${BASE}/api/projects/${project.id}`);
  expect(detail.ok(), await detail.text()).toBeTruthy();
  const full = await detail.json();
  expect(full.options.lang).toBe('ja');
  expect(full.options.whisper).toBe('small');
  expect(full.options.bg).toBe(0.12);

  await request.delete(`${BASE}/api/projects/${encodeURIComponent(project.id)}`);
});

test('the Auto dialog prefills language and provider, and leaves them empty without', async ({ page, request }) => {
  const errors = watchErrors(page);
  const providers = await listProviders(request);

  await putDefaults(request, { lang: 'ja', provider: providers.length ? providers[0].id : '' });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);           // defaults and providers load in parallel
  await page.click('#autoBtn');
  await expect(page.locator('#pipeLang')).toHaveValue('ja');
  if (providers.length) {
    await expect(page.locator('#pipeProvider')).toHaveValue(providers[0].id);
  }

  await resetDefaults(request);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.click('#autoBtn');
  await expect(page.locator('#pipeLang')).toHaveValue('auto');
  await expect(page.locator('#pipeProvider')).toHaveValue('');
  expect(errors).toEqual([]);
});

test('Reset restores the factory values', async ({ request }) => {
  await putDefaults(request, { lang: 'ja', whisper: 'small' });
  const factory = await resetDefaults(request);

  const now = await getDefaults(request);
  expect(now).toEqual(factory);
  expect(now.bg).toBe(0.12);
  expect(now.whisper).toBe('base');
  expect(now.lang).toBe('auto');
});

test('a provider that no longer exists survives a save', async ({ page, request }) => {
  const errors = watchErrors(page);
  await putDefaults(request, { provider: 'gone-id' });

  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#s-provider')).toHaveValue('gone-id');
  await expect(page.locator('#s-provider option:checked')).toHaveText('Saved provider unavailable');

  await page.locator('#s-freeze').click();          // makes the form dirty
  await expect(page.locator('#saveBtn')).toBeEnabled();
  const saved = page.waitForResponse((r) =>
    r.url().includes('/api/defaults') && r.request().method() === 'PUT');
  await page.click('#saveBtn');
  expect((await saved).ok()).toBeTruthy();

  const defaults = await getDefaults(request);
  expect(defaults.provider).toBe('gone-id');
  expect(errors).toEqual([]);
});

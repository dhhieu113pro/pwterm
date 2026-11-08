/* Review-pass regressions (2026-10-28): the editor Auto body must carry
   the tab settings, and the 1.4s poll must not clobber what the user is
   doing mid-second — typing the title, or a picked cue. */
const { test, expect } = require('./fixtures');

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

test('the editor Auto body carries the tab settings, not just the link', async ({ page }) => {
  const errors = watchErrors(page);
  const created = await (await page.request.post(`${BASE}/api/projects`)).json();
  try {
    let body = null;
    await page.route('**/api/pipeline', async (route) => {
      body = await route.request().postDataJSON();
      await route.fulfill({ contentType: 'application/json',
                            body: JSON.stringify({ id: created.id }) });
    });
    await page.goto(`${BASE}/project/${created.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#inspTabs');
    // settings a default install cannot guess
    await page.click('#inspTabs button:has-text("Transcript")');
    await page.selectOption('#asrLang', 'ja');
    await page.selectOption('#whisper', 'small');

    await page.click('header button:has-text("Auto")');
    await page.waitForSelector('#autoModalEditor:not(.hidden)');
    await page.fill('#pipeUrl', 'https://www.youtube.com/watch?v=smoke');
    await page.click('#pipeGo');
    await expect.poll(() => body, { timeout: 5000 }).not.toBeNull();

    expect(body.url).toBe('https://www.youtube.com/watch?v=smoke');
    for (const key of ['lang', 'whisper', 'backend', 'provider', 'endpoint',
                       'key', 'model', 'engine', 'voice', 'fit', 'freeze',
                       'translate', 'dub', 'polish', 'bg', 'fit_max', 'max_chars']) {
      expect(body, `Auto body misses ${key}: ${JSON.stringify(body)}`).toHaveProperty(key);
    }
    expect(body.lang).toBe('ja');
    expect(body.whisper).toBe('small');
    for (const flag of ['translate', 'dub', 'polish']) {
      expect(typeof body[flag], `${flag} must be 0/1 number, got ${JSON.stringify(body[flag])}`)
        .toBe('number');
    }
    expect(errors).toEqual([]);
  } finally {
    await page.request.delete(`${BASE}/api/projects/${created.id}`);
  }
});

test('typing the title survives the 1.4s poll', async ({ page }) => {
  const errors = watchErrors(page);
  const created = await (await page.request.post(`${BASE}/api/projects`)).json();
  try {
    await page.goto(`${BASE}/project/${created.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#projectTitle');
    const typed = `e2e type ${Date.now()}`;
    await page.click('#projectTitle');
    await page.type('#projectTitle', typed, { delay: 140 });   // > 2s of typing
    await page.waitForTimeout(1800);                            // at least one poll
    const value = await page.inputValue('#projectTitle');
    expect(value.endsWith(typed), `buffer clobbered: "${value}"`).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.request.delete(`${BASE}/api/projects/${created.id}`);
  }
});

test('a picked cue stays picked across polls', async ({ page }) => {
  const errors = watchErrors(page);
  const list = await (await page.request.get(`${BASE}/api/projects`)).json();
  let project = null;
  for (const p of list.projects) {
    const d = await (await page.request.get(`${BASE}/api/projects/${p.id}`)).json();
    if ((d.cues || []).length) { project = d; break; }
  }
  test.skip(!project, 'no project with cues on this install');

  await page.goto(`${BASE}/project/${project.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cueLane .cue');
  await page.click('#cueLane .cue:first-child');
  await expect(page.locator('#cueLane .cue.sel')).toHaveCount(1);
  await page.waitForTimeout(2000);         // two 1.4s polls pass
  await expect(page.locator('#cueLane .cue.sel')).toHaveCount(1);
  expect(errors).toEqual([]);
});

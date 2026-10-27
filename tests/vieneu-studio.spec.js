/**
 * VieNeu Studio — end-to-end checks for the dubbing editor.
 *
 * The Studio runs on this phone (Termux), so the tests point at localhost:
 *
 *   vientu-studio                       # or: vieneu-studio start
 *   cd ~/playwright-automation
 *   VIENEU_STUDIO_URL=http://127.0.0.1:7861 \
 *     npm test -- tests/vieneu-studio.spec.js
 *
 * What they protect: the page must *boot* (a single ReferenceError used to
 * leave the editor blank), the downloaded source must decode in the phone's
 * Chromium, the timeline must match the API, and an API key must never reach
 * the browser.
 */
const { test, expect } = require('@playwright/test');

const BASE = (process.env.VIENEU_STUDIO_URL || 'http://127.0.0.1:7861')
  .replace(/\/+$/, '');

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

async function listProjects(request) {
  const res = await request.get(`${BASE}/api/projects`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).projects || [];
}

async function projectDetail(request, id) {
  const res = await request.get(`${BASE}/api/projects/${id}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

/**
 * Pick a project that can actually be exercised in the editor.
 * The list endpoint only says `has_result`; the per-project `has.source`
 * flag (and the urls) live on the detail endpoint, so resolve there.
 */
async function projectWithVideo(request) {
  for (const p of await listProjects(request)) {
    const full = await projectDetail(request, p.id);
    if (full.has && full.has.source) return full;
  }
  return null;
}

/** Same, but must also have a rendered dub (needed by the view switch). */
async function projectWithDub(request) {
  for (const p of await listProjects(request)) {
    const full = await projectDetail(request, p.id);
    if (full.has && full.has.source && full.has.result) return full;
  }
  return null;
}

async function newTempProject(request) {
  const res = await request.post(`${BASE}/api/projects`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function deleteProject(request, id) {
  await request.delete(`${BASE}/api/projects/${encodeURIComponent(id)}`);
}

/** readyState >= 2 means metadata decoded; videoWidth > 0 means a frame did. */
async function waitForVideo(page) {
  const video = page.locator('#video');
  await expect(video).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => video.evaluate((v) => v.readyState),
                    { timeout: 25000, intervals: [250, 500, 1000] })
    .toBeGreaterThanOrEqual(2);
  const info = await video.evaluate((v) => ({
    src: v.currentSrc, width: v.videoWidth, height: v.videoHeight,
    duration: v.duration, error: v.error && { code: v.error.code, message: v.error.message },
  }));
  expect(info.error, JSON.stringify(info.error)).toBeNull();
  expect(info.width).toBeGreaterThan(0);
  return { video, info };
}

test.describe('VieNeu Studio · gallery', () => {
  test('lists every project, with a count and a status badge', async ({ page, request }) => {
    const errors = watchErrors(page);
    const all = await listProjects(request);

    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/VieNeu/);
    await page.waitForSelector('.vcard, #empty:not(.hidden)');

    await expect(page.locator('.vcard')).toHaveCount(all.length);
    await expect(page.locator('#count')).toHaveText(new RegExp(`^${all.length} video`));

    if (all.length) {
      const first = all[0];
      const card = page.locator(`.vcard[data-id="${first.id}"]`);
      await expect(card).toHaveCount(1);
      await expect(card.locator('.vtitle')).toContainText(
        (first.title_custom || first.title).slice(0, 20));
      await expect(card.locator('.badge')).not.toBeEmpty();
    }
    expect(errors).toEqual([]);
  });

  test('search filters the grid', async ({ page, request }) => {
    const all = await listProjects(request);
    test.skip(all.length < 1, 'needs at least one project');

    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.vcard');

    await page.fill('#search', 'zzz-no-such-video-zzz');
    await expect(page.locator('.vcard')).toHaveCount(0);
    await page.fill('#search', '');
    await expect(page.locator('.vcard')).toHaveCount(all.length);
  });

  test('New dubbing opens the editor with the import dialog ready',
       async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.click('#newDub');

    await page.waitForURL(/\/project\/[^/]+\?new=1$/, { timeout: 20000 });
    // the hint is consumed so a reload does not re-open the dialog
    await expect.poll(() => page.evaluate(() => location.search)).toBe('');
    await expect(page.locator('#importModal')).toBeVisible();
    await expect(page.locator('#urlInput')).toBeVisible();

    const id = page.url().split('/project/')[1].split(/[?#]/)[0];
    await deleteProject(request, id);
    expect(errors).toEqual([]);
  });

  test('a card opens its project and the back arrow returns', async ({ page, request }) => {
    const all = await listProjects(request);
    test.skip(!all.length, 'needs a project');

    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.click(`.vcard[data-id="${all[0].id}"]`);
    await page.waitForURL(`**/project/${all[0].id}`);
    await expect(page.locator('#projectTitle')).not.toHaveValue('');

    await page.click('a[aria-label="All videos"]');
    await page.waitForURL(`${BASE}/`);
    await expect(page.locator('.vcard, #empty:not(.hidden)').first()).toBeVisible();
  });

  test('delete asks for confirmation and removes the card', async ({ page, request }) => {
    const tmp = await newTempProject(request);
    try {
      page.on('dialog', (d) => d.accept());
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      const card = page.locator(`.vcard[data-id="${tmp.id}"]`);
      await expect(card).toBeVisible();
      await card.locator('[data-del]').click({ force: true });
      await expect(card).toHaveCount(0, { timeout: 20000 });
      const left = await listProjects(request);
      expect(left.some((p) => p.id === tmp.id)).toBe(false);
    } finally {
      await deleteProject(request, tmp.id);
    }
  });

  test('Auto dialog explains the four steps and refuses an empty link', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.click('#autoBtn');
    await expect(page.locator('#autoModal')).toBeVisible();
    await expect(page.locator('#autoTitle')).toContainText(/four steps/i);
    await expect(page.locator('#pipeDub')).toBeChecked();

    await page.click('#pipeGo');
    await expect(page.locator('#toast')).toBeVisible();
    await expect(page.locator('#toast')).toContainText(/link first/i);

    await page.click('#autoCancel');
    await expect(page.locator('#autoModal')).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe('VieNeu Studio · editor', () => {
  test('boots a project: title, cues, timeline, no script errors',
       async ({ page, request }) => {
    const full = await projectWithVideo(request);
    test.skip(!full, 'no project with a video on this install');
    const errors = watchErrors(page);

    await page.goto(`${BASE}/project/${full.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#projectTitle')).toHaveValue(
      full.title_custom || full.title, { timeout: 20000 });
    expect(full.cues.length).toBeGreaterThan(0);
    await expect(page.locator('#cueLane .cue').first()).toBeVisible();
    await expect(page.locator('#timeline')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a shared deep link and a reload both keep the project loaded',
       async ({ page, request }) => {
    // The reported symptom: open /project/{id} directly and get a blank page
    // (no title, no cues, no video). A thrown ReferenceError during boot used
    // to do exactly that; this pins the whole first paint.
    const full = await projectWithVideo(request);
    test.skip(!full, 'no project with a video on this install');
    const errors = watchErrors(page);

    const expectLoaded = async () => {
      await expect(page.locator('#projectTitle'))
        .toHaveValue(full.title_custom || full.title, { timeout: 20000 });
      await expect(page.locator('#cueLane .cue')).toHaveCount(full.cues.length);
      await expect(page.locator('#stageMeta')).not.toBeEmpty();
      // exactly one view is selected, and it is the one the project saved
      const expected = full.view === 'Dubbed' && full.has.result ? 'Dubbed' : 'Source';
      await expect(page.locator('#viewSeg button.active')).toHaveCount(1);
      await expect(page.locator(`#viewSeg button[data-view="${expected}"]`))
        .toHaveClass(/active/);
      expect(await page.locator('#importModal').isVisible()).toBe(false);
    };

    await page.goto(`${BASE}/project/${full.id}`, { waitUntil: 'load' });
    await expectLoaded();

    await page.reload({ waitUntil: 'load' });
    await expectLoaded();

    expect(errors).toEqual([]);
  });

  test('the source video decodes and plays', async ({ page, request }) => {
    const p = await projectWithVideo(request);
    test.skip(!p, 'no project with a video on this install');

    await page.goto(`${BASE}/project/${p.id}`, { waitUntil: 'domcontentloaded' });
    await page.click('#viewSeg button[data-view="Source"]');
    const { video, info } = await waitForVideo(page);

    expect(info.src).toMatch(/\/api\/media\/.+\/source/);
    expect(info.duration).toBeGreaterThan(1);
    // a codec the browser cannot decode leaves this button visible instead
    await expect(page.locator('#fixVideoBtn')).toBeHidden();

    await video.evaluate(async (v) => { v.muted = true; await v.play(); });
    await expect.poll(() => video.evaluate((v) => v.currentTime),
                      { timeout: 20000 }).toBeGreaterThan(0.2);
  });

  test('the dub is seekable (HTTP Range) and switches views',
       async ({ page, request }) => {
    const p = await projectWithDub(request);
    test.skip(!p, 'no dubbed project on this install');

    const range = await request.get(BASE + p.urls.result,
                                    { headers: { Range: 'bytes=0-99' } });
    expect(range.status()).toBe(206);
    expect((await range.body()).length).toBe(100);

    await page.goto(`${BASE}/project/${p.id}`, { waitUntil: 'domcontentloaded' });
    const { info } = await waitForVideo(page);
    await page.click('#viewSeg button[data-view="Dubbed"]');
    await expect.poll(() => page.evaluate(() => document.querySelector('#video').currentSrc),
                      { timeout: 20000 }).not.toBe(info.src);
    await expect(page.locator('#playerBadge')).toHaveText('DUBBED');

    await page.click('#viewSeg button[data-view="Source"]');
    await expect.poll(() => page.evaluate(() => document.querySelector('#video').currentSrc),
                      { timeout: 20000 }).toBe(info.src);

    // The remembered view must survive a reopen: the last click wins even
    // though Source/Dubbed were toggled back-to-back (two PATCHes used to
    // race and leave the wrong one saved).
    await expect.poll(async () => {
      const r = await request.get(`${BASE}/api/projects/${p.id}`);
      return (await r.json()).view;
    }, { timeout: 15000, intervals: [250, 500, 1000] }).toBe('Source');
  });

  test('the Translate tab offers the saved providers without leaking keys',
       async ({ page, request }) => {
    const p = await projectWithVideo(request);
    test.skip(!p, 'no project with a video on this install');

    await page.goto(`${BASE}/project/${p.id}`, { waitUntil: 'domcontentloaded' });
    await page.click('[data-tab="translate"]');
    await expect(page.locator('[data-page="translate"]')).toBeVisible();

    const provs = (await (await request.get(`${BASE}/api/providers`)).json()).providers || [];
    const options = await page.locator('#provider option').allTextContents();
    if (!provs.length) {
      expect(options.join(' ')).toMatch(/Offline/i);
    } else {
      for (const pv of provs) expect(options.join(' ')).toContain(pv.name);
      for (const pv of provs) {
        // The API masks the secret: an empty key plus the last 4 characters.
        expect(pv.key || '').toBe('');
        expect(pv.key_tail || '').toMatch(/^[\w-]{0,4}$/);
      }
      // A key pasted into the page would show up as an sk-… / gsk_… token.
      const html = await page.content();
      expect(html).not.toMatch(/\b(sk-[A-Za-z0-9]{12,}|gsk_[A-Za-z0-9]{12,}|AIza[A-Za-z0-9_-]{20,})/);
    }
  });

  test('an unknown project sends you back to the gallery', async ({ page }) => {
    await page.goto(`${BASE}/project/does-not-exist`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(`${BASE}/`, { timeout: 20000 });
    await expect(page.locator('.vcard, #empty:not(.hidden)').first()).toBeVisible();
  });

  test('renaming a project persists', async ({ page, request }) => {
    const tmp = await newTempProject(request);
    try {
      await page.goto(`${BASE}/project/${tmp.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#importModal', { state: 'hidden', timeout: 5000 })
        .catch(() => {});
      const name = `e2e rename ${Date.now()}`;
      await page.fill('#projectTitle', name);
      await page.locator('#projectTitle').blur();
      await expect.poll(async () => {
        const r = await request.get(`${BASE}/api/projects/${tmp.id}`);
        const d = await r.json();
        return d.title_custom || d.title;
      }, { timeout: 15000 }).toBe(name);
    } finally {
      await deleteProject(request, tmp.id);
    }
  });
});

test.describe('VieNeu Studio · media', () => {
  test('the gallery and its assets are served uncached', async ({ request }) => {
    const home = await request.get(`${BASE}/`);
    expect(home.status()).toBe(200);
    expect(home.headers()['cache-control']).toMatch(/no-store/);
    expect(await home.text()).toContain('id="grid"');

    for (const asset of ['/web/app.js', '/web/home.js', '/web/style.css']) {
      const res = await request.get(BASE + asset);
      expect(res.status(), asset).toBe(200);
    }
  });
});

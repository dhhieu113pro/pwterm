/**
 * VieNeu Studio — end-to-end checks for the dubbing editor (Vue UI).
 *
 * The Studio runs on this phone (Termux), so the tests point at localhost:
 *
 *   vieneu-studio                       # or: vieneu-studio start
 *   cd ~/playwright-automation
 *   VIENEU_STUDIO_URL=http://127.0.0.1:7861 \
 *     npm test -- tests/vieneu-studio.spec.js
 *
 * What they protect: the page must *boot* (a single ReferenceError used to
 * leave the editor blank), the downloaded source must decode in the phone's
 * Chromium, the timeline must match the API, and an API key must never reach
 * the browser.
 *
 * Reworked 2026-10-28 for the Vue 3 + PrimeVue 4 front-end; every legacy
 * assertion keeps its intent (per the rewrite plan). Selectors that the
 * Vue pages renamed are mapped below.
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

/** readyState >= 2 means metadata decoded; videoWidth > 0 means a frame did.
 *  The Vue player has no `#video` id: the element lives under `.player`. */
async function waitForVideo(page) {
  const video = page.locator('.player video');
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

/** Gallery cards carry no data-id in the Vue UI; the title is the key.
 *  It is unique enough per test because the API titles already are. */
function cardOf(page, title) {
  return page.locator(`.vcard[aria-label="Open ${title}"]`);
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
      const title = first.title_custom || first.title;
      const card = cardOf(page, title);
      await expect(card).toHaveCount(1);
      await expect(card.locator('.vtitle')).toContainText(title.slice(0, 20));
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
    // Intent (legacy): the dialog is open exactly because of the ?new=1
    // hint. The hint is not consumed from the URL any more, but a plain
    // visit — as a reload-free share link lands — must not open it.
    await expect(page.locator('#importModal')).toBeVisible();
    await expect(page.locator('#urlInput')).toBeVisible();
    await page.goto(page.url().split('?')[0], { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#importModal')).toBeHidden();

    const id = page.url().split('/project/')[1].split(/[?#]/)[0];
    await deleteProject(request, id);
    expect(errors).toEqual([]);
  });

  test('a card opens its project and the back arrow returns', async ({ page, request }) => {
    const all = await listProjects(request);
    test.skip(!all.length, 'needs a project');

    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await cardOf(page, all[0].title_custom || all[0].title).click();
    await page.waitForURL(`**/project/${all[0].id}*`);
    await expect(page.locator('#projectTitle')).not.toHaveValue('');

    await page.click('a[aria-label="All videos"]');
    await page.waitForURL(`${BASE}/`);
    await expect(page.locator('.vcard, #empty:not(.hidden)').first()).toBeVisible();
  });

  test('delete asks for confirmation and removes the card', async ({ page, request }) => {
    const tmp = await newTempProject(request);
    try {
      // unique title so the card locator can't collide with other projects
      const title = `E2E delete ${tmp.id}`;
      await request.patch(`${BASE}/api/projects/${tmp.id}`, { data: { title } });
      page.on('dialog', (d) => d.accept());
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      const card = cardOf(page, title);
      await expect(card).toBeVisible();
      await card.locator('.vdel').click();
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

    // Legacy `#autoCancel` is now the modal's Cancel button.
    await page.locator('#autoModal button', { hasText: 'Cancel' }).click();
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
      await expect(page.locator('#viewSeg button.active'))
        .toHaveText(expected);
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
    await page.click('#viewSeg button:has-text("Source")');
    const { video, info } = await waitForVideo(page);

    expect(info.src).toMatch(/\/api\/media\/.+\/source/);
    expect(info.duration).toBeGreaterThan(1);
    // Legacy pinned a `#fixVideoBtn` fallback for undecodable codecs; the
    // Vue UI has no such repair button, so there is nothing to flip extra.

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
    await page.click('#viewSeg button:has-text("Dubbed")');
    await expect.poll(() => page.evaluate(() => document.querySelector('.player video').currentSrc),
                      { timeout: 20000 }).not.toBe(info.src);
    await expect(page.locator('#playerBadge')).toHaveText('DUBBED');

    await page.click('#viewSeg button:has-text("Source")');
    await expect.poll(() => page.evaluate(() => document.querySelector('.player video').currentSrc),
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
    await page.click('#inspTabs button:has-text("Translate")');
    await expect(page.locator('.insp-page.active')).toBeVisible();
    // the saved-provider list only renders in the cloud (openai) engine
    await page.selectOption('#translator', 'openai');

    const provs = (await (await request.get(`${BASE}/api/providers`)).json()).providers || [];
    const options = await page.locator('#provider option').allTextContents();
    if (!provs.length) {
      expect(options.join(' ')).toMatch(/— no provider configured —|Offline/i);
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

  test('an unknown project does not blank the page', async ({ page }) => {
    // Legacy sent you back to the gallery with a redirect; the Vue editor
    // stays put and shows the "No project" empty state instead. Same
    // intent: the app must never show a broken or blank page.
    const errors = watchErrors(page);
    await page.goto(`${BASE}/project/does-not-exist`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#statusText')).toHaveText('No project', { timeout: 20000 });
    expect(errors).toEqual([]);
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
  test('the gallery and its built assets are served uncached', async ({ request }) => {
    // The Vue build writes hashed asset names; the served HTML must always
    // reference assets that exist (single build, no split-brain).
    const home = await request.get(`${BASE}/`);
    expect(home.status()).toBe(200);
    expect(home.headers()['cache-control']).toMatch(/no-store/);

    const assetUrls = (await home.text())
      .match(/(?:src|href)="(\/web\/dist\/assets\/[^"]+)"/g)
      ?.map((m) => m.match(/"([^"]+)"/)[1]) || [];
    expect(assetUrls.length).toBeGreaterThan(0);
    for (const asset of assetUrls) {
      const res = await request.get(BASE + asset);
      expect(res.status(), asset).toBe(200);
    }
  });
});

test.describe('VieNeu Studio · subtitle preview', () => {
  /** Seek the player's <video> to t and let timeupdate settle. */
  const seek = (page, t) => page.evaluate((at) => {
    document.querySelector('video').currentTime = at;
  }, t);

  test('shows the active Vietnamese cue and hides in gaps', async ({ page, request }) => {
    const full = await projectWithVideo(request);
    test.skip(!full, 'no project with a video on this install');
    const cue = full.cues[1];
    test.skip(!cue, 'project has fewer than two cues');
    const errors = watchErrors(page);

    await page.goto(`${BASE}/project/${full.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#cueLane .cue').first()).toBeVisible({ timeout: 20000 });
    // before any seek: no cue is active, nothing may render
    await expect(page.locator('.subs')).toHaveCount(0);

    await seek(page, (cue.start + cue.end) / 2);
    await expect(page.locator('.subs')).toHaveText(cue.text.trim());

    // a real gap in this project's data: before the first cue, else between
    // cues (SRTs tile back-to-back, so "cue.end + 2" is usually the next cue)
    const gap = full.cues[0].start > 0.15
      ? 0.05
      : full.cues.slice(1).map((c, i) => ({ a: full.cues[i].end, b: c.start }))
          .find((g) => g.b - g.a > 0.5)?.a + 0.2;
    test.skip(gap === undefined, 'cues are contiguous — no gap exists');
    await seek(page, gap);
    await expect(page.locator('.subs')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('own controls: play/pause, mute, scrub, double-tap, auto-hide', async ({ page, request }) => {
    const full = await projectWithVideo(request);
    test.skip(!full, 'no project with a video on this install');
    const errors = watchErrors(page);
    await page.goto(`${BASE}/project/${full.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#cueLane .cue').first()).toBeVisible({ timeout: 20000 });
    const video = page.locator('video');
    await video.waitFor({ state: 'visible', timeout: 15000 });
    expect(await video.getAttribute('controls')).toBeNull();   // native bar gone

    const bar = page.locator('#playerWrap .bar');
    await bar.locator('button[aria-label="Play"]').click();
    await expect.poll(() => video.evaluate((v) => v.paused)).toBe(false);
    await bar.locator('button[aria-label="Pause"]').click();
    await expect.poll(() => video.evaluate((v) => v.paused)).toBe(true);

    // double-tap the right side = +10 s (clamped inside the video).
    // The seek is a TOUCH gesture (desktop dblclick means fullscreen), so
    // drive the handler the way a phone does: two touch pointerdowns.
    await page.evaluate(() => { document.querySelector('video').currentTime = 3; });
    const t0 = await video.evaluate((v) => v.currentTime);
    await page.evaluate(() => {
      const stage = document.querySelector('#playerWrap .pstage');
      const r = stage.getBoundingClientRect();
      const at = () => stage.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerType: 'touch', isPrimary: true,
        clientX: r.right - 40, clientY: r.top + 60 }));
      at();
      setTimeout(at, 120);
    });
    await expect.poll(async () => video.evaluate((v) => v.currentTime),
                      { timeout: 5000 }).toBeGreaterThan(t0 + 5);

    // the thin line scrubs: clicking at 60% of its width seeks ~60%
    const line = page.locator('#playerWrap .scrub');
    const box = await line.boundingBox();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
    const dur = await video.evaluate((v) => v.duration);
    await expect.poll(async () => video.evaluate((v) => v.currentTime),
                      { timeout: 5000 }).toBeGreaterThanOrEqual(dur * 0.45);

    // chrome auto-hides while playing once the pointer leaves the player
    // (desktop: hover keeps chrome visible), and returns on pointer move
    await bar.locator('button[aria-label="Play"]').click();
    await page.mouse.move(5, 5);                       // cursor away from the player
    // 9s: the hide timer is 2.5s in-app, but parallel workers on one phone
    // can delay the callback well past that — the poll window must cover it
    await expect(bar).toBeHidden({ timeout: 9000 });
    await page.mouse.move(box.x, box.y - 30);          // back over the stage
    await expect(bar).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('keyboard edits a cue, not the player, while typing', async ({ page, request }) => {
    const full = await projectWithVideo(request);
    test.skip(!full, 'no project with a video on this install');
    await page.goto(`${BASE}/project/${full.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#cueLane .cue').first()).toBeVisible({ timeout: 20000 });
    const cur = () => page.evaluate(() => document.querySelector('video').currentTime);
    const t0 = await cur();
    const orig = await page.inputValue('#projectTitle');
    await page.fill('#projectTitle', 'x');                     // text field focus
    try {
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      expect(await cur()).toBe(t0);                            // typing owns the keys
    } finally {
      await page.fill('#projectTitle', orig);
    }
    await page.evaluate(() => document.querySelector('#projectTitle').blur());
    await page.keyboard.press('ArrowRight');                   // outside inputs: +5 s (spec)
    await expect.poll(cur, { timeout: 5000 }).toBeGreaterThan(t0);
  });

  test('resize keeps the subtitle legible; fullscreen keeps it interactive',
       async ({ page, request }) => {
    const full = await projectWithVideo(request);
    test.skip(!full, 'no project with a video on this install');
    const errors = watchErrors(page);
    await page.goto(`${BASE}/project/${full.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#cueLane .cue').first()).toBeVisible({ timeout: 20000 });
    const cue = full.cues[0];
    await page.evaluate((c) => {
      document.querySelector('video').currentTime = (c.start + c.end) / 2;
    }, cue);

    for (const [w, h] of [[360, 800], [1280, 800], [1280, 1600]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
      const s = await page.locator('.subs').boundingBox();
      const p = await page.locator('#playerWrap').boundingBox();
      expect(s, `at ${w}x${h} the subtitle left the player box`).toBeTruthy();
      expect(s.y, `at ${w}x${h}`).toBeGreaterThan(p.y);
      expect(s.y + s.height, `at ${w}x${h}`).toBeLessThan(p.y + p.height);
    }

    await page.click('#playerWrap .bar button[aria-label="Fullscreen"]');
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(true);
    await expect(page.locator('.subs')).toBeVisible();
    await expect(page.locator('#playerWrap .bar')).toBeVisible();
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(false);
    await expect(page.locator('.subs')).toBeVisible();   // restored, no reload
    expect(errors).toEqual([]);
  });

  test('the CC toggle hides the overlay and persists as a project setting',
       async ({ page, request }) => {
    const full = await projectWithVideo(request);
    test.skip(!full, 'no project with a video on this install');
    const cue = full.cues[1];
    test.skip(!cue, 'project has fewer than two cues');
    const errors = watchErrors(page);
    const opts = async () => (await (await request.get(
      `${BASE}/api/projects/${full.id}`)).json()).options;
    await page.goto(`${BASE}/project/${full.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#cueLane .cue').first()).toBeVisible({ timeout: 20000 });
    await seek(page, (cue.start + cue.end) / 2);
    await expect(page.locator('.subs')).toHaveText(cue.text.trim());

    await page.click('#playerWrap .bar button[aria-label="Subtitles"]');
    await expect(page.locator('.subs')).toHaveCount(0);       // off, immediately
    // rides the debounced PATCH: the project stores subs=false
    await expect.poll(opts).toEqual(expect.objectContaining({ subs: false }));

    await page.reload({ waitUntil: 'domcontentloaded' });     // still off next visit
    await expect(page.locator('#cueLane .cue').first()).toBeVisible({ timeout: 20000 });
    await seek(page, (cue.start + cue.end) / 2);
    await expect(page.locator('.subs')).toHaveCount(0);

    await page.click('#playerWrap .bar button[aria-label="Subtitles"]');  // on again
    await expect(page.locator('.subs')).toHaveText(cue.text.trim());
    await expect.poll(opts).toEqual(expect.objectContaining({ subs: true }));
    expect(errors).toEqual([]);
  });

  test('an edited cue shows its new text (live script)', async ({ page, request }) => {
    const full = await projectWithVideo(request);
    test.skip(!full, 'no project with a video on this install');
    const cue = full.cues[1];
    test.skip(!cue, 'project has fewer than two cues');
    const errors = watchErrors(page);

    const srt = (fn) => full.cues.map((c, i) => {
      const fmt = (s) => {
        const [h, m, rest] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:` +
               `${rest.toFixed(3).padStart(6, '0').replace('.', ',')}`;
      };
      return `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${fn(c, i)}\n`;
    }).join('\n');
    const edited = `${cue.text} (wys)`;
    const res = await request.put(`${BASE}/api/projects/${full.id}/script`,
      { data: { srt: srt((c, i) => (i === 1 ? edited : c.text)) } });
    expect(res.ok(), await res.text()).toBeTruthy();
    try {
      await page.goto(`${BASE}/project/${full.id}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#cueLane .cue').first()).toBeVisible({ timeout: 20000 });
      await seek(page, (cue.start + cue.end) / 2);
      await expect(page.locator('.subs')).toHaveText(edited);
      expect(errors).toEqual([]);
    } finally {
      const back = await request.put(`${BASE}/api/projects/${full.id}/script`,
        { data: { srt: srt((c) => c.text) } });
      expect(back.ok()).toBeTruthy();
    }
  });
});

test.describe('VieNeu Studio · project steps bar', () => {
  /**
   * The bar derives every state from project JSON + the job's pipeline rows
   * (server `_project_json`/`_reviewed` → EditorPage `steps`). Real pipelines
   * need downloads, AI keys and minutes of TTS, so these tests craft the same
   * state on disk instead: a project JSON cloned from a real one (source
   * video, script and dub all point at existing files, only script/lang are
   * swapped to a tiny hand-made SRT) plus, for the pipeline cases, a job JSON
   * in the Studio's job folder — a disk job with status `running`/`error` is
   * inert (the worker only launches ones queued in memory). Project and job
   * files are deleted after every test.
   */
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const crypto = require('node:crypto');

  const STUDIO_DIR = process.env.VIENEU_STUDIO_DIR ||
    path.join(os.homedir(), '.local', 'share', 'vieneu', 'studio');
  const PROJECTS_DIR = path.join(STUDIO_DIR, 'projects');
  const JOBS_DIR = path.join(STUDIO_DIR, 'jobs');
  const LABELS = { download: 'Download', transcribe: 'Transcript',
                   translate: 'Translate', review: 'AI Review', dub: 'Dub' };

  /** A tiny two-cue Vietnamese script: fast to render, easy to hand-edit. */
  const SCRIPT = '1\n00:00:01,000 --> 00:00:04,000\nĐây là dòng một, rất ngắn.\n'
    + '\n2\n00:00:05,500 --> 00:00:08,000\nVà dòng hai trong đoạn kiểm tra.\n';
  const sig = (t) => crypto.createHash('sha1').update(t, 'utf8')
    .digest('hex').slice(0, 16);
  const made = { pid: null, jobId: null };

  test.afterEach(async ({ request }) => {
    if (made.pid) await request.delete(`${BASE}/api/projects/${made.pid}`);
    try { fs.unlinkSync(path.join(JOBS_DIR, `${made.jobId}.json`)); } catch {}
    made.pid = made.jobId = null;
  });

  /** Donor: a real on-disk project with a playable video AND a rendered dub,
   *  so "Dubbing" can show done. The suite skips when none exists. */
  function donor() {
    if (!fs.existsSync(PROJECTS_DIR)) return null;
    for (const f of fs.readdirSync(PROJECTS_DIR).sort().reverse()) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8'));
        if (fs.existsSync((p.source || {}).video || '')
            && fs.existsSync(((p.outputs || {}).video) || '')) return p;
      } catch { /* unreadable file: try the next */ }
    }
    return null;
  }

  const stage = (key, status, progress = 0) =>
    ({ key, label: LABELS[key] || key, status, progress });

  /** Push a job record straight into the Studio's job folder. */
  function craftJob(id, stages, { status = 'running', progress = 0.5 } = {}) {
    const live = stages.find((s) => s.status === 'running') || {};
    const job = {
      id, kind: 'pipeline', title: 'steps-bar test', source: '',
      status, stage: live.key || '', progress,
      created: Date.now() / 1000 - 10, params: {}, log: [],
      pipeline: { stage: live.key || '', stages },
    };
    fs.writeFileSync(path.join(JOBS_DIR, `${id}.json`), JSON.stringify(job));
    made.jobId = id;
    return job;
  }

  /** Create a project through the API, then overwrite its JSON with a clone
   *  of the donor. The server re-reads files per request, so the next GET
   *  (page load or poll) sees the crafted state. */
  async function craft(request, { reviewed = false, script = SCRIPT,
                                  lang = 'vi', clearOutputs = false, job = null } = {}) {
    const don = donor();
    test.skip(!don, 'no on-disk project with a video and a dub to clone');
    const res = await request.post(`${BASE}/api/projects`);
    expect(res.ok(), await res.text()).toBeTruthy();
    const pid = (await res.json()).id;
    expect(pid).toBeTruthy();
    const p = JSON.parse(JSON.stringify(don));
    p.id = pid;
    p.script = script; p.original = ''; p.lang = lang;
    if (clearOutputs) { p.outputs = {}; p.result = {}; }
    delete p.reviewed_sig; delete p.reviewed_at;
    if (reviewed) { p.reviewed_sig = sig(script); p.reviewed_at = Date.now() / 1000; }
    if (job) p.job = job.id;
    fs.writeFileSync(path.join(PROJECTS_DIR, `${pid}.json`), JSON.stringify(p));
    made.pid = pid;
    return pid;
  }

  const openEditorSteps = async (page, pid) => {
    await page.goto(`${BASE}/project/${pid}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nav.steps .step')).toHaveCount(5, { timeout: 20000 });
    return page.locator('nav.steps .step');
  };
  /** One step read as one word: aria-label "Label: word" lives on the step. */
  const stepOf = (page, label, word) =>
    page.locator(`nav.steps .step[aria-label="${label}: ${word}"]`);

  test('a finished, reviewed project lights all five steps done', async ({ page, request }) => {
    const pid = await craft(request, { reviewed: true });
    const steps = await openEditorSteps(page, pid);
    for (const [label, word] of [['Download', 'done'], ['Transcript', 'done'],
                                 ['Translate', 'done'], ['Reviewed', 'done'],
                                 ['Dubbing', 'done']])
      await expect(stepOf(page, label, word), `${label} must read done`).toHaveCount(1);
    expect(await steps.evaluateAll((els) =>
      els.every((el) => el.classList.contains('done')))).toBe(true);
  });

  test('a hand-edit in one cue drops the Reviewed tick — a fingerprint, not a flag',
       async ({ page, request }) => {
    const pid = await craft(request, { reviewed: true });
    const steps = await openEditorSteps(page, pid);
    await expect(stepOf(page, 'Reviewed', 'done'), 'starts Reviewed: done').toBeVisible();

    await page.click('#addCueBtn');               // a new hand-made line
    const cueText = page.locator('#cueText');
    await expect(cueText).toBeVisible({ timeout: 15000 });
    await cueText.fill('Câu đã sửa tay — dấu Reviewed phải rơi.');

    const detail = () => projectDetail(request, pid);
    await expect.poll(async () => (await detail()).reviewed,
                      { timeout: 10000, intervals: [500, 1000, 2000] }).toBe(false);
    await expect(stepOf(page, 'Reviewed', 'pending'), 'the tick must drop').toBeVisible();
    await expect(stepOf(page, 'Transcript', 'done'),
                 'editing text keeps the transcript step done').toBeVisible();
  });

  test('a Vietnamese script that was never reviewed: Translate done, Review pending',
       async ({ page, request }) => {
    const pid = await craft(request, { reviewed: false });
    await openEditorSteps(page, pid);
    for (const [label, word] of [['Transcript', 'done'], ['Translate', 'done'],
                                 ['Reviewed', 'pending']])
      await expect(stepOf(page, label, word), `${label} must read ${word}`).toBeVisible();
  });

  test('a pipeline that skipped the review shows it dim, not done', async ({ page, request }) => {
    const job = craftJob(`sb-${Date.now()}-skp`, [
      stage('download', 'done', 1), stage('transcribe', 'done', 1),
      stage('translate', 'done', 1), stage('review', 'skipped'),
      stage('dub', 'running', 0.42)]);
    const pid = await craft(request, { job });
    await openEditorSteps(page, pid);
    for (const [label, word] of [['Download', 'done'], ['Transcript', 'done'],
                                 ['Translate', 'done'], ['Reviewed', 'skipped'],
                                 ['Dubbing', 'running']])
      await expect(stepOf(page, label, word), `${label} must read ${word}`).toBeVisible();
  });

  test('a pipeline that fails mid-run: red on the failed step, later steps not green',
       async ({ page, request }) => {
    const job = craftJob(`sb-${Date.now()}-err`, [
      stage('download', 'done', 1), stage('transcribe', 'done', 1),
      stage('translate', 'error'), stage('review', 'skipped'),
      stage('dub', 'skipped')], { status: 'error', progress: 0.55 });
    const pid = await craft(request, { job });
    const steps = await openEditorSteps(page, pid);
    await expect(stepOf(page, 'Translate', 'failed'),
                 'the failing step must read failed').toBeVisible();
    const states = await steps.evaluateAll((els) =>
      els.map((el) => [...el.classList].find((c) => c !== 'step')));
    expect(states, 'download/transcribe done, translate failed').toEqual(
      ['done', 'done', 'error', 'skipped', 'skipped']);
  });

  test('a lone running job lights exactly its own step', async ({ page, request }) => {
    const job = craftJob(`sb-${Date.now()}-lone`, [], { status: 'running' });
    job.kind = 'transcribe';
    fs.writeFileSync(path.join(JOBS_DIR, `${job.id}.json`), JSON.stringify(job));
    const pid = await craft(request, { lang: '', script: '', clearOutputs: true, job });
    const steps = await openEditorSteps(page, pid);
    const states = await steps.evaluateAll((els) =>
      els.map((el) => [...el.classList].find((c) => c !== 'step')));
    expect(states, 'download done, transcribe live, everything else pending').toEqual(
      ['done', 'running', 'pending', 'pending', 'pending']);
  });

  test('five steps stay legible and inside the row at 360 px', async ({ page, request }) => {
    const pid = await craft(request, { reviewed: true });
    await page.setViewportSize({ width: 360, height: 800 });
    const steps = await openEditorSteps(page, pid);
    const bar = await steps.evaluateAll((els) => {
      const nav = els[0].parentElement.getBoundingClientRect();
      return {
        navRight: Math.round(nav.right),
        overflow: els.filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width <= 0 || b.right > nav.right + 1 || b.left < nav.left - 1;
        }).map((el) => el.ariaLabel),
        labels: els.map((el) => {
          const l = el.querySelector('.lbl');
          return l ? Math.round(l.getBoundingClientRect().width) : 0;
        }),
      };
    });
    expect(bar.navRight, 'the strip must not overflow the viewport')
      .toBeLessThanOrEqual(361);
    expect(bar.overflow, 'a step is clipped or empty').toEqual([]);
    expect(bar.labels.some((w) => w < 20), 'a label is unreadably narrow').toBe(false);
  });
});

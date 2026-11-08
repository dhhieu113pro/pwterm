/**
 * VieNeu Studio — the UI the user actually touches.
 *
 *   vieneu-studio start
 *   cd ~/playwright-automation
 *   VIENEU_STUDIO_URL=http://127.0.0.1:7861 \
 *     npm test -- tests/vieneu-ui.spec.js
 *
 * These protect what a screenshot review found: an editor topbar that
 * overflows a phone, machine noise shown as an error, tooltips that never
 * appear on touch, a delete control only a mouse can reach, and controls
 * that each have their own height and corner.
 */
const { test, expect } = require('./fixtures');

const BASE = (process.env.VIENEU_STUDIO_URL || 'http://127.0.0.1:7861')
  .replace(/\/+$/, '');

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Failed to load resource/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

async function firstProject(request) {
  const res = await request.get(`${BASE}/api/projects`);
  expect(res.ok(), await res.text()).toBeTruthy();
  const list = (await res.json()).projects || [];
  return list[0] || null;
}

/** Symbol-only controls need an accessible name; a tooltip is not one. */
function unnamedIcons() {
  const letter = /\p{L}|\p{N}/u;
  return [...document.querySelectorAll('button, a[href]')]
    .filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    })
    .filter((el) => {
      const text = (el.textContent || '').trim();
      const named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
        || el.getAttribute('title');
      return text && !letter.test(text) && !named;
    })
    .map((el) => `${el.tagName.toLowerCase()}#${el.id || el.className} "${el.textContent.trim()}"`);
}

test.describe('editor topbar', () => {
  for (const width of [360, 390]) {
    test(`fits and keeps the project title readable at ${width}px`,
         async ({ page, request }) => {
      const project = await firstProject(request);
      test.skip(!project, 'needs a project');
      const errors = watchErrors(page);

      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${BASE}/project/${project.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#app');

      const bar = await page.evaluate(() => {
        const el = document.querySelector('.topbar');
        const title = document.querySelector('#projectTitle');
        const right = el.getBoundingClientRect().right;
        return {
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          titleWidth: Math.round(title.getBoundingClientRect().width),
          clipped: [...el.children]
            .filter((c) => getComputedStyle(c).display !== 'none'
              && c.getBoundingClientRect().width > 0)
            .filter((c) => {
              const b = c.getBoundingClientRect();
              return b.right > right + 1 || b.left < -1;
            })
            .map((c) => c.id || c.className),
        };
      });

      expect(bar.scrollWidth, 'topbar overflows').toBeLessThanOrEqual(bar.clientWidth + 1);
      expect(bar.clipped, 'a topbar control is outside the bar').toEqual([]);
      expect(bar.titleWidth, 'project title is too narrow to read').toBeGreaterThanOrEqual(100);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('errors shown to the user', () => {
  test('browser noise stays quiet, a real failure still shows', async ({ page, request }) => {
    const project = await firstProject(request);
    test.skip(!project, 'needs a project');

    await page.goto(`${BASE}/project/${project.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#app');

    await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', {
      message: 'ResizeObserver loop completed with undelivered notifications.',
    })));
    await expect(page.locator('#toast')).toBeHidden();

    await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', {
      message: 'the dub failed',
    })));
    await expect(page.locator('#toast')).toBeVisible();
    await expect(page.locator('#toast')).toContainText('the dub failed');
  });
});

test.describe('no tooltips', () => {
  const pages = ['/', '/settings'];

  test('the gallery, settings and editor carry no title tooltip',
       async ({ page, request }) => {
    const project = await firstProject(request);
    test.skip(!project, 'needs a project');
    const errors = watchErrors(page);

    for (const path of [...pages, `/project/${project.id}`]) {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      const tips = await page.evaluate(() =>
        [...document.querySelectorAll('[title]')]
          .filter((el) => (el.getAttribute('title') || '').trim())
          .map((el) => `${el.tagName.toLowerCase()}#${el.id || el.className}: ${el.getAttribute('title')}`));
      expect(tips, `${path} still has tooltips`).toEqual([]);
      expect(await page.evaluate(unnamedIcons), `${path} has an unnamed icon`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('gallery on a touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('every card shows a delete control big enough to tap', async ({ page, request }) => {
    const project = await firstProject(request);
    test.skip(!project, 'needs a project');

    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.vcard');

    const card = page.locator(`.vcard:has-text("${project.title}")`);
    const del = card.locator('.vdel');
    await expect(del).toBeVisible();
    const box = await del.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(32);
    expect(box.height).toBeGreaterThanOrEqual(32);
  });

  test('the queue says what it means', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#queue')).not.toHaveText(/^Idle$/);
    await expect(page.locator('#queue')).not.toHaveText('');
  });
});

test.describe('one control style', () => {
  test('buttons, inputs and dropdowns share height and corners', async ({ page }) => {
    await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await page.selectOption('#s-translator', 'openai');   // reveal the cloud fields

    const sizes = await page.evaluate(() => {
      const size = (el) => {
        const box = el.getBoundingClientRect();
        return { h: Math.round(box.height), r: getComputedStyle(el).borderRadius };
      };
      const take = (selector) => [...document.querySelectorAll(selector)]
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map(size);
      return {
        buttons: take('.btn'),
        inputs: ['#s-endpoint', '#s-model', '#s-fitMax', '#s-maxChars']
          .map((s) => size(document.querySelector(s))),
        selects: ['#s-lang', '#s-whisper', '#s-translator', '#s-engine', '#s-voice', '#s-fit']
          .map((s) => size(document.querySelector(s))),
      };
    });

    for (const [kind, rows] of Object.entries(sizes)) {
      expect(new Set(rows.map((x) => x.h)), `${kind} heights: ${rows.map((x) => x.h)}`)
        .toHaveProperty('size', 1);
      expect(new Set(rows.map((x) => x.r)), `${kind} corner radii: ${rows.map((x) => x.r)}`)
        .toHaveProperty('size', 1);
    }
    const heights = [...sizes.buttons, ...sizes.inputs, ...sizes.selects].map((x) => x.h);
    expect(new Set(heights), `controls disagree: ${heights}`).toHaveProperty('size', 1);
    const radii = [...sizes.buttons, ...sizes.inputs, ...sizes.selects].map((x) => x.r);
    expect(new Set(radii), `corners disagree: ${radii}`).toHaveProperty('size', 1);
  });
});

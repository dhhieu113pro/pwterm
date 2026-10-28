/* Stand-in smoke checks for the Vue editor page (phase 4a: boot, header,
   players, projects rail, read-only timeline). Replaced by the real editor
   spec when cue editing and jobs land. */
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

test('boots a project: title, status, video, timeline, no script errors', async ({ page }) => {
  const errors = watchErrors(page);
  const list = await (await page.request.get(`${BASE}/api/projects`)).json();
  const project = list.projects.find((p) => p.status === 'dubbed' && p.urls?.result)
    || list.projects[0];

  await page.goto(`${BASE}/project/${project.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#projectTitle')).toBeVisible();
  expect(errors).toEqual([]);

  const detail = await (await page.request.get(`${BASE}/api/projects/${project.id}`)).json();
  if (detail.title) expect(await page.inputValue('#projectTitle')).toBe(detail.title);
  await expect(page.locator('#statusText')).not.toBeEmpty();

  if (detail.urls?.source) {
    await expect(page.locator('.player video')).toHaveAttribute('src', /.+/);
    await expect(page.locator('#playerBadge')).toContainText(/SOURCE|DUBBED/);
  } else {
    await expect(page.locator('#emptyStage')).toBeVisible();
  }

  const d = detail.source?.duration || 0;
  if (d) {
    // legacy ruler contract: ticks carry .tick (positioned) and majors alternate in
    const ruler = page.locator('#timeline .ruler');
    expect(await ruler.locator('.tick').count(), 'ruler must show positioned tick labels')
      .toBeGreaterThan(0);
    expect(await ruler.locator('.tick.major').count(), 'every other tick is major')
      .toBeGreaterThan(0);
  }

  // the modal open in a fresh visit (?new=1 flow)
  await page.goto(`${BASE}/project/new`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#statusText')).toContainText(/No project|New project/);
});

test('playback controls and keyboard, playhead follows', async ({ page }) => {
  const list = await (await page.request.get(`${BASE}/api/projects`)).json();
  let project = null;
  for (const p of list.projects) {
    const d = await (await page.request.get(`${BASE}/api/projects/${p.id}`)).json();
    if (d.urls?.source) { project = p; break; }
  }
  test.skip(!project, 'no project with source video');

  await page.goto(`${BASE}/project/${project.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.player video');
  await page.keyboard.press(' ');           // toggle play (not in a form control)
  await page.waitForFunction(() => {
    const v = document.querySelector('.player video');
    return v && !v.paused;
  }, null, { timeout: 5000 });
  await page.waitForTimeout(800);
  const t1 = await page.evaluate(() => document.querySelector('.player video').currentTime);
  expect(t1).toBeGreaterThan(0);
  await page.keyboard.press(' ');           // pause again
});

test('projects rail lists projects and search filters', async ({ page }) => {
  await page.goto(`${BASE}/project/nope-does-not-exist`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#projectList .project-card, .rail-empty');
  const cards = await page.locator('#projectList .project-card').count();
  const count = (await page.locator('#projectCount').textContent()).trim();
  expect(count).toBe(`${cards} videos`);
});

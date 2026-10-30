/* /voice → Hội thoại smoke: cast rows, Enter lines, paste-import, one real
 * Turbo line through the dialog job, history gains a dialog- wav. */
const test = require('@playwright/test');

const BASE = (process.env.VIENEU_STUDIO_URL || 'http://127.0.0.1:7861')
  .replace(/\/+$/, '');

test.use({ viewport: { width: 1440, height: 900 } });
test.beforeEach(() => test.setTimeout(180_000)); // real TTS in the loop

const TURBO = 'Turbo int8 · 48 kHz';

async function freshDraft(page) {
  await page.request.delete(`${BASE}/api/dialog/draft`);
  await page.goto(`${BASE}/voice`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Hội thoại' }).first().click();
  await test.expect(page.locator('.dlg-bar h1')).toHaveText('Hội thoại');
  // engine first — the voice options load for that model
  await page.locator('.dlg-bar .dlg-sel').selectOption(TURBO);
}

async function addActor(page, name, nth) {
  await page.getByRole('button', { name: 'Thêm diễn viên' }).click();
  await page.locator('.dlg-nm').nth(nth).fill(name);
  // engine model load can take a while: wait until the select has real options
  await test.expect.poll(async () =>
    page.locator('.dlg-row').nth(nth)
      .locator('option:not([value=""])').count(),
    { timeout: 60_000 }).toBeGreaterThan(0);
  await page.locator('.dlg-row .dlg-sel').nth(nth).selectOption({ index: 1 });
}

test('dialog panel: cast, chat lines, paste-import gate, real generate', async ({ page }) => {
  await freshDraft(page);

  // two cast rows with voice picks
  await addActor(page, 'Minh', 0);
  await addActor(page, 'Lan', 1);

  // two Enter lines: bubble shows the right speaker, who-a/who-b parity
  await page.locator('.dlg-compose select.dlg-sel').selectOption('Minh');
  await page.locator('.dlg-compose input').fill('Xin chào Lan.');
  await page.locator('.dlg-compose input').press('Enter');
  await page.locator('.dlg-compose select.dlg-sel').selectOption('Lan');
  await page.locator('.dlg-compose input').fill('Chào Minh nhé.');
  await page.locator('.dlg-compose input').press('Enter');
  await test.expect(page.locator('.dlg-msg')).toHaveCount(2);
  await test.expect(page.locator('.dlg-msg.who-a .dlg-who').first())
    .toHaveText(/Minh/);
  await test.expect(page.locator('.dlg-msg.who-b .dlg-who').first())
    .toHaveText(/Lan/);

  // paste-import: Mai joins the cast, generate locks with the voice reason
  const before = await page.locator('.dlg-row').count();
  await page.locator('.dlg-paste summary').click();
  await page.locator('.dlg-ta')
    .fill('Minh: Câu dán của Minh.\nMai: Câu dán của Mai.');
  await page.getByRole('button', { name: 'Dịch ngay vào hội thoại' }).click();
  await test.expect(page.locator('.dlg-row')).toHaveCount(before + 1);
  await test.expect(page.locator('.dlg-nm').nth(2)).toHaveValue('Mai');
  await test.expect(page.locator('.dlg-msg')).toHaveCount(4);
  await test.expect(page.locator('.dlg-go')).toBeDisabled();
  await test.expect(page.locator('.dlg-busy'))
    .toContainText('Chưa có diễn viên nào được chọn giọng');

  // give Mai a voice — the lock clears
  await page.locator('.dlg-row .dlg-sel').nth(2).selectOption({ index: 1 });
  await test.expect(page.locator('.dlg-go')).toBeEnabled();

  // one short Turbo line only: trim the tape to Mai's pasted line
  while (await page.locator('.dlg-del').count() > 1)
    await page.locator('.dlg-del').first().click();
  await test.expect(page.locator('.dlg-msg')).toHaveCount(1);

  // generate and poll the job to done
  const [gen] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/dialog/generate')),
    page.locator('.dlg-bar .dlg-go').click(),
  ]);
  const jid = (await gen.json()).job;
  const deadline = Date.now() + 90_000;
  let job = null;
  while (Date.now() < deadline) {
    job = await (await page.request.get(
      `${BASE}/api/dialog/job/${jid}`)).json();
    if (job.status === 'done') break;
    test.expect(job.status).not.toBe('error');
    await page.waitForTimeout(2000);
  }
  test.expect(job?.status).toBe('done');
  await test.expect(
    page.locator(`audio[src="${job.result.url}"]`)).toBeAttached();

  // history gains a dialog- wav
  const items = await (await page.request.get(`${BASE}/api/history`)).json();
  test.expect(items.some((it) => /\/dialog-.*\.wav/.test(it.url))).toBe(true);

  // tab strip still navigates, and the draft survives the round trip
  await page.getByRole('button', { name: 'Đọc văn bản' }).first().click();
  await page.getByRole('button', { name: 'Hội thoại' }).first().click();
  await test.expect(page.locator('.dlg-msg')).toHaveCount(1);
});

test('nav regression: /voice desktop shell still renders under the chat tab', async ({ page }) => {
  await freshDraft(page);
  await test.expect(page.locator('.v-navi').first()).toBeVisible();
  await test.expect(page.locator('._v-navi')).toHaveCount(0);
});

/* /voice — CIT Voice Studio (text-to-speech workspace).
 * Runs against the local Studio (vieneu-studio start):
 *   VIENEU_STUDIO_URL=http://127.0.0.1:7861 npm test -- tests/vieneu-voice.spec.js
 * Desktop-first per the spec; the generate test produces one real preview
 * through the engine (a few seconds), nothing is stubbed. */
const test = require('@playwright/test');

const BASE = (process.env.VIENEU_STUDIO_URL || 'http://127.0.0.1:7861')
  .replace(/\/+$/, '');

test.use({ viewport: { width: 1440, height: 900 } });
test.beforeEach(() => test.setTimeout(90_000)); // real TTS in the loop

async function voices(request) {
  const res = await request.get(`${BASE}/api/voices`);
  return (await res.json());
}

test('shell, sample text and real voice list load', async ({ page, request }) => {
  const api = await voices(request);
  await page.goto(`${BASE}/voice`);
  await test.expect(page.getByText('CIT Voice Studio')).toBeVisible();
  await test.expect(page.locator('.e-head h1')).toHaveText('Đọc văn bản');
  await test.expect(page.locator('.e-text')).not.toBeEmpty();
  // voices come from the engine, selected row = server default
  const count = api.voices.length;
  test.expect(count).toBeGreaterThan(0);
  await test.expect(page.locator('.v-list .voice')).toHaveCount(count);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wantVoice = new RegExp(api.default ? esc(api.default) : esc(api.voices[0].id));
  await test.expect(page.locator('.voice.on .v-name')).toHaveText(wantVoice);
  // header shows the real engine
  await test.expect(page.locator('.status-txt')).toContainText(api.engine);
});

test('gender filter uses the engine labels', async ({ page, request }) => {
  const api = await voices(request);
  const females = api.voices.filter((v) => /—\s*Nữ\b/.test(v.label)).length;
  const males = api.voices.length - females;
  test.expect(females + males).toBeGreaterThan(0);
  await page.goto(`${BASE}/voice`);
  if (females) {
    await page.getByRole('button', { name: 'Nữ', exact: true }).click();
    await test.expect(page.locator('.v-list .voice')).toHaveCount(females);
  }
  if (males) {
    await page.getByRole('button', { name: 'Nam', exact: true }).click();
    await test.expect(page.locator('.v-list .voice')).toHaveCount(males);
  }
});

test('clear keeps an undo, clean normalizes, stats follow the text', async ({ page }) => {
  await page.goto(`${BASE}/voice`);
  const stats1 = await page.locator('.e-meta').innerText();
  // clean: two spaces and blank lines collapse
  await page.locator('.e-text').fill('a   b\n\n\n\nc ,  d');
  await page.getByRole('button', { name: 'Làm sạch' }).click();
  await test.expect(page.locator('.e-text')).toHaveValue('a b\n\nc, d');
  const stats2 = await page.locator('.e-meta').innerText();
  test.expect(stats2).not.toBe(stats1);
  // clear + undo chip restores
  await page.getByRole('button', { name: 'Xóa toàn bộ văn bản' }).click();
  await test.expect(page.locator('.e-text')).toHaveValue('');
  await test.expect(page.locator('.gen')).toBeDisabled();
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
  await test.expect(page.locator('.e-text')).toHaveValue('a b\n\nc, d');
});

test('generate produces real preview audio and the player follows', async ({ page }) => {
  await page.goto(`${BASE}/voice`);
  await page.locator('.e-text').fill('Kiểm tra phát âm từ CIT Voice Studio.');
  await page.getByRole('button', { name: 'Tạo giọng đọc' }).click();
  // real engine render: wait for the media element with the preview url
  const audio = page.locator('audio[src*="/api/preview/"]');
  await audio.waitFor({ state: 'attached', timeout: 60_000 });
  await page.getByRole('button', { name: 'Phát', exact: true }).click();
  await test.expect(page.locator('.p-stat')).toContainText('Đang phát');
  await page.getByRole('button', { name: 'Tạm dừng' }).click();
  await test.expect(page.locator('.p-stat')).toContainText('Sẵn sàng');
  // export menu: real WAV link, MP3 disabled honestly
  // this Chromium does not expose <summary> as role=button — use the locator
  await page.locator('.export summary').click();
  await test.expect(page.locator('.exp-menu a'))
    .toHaveAttribute('href', /api\/preview\//);
  await test.expect(page.locator('.exp-menu .exp-dis').last())
    .toContainText('MP3 — chưa được hỗ trợ');
});

test('model dialog and theme toggle work', async ({ page }) => {
  await page.goto(`${BASE}/voice`);
  await page.getByRole('button', { name: 'Đổi mô hình' }).click();
  await test.expect(page.locator('.dialog .d-head h2')).toHaveText('Đổi mô hình');
  await test.expect(page.getByRole('button', { name: 'Áp dụng' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await test.expect(page.locator('.dialog')).toHaveCount(0);
  // moon flips html.dark (PrimeVue dark selector)
  const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.locator('.v-status .v-btn.icon.mini').click();
  await test.expect.poll(() =>
    page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(!dark);
});

test('phone width: panel becomes a drawer behind its toggle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/voice`);
  await test.expect(page.locator('.v-panel')).not.toBeInViewport();
  await page.getByRole('button', { name: 'Bảng giọng đọc' }).click();
  await test.expect(page.locator('.v-panel')).toBeInViewport();
});

// ── clone + engine parity (Task 4, plan 2026-10-30-voice-real-engine) ──

test('clone page: form and my-voices render', async ({ page }) => {
  await page.goto(`${BASE}/voice`);
  await page.getByRole('button', { name: 'Nhân bản giọng' }).click();
  await test.expect(page.locator('.clone-card h1')).toHaveText('Nhân bản giọng');
  // clip hint + engine-kind note reference the real engine label
  await test.expect(page.locator('.enroll .v-note'))
    .toContainText('3–8 giây');
  await test.expect(page.locator('.enroll .v-note'))
    .toContainText(/Nano|Turbo/);
  // save stays honest: nothing submitted without a name + a clip
  await page.locator('.clone-card .gen').click();
  await test.expect(page.locator('#toast:not(.hidden)')).toContainText('Đặt tên');
});

// The real clone loop (enroll a 5 s sample under Nano, see it in the Turbo
// mirror check, delete it) is opt-in: it loads two engine models and writes
// ~/.vieneu/user_voices_v3_nano.json + voice files. Default skip keeps the
// everyday suite cheap.
const CLONE_E2E = process.env.VIENEU_E2E_CLONE === '1';
const cloneTest = CLONE_E2E ? test : test.skip;

cloneTest('real clone roundtrip (enroll → notices per engine → delete)', async ({ page, request }) => {
  // 5 s reference tone, a clone just needs a decodable audio file
  const wav = `${process.env.PREFIX}/tmp/clone-e2e-${Date.now()}.wav`;
  const { execSync } = require('node:child_process');
  execSync(`ffmpeg -y -v error -f lavfi -i "sine=frequency=620:duration=5" -ar 24000 "${wav}"`);
  const name = `E2E ${Date.now()}`;
  const nano = await voices(request);   // Nano rows before the clone
  const nanoMine = nano.voices.filter((v) => v.mine).length;

  await page.goto(`${BASE}/voice`);
  await page.getByRole('button', { name: 'Nhân bản giọng' }).click();
  await test.expect(page.locator('.c-list .voice')).toHaveCount(nanoMine);
  await page.locator('.c-file').setInputFiles(wav);
  await page.locator('.c-in').first().fill(name);
  await page.locator('.clone-card .gen').click();
  // enroll loads the engine + writes json on-device: ~9 s warm, longer cold
  await test.expect(page.locator('#toast:not(.hidden)'))
    .toContainText(`Đã lưu giọng ${name}`, { timeout: 60_000 });
  // engine-kind binding (Review Focus #1): Mine exists in the Nano list
  const nanoAfter = await voices(request);
  test.expect(nanoAfter.voices.filter((v) => v.mine).map((v) => v.id)).toContain(name);
  // ... and not in the Turbo list without switching engines
  const turbo = await request.get(`${BASE}/api/voices?engine=${
    encodeURIComponent('Turbo int8 · 48 kHz')}`).then((r) => r.json());
  test.expect(turbo.voices.filter((v) => v.mine).map((v) => v.id)).not.toContain(name);

  // delete it again
  await page.on('dialog', (d) => d.accept());   // removeVoice confirm
  await page.locator('.c-list .voice', { hasText: name })
    .getByRole('button', { name: new RegExp(`Xóa giọng ${name}`) }).click();
  await page.reload({ waitUntil: 'networkidle' });
  const nanoClean = await voices(request);
  test.expect(nanoClean.voices.filter((v) => v.mine).map((v) => v.id)).not.toContain(name);
});

test('engine switch follows the voice list and persists', async ({ page }) => {
  await page.goto(`${BASE}/voice`);
  const firstNano = await page.locator('.voice .v-name').first().innerText();
  // switch to Turbo int8 through the model dialog
  await page.locator('.status-txt').click();
  await page.locator('.model-row').nth(1).click();
  await page.locator('.dialog .v-btn.teal').click();
  // real model load: allow up to 60 s for the voice list to come back
  await test.expect(page.locator('.status-txt')).toContainText('Turbo int8 · 48 kHz', { timeout: 60_000 });
  // cold Turbo load empties the panel while voices stream in
  await test.expect(page.locator('.voice .v-name').first())
    .not.toHaveText(firstNano, { timeout: 60_000 });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cit.voice.settings') || '{}'));
  test.expect(stored.engine).toBe('Turbo int8 · 48 kHz');
  // reload: the whole app comes back on the saved engine (no console errors)
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.reload({ waitUntil: 'networkidle' });
  await test.expect(page.locator('.status-txt')).toContainText('Turbo int8 · 48 kHz', { timeout: 60_000 });
  test.expect(errors).toEqual([]);
});

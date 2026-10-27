/**
 * VieNeu Studio — the whole product in one test.
 *
 *   link → download → transcript → Vietnamese translation → dub → playable file
 *
 * It is slow and it spends provider quota, so it only runs when you give it a
 * link:
 *
 *   VIENEU_E2E_PIPELINE_URL='https://youtu.be/…' \
 *   VIENEU_STUDIO_URL=http://127.0.0.1:7861 \
 *     npm test -- tests/vieneu-pipeline.spec.js
 *
 * Useful knobs:
 *   VIENEU_E2E_BACKEND=local     force the offline translator (no API key)
 *   VIENEU_E2E_PROVIDER=OpenRouter   pick a saved provider by label
 *   VIENEU_E2E_KEEP=1            keep the project (and save the mp4) for review
 *   VIENEU_E2E_DOWNLOAD_DIR=…    where to write the dubbed mp4
 *   VIENEU_E2E_TIMEOUT_MS=…      overall budget, default 60 min
 *
 * The test drives the real Auto dialog, then watches the live job over the API
 * (the page's progress bar is checked too). Ground truth is the API: every
 * stage must end "done", the transcript must be Vietnamese, and the result must
 * be a seekable MP4 with an audio track that Chromium can decode and play.
 */
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASE = (process.env.VIENEU_STUDIO_URL || 'http://127.0.0.1:7861')
  .replace(/\/+$/, '');
const LINK = (process.env.VIENEU_E2E_PIPELINE_URL || '').trim();
const BACKEND = (process.env.VIENEU_E2E_BACKEND || '').toLowerCase(); // local|openai
const PROVIDER = process.env.VIENEU_E2E_PROVIDER || '';
const KEEP = process.env.VIENEU_E2E_KEEP === '1';
const OUT = process.env.VIENEU_E2E_DOWNLOAD_DIR
  || path.join(__dirname, '..', 'artifacts');
const BUDGET = Number(process.env.VIENEU_E2E_TIMEOUT_MS || 60 * 60 * 1000);
const POLL = 5000;

const VI_DIACRITICS = /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i;

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  return errors;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function detail(request, id) {
  const res = await request.get(`${BASE}/api/projects/${id}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

/** Poll until the project reaches a terminal status, keeping a timeline. */
async function waitForPipeline(request, id, deadline, onTick) {
  const seen = [];
  let lastStage = '';
  let lastProgress = -1;
  let stuckSince = Date.now();

  while (Date.now() < deadline) {
    const p = await detail(request, id);
    const job = p.job || {};
    const stage = job.stage || '';
    const progress = Number(job.progress || 0);
    const stamp = `${p.status}/${stage || job.kind || '-'}/${Math.round(progress * 100)}%`;
    if (stamp !== seen[seen.length - 1]) seen.push(stamp);

    if (stage !== lastStage || progress > lastProgress) {
      lastStage = stage;
      lastProgress = progress;
      stuckSince = Date.now();
    }
    if (onTick) await onTick(p, seen);
    if (['dubbed', 'error'].includes(p.status)) return { project: p, seen };

    // A pipeline that has not moved for 15 min is dead, not slow.
    if (Date.now() - stuckSince > 15 * 60 * 1000) {
      throw new Error(`pipeline stalled at ${stamp}\n` +
                      (job.log || []).join('\n'));
    }
    await sleep(POLL);
  }
  throw new Error(`pipeline did not finish within the budget; seen: ${seen.join(' → ')}`);
}

function ffprobe(url) {
  try {
    const raw = execFileSync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_streams', url],
      { encoding: 'utf8', timeout: 120000 });
    return JSON.parse(raw).streams || [];
  } catch (err) {
    if (err.code === 'ENOENT') return null;      // no ffprobe: skip that check
    throw err;
  }
}

test.describe('VieNeu Studio · full auto pipeline', () => {
  test.skip(!LINK, 'set VIENEU_E2E_PIPELINE_URL to a YouTube/TikTok link to run');

  test('link → transcript → translation → dub → playable video',
       async ({ page, request }, testInfo) => {
    test.setTimeout(BUDGET + 120000);
    const errors = watchErrors(page);
    fs.mkdirSync(OUT, { recursive: true });
    let pid = '';
    let done = false;

    try {
      /* ── 1. start it from the gallery, through the real dialog ───────── */
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.vcard, #empty:not(.hidden)').first())
        .toBeVisible();
      await page.click('#autoBtn');
      await expect(page.locator('#autoModal')).toBeVisible();

      await page.fill('#pipeUrl', LINK);
      if (BACKEND === 'local') {
        // "— none / type endpoint" = the offline model, no provider/key.
        const none = await page.evaluate(() => {
          const sel = document.querySelector('#pipeProvider');
          const opt = [...sel.options].find((o) => /none|offline/i.test(o.textContent));
          return opt ? opt.value : '';
        });
        await page.selectOption('#pipeProvider', none);
      } else if (PROVIDER) {
        const value = await page.evaluate((needle) => {
          const sel = document.querySelector('#pipeProvider');
          const opt = [...sel.options].find((o) => o.textContent.includes(needle));
          return opt ? opt.value : null;
        }, PROVIDER);
        expect(value, `provider "${PROVIDER}" is not in the Auto dialog`).not.toBeNull();
        await page.selectOption('#pipeProvider', value);
      }
      if (!(await page.locator('#pipeTranslate').isChecked())) {
        await page.check('#pipeTranslate');
      }
      await page.check('#pipeDub');

      const started = Date.now();
      await page.click('#pipeGo');
      await page.waitForURL(/\/project\/[^/]+$/, { timeout: 30000 });
      pid = page.url().split('/project/')[1].split(/[?#]/)[0];
      await page.waitForSelector('#pipelineBar:not(.hidden)', { timeout: 20000 });
      await testInfo.attach('started', {
        body: JSON.stringify({ pid, link: LINK, backend: BACKEND || 'auto',
                               provider: PROVIDER || 'auto' }, null, 2),
        contentType: 'application/json',
      });

      /* ── 2. watch the four stages, checking the UI mirrors the job ───── */
      const deadline = Date.now() + BUDGET;
      const bars = new Set();
      let shotMid = false;

      const { project: final, seen } = await waitForPipeline(
        request, pid, deadline, async (p) => {
          const bar = await page.evaluate(() => {
            const el = document.querySelector('#pbStage');
            const pct = document.querySelector('#pbPct');
            return el && !el.closest('.hidden')
              ? `${el.textContent.trim()} ${pct ? pct.textContent.trim() : ''}`
              : '';
          });
          if (bar) bars.add(bar);
          if (!shotMid && (p.job?.progress || 0) > 0.2) {
            shotMid = true;
            await page.screenshot({ path: path.join(OUT, 'pipeline-running.png') })
              .catch(() => {});
          }
        });

      const job = final.job || {};
      const stages = job.pipeline?.stages || [];
      await testInfo.attach('timeline', {
        body: JSON.stringify({ pid, elapsed_s: Math.round((Date.now() - started) / 1000),
                               seen, stages, log: (job.log || []).slice(-25) },
                             null, 2),
        contentType: 'application/json',
      });

      if (final.status === 'error') {
        throw new Error(`pipeline failed: ${final.note || job.error}\n` +
                        (job.log || []).join('\n'));
      }
      expect(final.status, `job log:\n${(job.log || []).join('\n')}`).toBe('dubbed');

      // every stage ran, in order, and the job itself finished
      expect(stages.map((s) => s.key)).toEqual(['download', 'transcribe',
                                                'translate', 'dub']);
      expect(stages.map((s) => s.status)).toEqual(['done', 'done', 'done', 'done']);
      expect(job.status).toBe('done');
      expect(Number(job.progress)).toBeGreaterThan(0.99);
      expect(bars.size, 'the progress bar showed live text').toBeGreaterThan(0);

      /* ── 3. the transcript and its Vietnamese translation ────────────── */
      expect(final.lang).toBe('vi');
      expect(final.cues.length).toBeGreaterThan(0);
      expect(final.cues.every((c) => c.text.trim().length > 0)).toBeTruthy();
      expect(final.cues.every((c) => c.end > c.start)).toBeTruthy();

      const viCues = final.cues.filter((c) => VI_DIACRITICS.test(c.text));
      expect(viCues.length / final.cues.length,
             `only ${viCues.length}/${final.cues.length} cues look Vietnamese`)
        .toBeGreaterThan(0.6);

      if (final.original_cues?.length) {
        const ratio = final.cues.reduce((n, c) => n + c.text.length, 0)
                    / Math.max(1, final.original_cues.reduce((n, c) => n + c.text.length, 0));
        expect(ratio, `translation length ratio ${ratio.toFixed(2)}`)
          .toBeGreaterThan(0.4);
        expect(ratio).toBeLessThan(3);
      }

      const srt = await request.get(BASE + final.urls.srt);
      expect(srt.status()).toBe(200);
      expect((await srt.text()).trim().length).toBeGreaterThan(0);

      /* ── 4. the delivered file: MP4, seekable, with audio ────────────── */
      const file = await request.get(BASE + final.urls.result);
      expect(file.status()).toBe(200);
      expect(file.headers()['content-type']).toMatch(/video\/mp4/);
      expect((await file.body()).length).toBeGreaterThan(50 * 1024);

      const range = await request.get(BASE + final.urls.result,
                                      { headers: { Range: 'bytes=0-99' } });
      expect(range.status()).toBe(206);
      expect((await range.body()).length).toBe(100);

      const streams = ffprobe(BASE + final.urls.result);
      if (streams) {
        const audio = streams.find((s) => s.codec_type === 'audio');
        const video = streams.find((s) => s.codec_type === 'video');
        expect(audio, 'the dub has an audio track').toBeTruthy();
        expect(Number(audio.channels)).toBeGreaterThan(0);
        expect(video, 'the dub has a video track').toBeTruthy();
        await testInfo.attach('probe', {
          body: JSON.stringify({
            video: { codec: video.codec_name, width: video.width, height: video.height,
                     duration: video.duration },
            audio: { codec: audio.codec_name, channels: audio.channels,
                     sample_rate: audio.sample_rate, duration: audio.duration },
          }, null, 2),
          contentType: 'application/json',
        });
      } else {
        testInfo.annotations.push({ type: 'note', description: 'ffprobe not found — audio track not probed' });
      }

      /* ── 5. the editor plays the finished dub ────────────────────────── */
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#projectTitle')).not.toHaveValue('', { timeout: 30000 });
      await page.click('#viewSeg button[data-view="Dubbed"]');
      await page.waitForFunction(() => {
        const v = document.querySelector('#video');
        return v && v.readyState >= 2 && v.videoWidth > 0;
      }, null, { timeout: 60000 });

      const decoded = await page.evaluate(() => {
        const v = document.querySelector('#video');
        return { src: v.currentSrc, width: v.videoWidth, height: v.videoHeight,
                 duration: v.duration,
                 error: v.error ? { code: v.error.code, message: v.error.message } : null };
      });
      expect(decoded.error, JSON.stringify(decoded.error)).toBeNull();
      expect(decoded.src).toContain('/result');
      expect(decoded.width).toBeGreaterThan(0);
      expect(Math.abs(decoded.duration - final.duration)).toBeLessThan(2);

      await page.evaluate(async () => {
        const v = document.querySelector('#video');
        v.muted = true;
        await v.play();
      });
      await page.waitForFunction(() => document.querySelector('#video').currentTime > 0.3,
                                 null, { timeout: 30000 });

      await page.screenshot({ path: path.join(OUT, 'pipeline-dubbed.png') })
        .catch(() => {});
      expect(errors).toEqual([]);

      testInfo.annotations.push({
        type: 'pipeline',
        description: JSON.stringify({
          pid, cues: final.cues.length,
          duration_s: Math.round(final.duration),
          result_mb: final.result?.size_mb ?? null,
          engine: final.result?.engine ?? null,
          voice: final.result?.voice ?? null,
          elapsed_s: Math.round((Date.now() - started) / 1000),
          stages: stages.map((s) => s.key),
        }),
      });

      /* ── 6. keep the artefact only when asked ────────────────────────── */
      if (KEEP || process.env.VIENEU_E2E_DOWNLOAD_DIR) {
        fs.mkdirSync(OUT, { recursive: true });
        const mp4 = path.join(OUT, `pipeline-${pid}.mp4`);
        fs.writeFileSync(mp4, await file.body());
        testInfo.annotations.push({ type: 'download', description: mp4 });
      }
      done = true;
    } finally {
      // Keep a failed project so its job log and partial transcript can be
      // inspected; delete only a completed run (unless KEEP was requested).
      if (pid && done && !KEEP) {
        await request.delete(`${BASE}/api/projects/${encodeURIComponent(pid)}`)
          .catch(() => {});
      } else if (pid) {
        testInfo.annotations.push({
          type: 'kept-project',
          description: `${BASE}/project/${pid}`,
        });
      }
    }
  });
});

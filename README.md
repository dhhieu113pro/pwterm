# playwright-automation

Playwright end-to-end tests running on **Termux (Android)** against a system-installed Chromium — no Playwright browser downloads, no root.

Fork of [Jobians/playwright-termux](https://github.com/Jobians/playwright-termux), extended into a working test project: `@playwright/test` runner, config, and real specs — a public login-exercise site plus a local app running on the phone.

## `pwterm` — the CLI

The repo also ships a CLI, so you can drive the browser from any directory instead of editing a spec.

```bash
cd playwright-automation
npm install -g .        # installs the `pwterm` command
# npm 11 may skip postinstall scripts. If `pwterm` reports a bad interpreter:
node "$(npm root -g)/pwterm/scripts/termux-shim.js"
pwterm doctor           # Chromium path, environment, and a real launch test
```

### Run a flow

```bash
pwterm run examples/login.yaml
pwterm run examples/login.yaml --headed --var username=student
pwterm run examples/login.yaml --quiet
```

Two ready-to-run starters: `examples/login.yaml` (login with assertions) and `examples/todomvc.yaml` (a minimal add-and-complete flow for a new site).

Flows are YAML (or JSON) with a `baseUrl`, optional vars, and a list of single-action steps:

```yaml
baseUrl: https://practicetestautomation.com
vars:
  user: student
steps:
  - goto: /practice-test-login/
  - fill: { selector: '#username', value: '{{user}}' }
  - click: '#submit'
  - expectUrl: /logged-in-successfully/
  - screenshot: artifacts/after-login.png
```

Templates support `{{name}}`, `{{env.HOME}}` and `--var key=value`. A failing step saves a full-page screenshot to `pwterm-failures/` and exits non-zero.

| Action | Value |
|--------|-------|
| `goto` | url, or `{ url, waitUntil }` |
| `click` | selector |
| `fill`, `type` | `{ selector, value }` (`type` presses key by key) |
| `press` | key, or `{ key, selector }` |
| `wait` | milliseconds |
| `waitFor` | selector, or `{ selector, state }` |
| `waitForUrl` | url, or `/regex/` |
| `expectText` | `{ selector, equals / contains / regex }` |
| `expectTitle` | string, `/regex/`, or `{ equals }` |
| `expectUrl` | string (substring), or `/regex/` |
| `expectVisible`, `expectHidden` | selector |
| `screenshot` | path, or `{ path, fullPage, selector }` |
| `pdf` | path (headless only) |
| `upload` | `{ selector, files }` |
| `select`, `check`, `uncheck`, `scroll`, `setViewport`, `reload`, `goBack`, `eval`, `log` | see `pwterm help` |

Flow-level options: `baseUrl`, `vars`, `timeout`, `headless`, `viewport`, `waitUntil`, `storageState` (load cookies), `saveState` (write them after a successful run).

Note on `baseUrl`: URLs resolve like a browser link, so a leading `/` is the domain root even when `baseUrl` has a path. Keep `baseUrl` to the origin (`https://example.com`) and put the path in `goto`.

### Interactive shell

```bash
pwterm open
pw> goto https://practicetestautomation.com/practice-test-login/
pw> fill #username student
pw> fill #password Password123
pw> click #submit
pw> save login.yaml
```

The browser stays warm between commands. Every action is recorded, so `save` turns manual poking into a reusable flow. `title`, `url`, `text [selector]` and `eval <js>` inspect the page without recording.

### Other commands

```bash
pwterm shot https://example.com shot.png --full-page
pwterm shot https://example.com page.pdf
pwterm test                  # pass through to @playwright/test
pwterm test -g "TC2"
pwterm report
pwterm doctor
```

### Why `npm install -g .` works on Termux

An npm `bin` symlink starts with `#!/usr/bin/env node`, and Termux has no `/usr/bin/env` — that is the `bad interpreter` error. The package's `postinstall` detects Termux and replaces the symlink with a small `sh` wrapper in `$PREFIX/bin` that hardcodes the absolute `node` path (see `scripts/termux-shim.js`).

Newer npm versions gate install scripts behind `allowScripts`. If the postinstall did not run, install the wrapper once by hand:

```bash
node "$(npm root -g)/pwterm/scripts/termux-shim.js"
```

To fix npm bins globally instead, load termux-exec in the **parent shell** before spawning anything:

```bash
echo 'export LD_PRELOAD="$PREFIX/lib/libtermux-exec.so"' >> ~/.bashrc
exec bash
```

Exporting it only for the child process does not work — the shell doing the `execve` must itself run with the preload.

## Why this needs special handling

`playwright` bundles browser binaries, and on Android its browser-path logic throws `Error: Unsupported platform: android`. This setup avoids all of it:

- `playwright-core` — no browser downloads at all.
- `PLAYWRIGHT_BROWSERS_PATH=0` — disables Playwright's default cache/platform logic.
- System Chromium from the Termux X11 repo, passed via `executablePath`.

## Requirements

- Termux with the X11 repository enabled
- Chromium from that repo (not the Play Store/Android Chrome)
- Node.js (tested on Node 26, npm 11)

## Setup

```bash
# 1. Chromium (also enables x11-repo)
pkg install x11-repo
pkg update
pkg install chromium

# 2. Confirm the binary path — package names/paths differ across Termux versions
which chromium-browser 2>/dev/null || which chromium

# 3. Dependencies
cd playwright-automation
npm install
```

Then set `.env`:

```
PLAYWRIGHT_BROWSERS_PATH=0
CHROMIUM_PATH=/data/data/com.termux/files/usr/bin/chromium-browser
```

`.env` holds no secrets — only the path to your Chromium build.

## Running tests

```bash
npm test                     # all specs
npm test -- tests/login.spec.js
npm test -- -g "TC2"         # filter by test name
npm test -- --headed         # needs Termux X11 + DISPLAY
npm run report               # open the last HTML report
```

`pwterm test` runs the same runner from anywhere inside the project.

Current suite:

| Spec | Covers |
|------|--------|
| `tests/example.spec.js` | network + offline DOM/form sanity checks |
| `tests/login.spec.js` | positive login, invalid username, invalid password |
| `tests/vieneu-studio.spec.js` | a local app: gallery, routing, video decode/seek, provider key masking |
| `tests/vieneu-pipeline.spec.js` | local app, full flow: link → transcript → translate → dub (opt-in, slow) |

### Testing a local app: VieNeu Studio

`tests/vieneu-studio.spec.js` points at a dubbing studio running on the same
phone. It is the reference for testing something *local* instead of a public
site:

```bash
vieneu-studio start                                   # in another shell
VIENEU_STUDIO_URL=http://127.0.0.1:7861 npm test -- tests/vieneu-studio.spec.js
pwterm run examples/vieneu-studio.yaml                # manual smoke, with screenshots
```

The spec deliberately asserts the things that break silently in a browser:
a direct `/project/{id}` link and a reload both come up populated, the page
boots with **no uncaught errors**, the `<video>` reaches `readyState >= 2`
with a non-zero `videoWidth` (a codec the device cannot decode looks fine in
the DOM otherwise), byte ranges work so seeking does, the remembered
Source/Dubbed view survives a reopen, and API keys never reach the page. It discovers projects through
`/api/projects` instead of hard-coding ids, and cleans up the throwaway
project it creates.

`examples/vieneu-studio.yaml` is the CLI counterpart: gallery → open the
first card → wait for decode → Translate tab → back to the gallery, printing
`readyState`/`videoWidth` and writing screenshots to `artifacts/`.

#### The full pipeline (slow, opt-in)

`tests/vieneu-pipeline.spec.js` covers the whole product: paste a link into
the Auto dialog, then download → transcript → Vietnamese translation → dub,
and finally play the delivered file. It is skipped unless you hand it a link:

```bash
VIENEU_E2E_PIPELINE_URL='https://youtu.be/…' \
VIENEU_STUDIO_URL=http://127.0.0.1:7861 \
  npm test -- tests/vieneu-pipeline.spec.js
```

| Env | Meaning |
|-----|---------|
| `VIENEU_E2E_PIPELINE_URL` | the link to run (required, otherwise skipped) |
| `VIENEU_E2E_BACKEND=local` | force the offline translator instead of a saved provider |
| `VIENEU_E2E_PROVIDER=OpenRouter` | pick a provider by label in the dialog |
| `VIENEU_E2E_KEEP=1` | keep the project and save the mp4 for review |
| `VIENEU_E2E_DOWNLOAD_DIR` | write the dubbed mp4 there (the project itself is still cleaned up) |
| `VIENEU_E2E_TIMEOUT_MS` | overall budget, default 60 min |

It asserts all four stages reach `done`, the transcript is Vietnamese (diacritic
ratio, length sanity), the SRT is served, the result is an MP4 that reports
`206` for a byte range, has a real audio track (via `ffprobe`, when installed),
and decodes and plays in Chromium with the API's duration. A failed run keeps
its project so the job log and partial transcript can be inspected; a passing
run deletes it. `examples/vieneu-pipeline.yaml` is the manual version for
`pwterm`.

`npm start` still runs `index.js`, the original scrape demo that prints a page title.

## Writing a test

`playwright.config.js` already injects the system Chromium, so tests need no browser boilerplate:

```js
const { test, expect } = require('@playwright/test');

test('page loads', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example Domain/);
});
```

For scripts outside the runner (plain Node, no `@playwright/test`), keep the launch shape:

```js
require('dotenv/config');
const { chromium } = require('playwright-core');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH, // system Chromium
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
```

## Termux gotchas (learned the hard way)

1. **`npx playwright` / `node_modules/.bin/*` don't work.** Termux has no `/usr/bin/env`, so every npm bin shebang fails with `bad interpreter`. The `test` script calls the CLI directly instead: `node ./node_modules/@playwright/test/cli.js test`. termux-exec *can* fix it, but `LD_PRELOAD` must be set in the parent shell (via `~/.bashrc` and a new session) — setting it only for the child does nothing. `pwterm` itself sidesteps the issue with a shim (`scripts/termux-shim.js`).
2. **`PLAYWRIGHT_BROWSERS_PATH=0` must be in the shell env, not only `.env`.** The runner's registry resolves its cache dir at import time — before `playwright.config.js` (and its `dotenv`) loads. Hence it's exported in the npm scripts. In standalone scripts, `require('dotenv/config')` on line 1 is early enough.
3. **No `/tmp`.** Write scratch files to the project dir or `$PREFIX/tmp`.
4. **Headless needs no display.** X11 is only for `--headed` / `--ui`.
5. **Android Chrome is not usable** — it lacks the CDP surface Playwright needs. Use Termux's Chromium.

## Project structure

```
.env                  # Termux paths (no secrets)
playwright.config.js  # testDir, list reporter, system-Chromium launchOptions
index.js              # standalone scrape demo (npm start)
tests/                # specs
bin/pwterm.js         # CLI entry point
src/                  # cli, flow runner, interactive shell, doctor
scripts/              # Termux postinstall shim
examples/login.yaml   # sample flow
```

## Credit

Built on [Jobians/playwright-termux](https://github.com/Jobians/playwright-termux) (MIT) — the original Chromium + `playwright-core` workaround. This repo adds the `@playwright/test` runner, config, tests, and the Termux notes above.

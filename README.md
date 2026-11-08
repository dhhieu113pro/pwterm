# pwterm

Playwright end-to-end tests and a browser-automation CLI, running on **Termux (Android)** against the system-installed Chromium — no Playwright browser downloads, no root.

Fork of [Jobians/playwright-termux](https://github.com/Jobians/playwright-termux), extended into a working test project: an `@playwright/test` suite, a YAML flow runner, and an interactive browser shell.

## Install (one script)

On a fresh Termux:

```bash
curl -fsSL https://raw.githubusercontent.com/dhhieu113pro/pwterm/main/install.sh | bash
```

Already cloned the repo? From its directory:

```bash
bash install.sh
```

The script does everything:

1. Installs `nodejs` and `chromium` (enabling the x11-repo) if missing.
2. Runs `npm install` in the repo.
3. `npm install -g .` to put the `pwterm` command on your PATH.
4. Applies the Termux bin shim (see below), generates `.env` with your detected Chromium path.
5. Runs `pwterm doctor` to confirm Chromium actually launches.

Options: `--dir PATH` (clone location), `--repo URL`, `--no-global` (skip the global CLI). After it finishes:

```bash
pwterm open                       # interactive browser shell
pwterm run examples/login.yaml    # run a YAML flow
npm test                          # run the Playwright test suite
```

<details>
<summary>Manual setup (or if the script fails)</summary>

```bash
# 1. Chromium (also enables x11-repo)
pkg install x11-repo
pkg update
pkg install chromium

# 2. Confirm the binary path — package names/paths differ across Termux versions
which chromium-browser 2>/dev/null || which chromium

# 3. Dependencies + CLI
cd pwterm
npm install
npm install -g .

# 4. npm 11 may skip postinstall scripts. If `pwterm` reports a bad interpreter:
node "$(npm root -g)/pwterm/scripts/termux-shim.js"

# 5. Then set .env:
#    PLAYWRIGHT_BROWSERS_PATH=0
#    CHROMIUM_PATH=/data/data/com.termux/files/usr/bin/chromium-browser
# (no secrets — just the path to your Chromium build)
```

</details>

## The `pwterm` CLI

Drive the browser from any directory instead of editing a spec.

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

Flow-level options: `baseUrl`, `vars`, `timeout`, `headless`, `viewport`, `waitUntil`, `stealth` (disable the stealth layer with `stealth: false`), `storageState` (load cookies), `saveState` (write them after a successful run).

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

### Stealth browser

`pwterm` launches Chromium with a stealth layer on by default, so automation tells that anti-bot pages check first are already handled:

| Leak in stock Playwright | What pwterm does |
|---|---|
| `navigator.webdriver === true` | Patched on the prototype (own-property fakes are caught by `_.has`-style checks) → reads `false` |
| `--enable-automation`-style flags | Withheld via `ignoreDefaultArgs`, plus `--disable-blink-features=AutomationControlled` |
| UA contains `HeadlessChrome` | Real version read from the binary, UA reads `Chrome/<ver>` |
| Headless WebGL reports SwiftShader | Masked only when it actually leaks; real GPUs pass through untouched |
| `permissions.query` mismatch on notifications | Resolves with the real state |
| plugins / `window.chrome` / languages | Nothing to fix — modern headless Chromium already reports these correctly |

Opt out per command, per flow, or globally:

```bash
pwterm run flow.yaml --no-stealth          # stock Chromium
PWTERM_NO_STEALTH=1 npm test               # stealth off for a session
```

```yaml
# flow-level opt-out
baseUrl: https://example.com
stealth: false
steps: [...]
```

It applies to the `@playwright/test` runner as well: `playwright.config.js` injects the stealth flags and UA, and `tests/fixtures.js` adds the init script — specs import `{ test, expect }` from `./fixtures` (so they get it automatically). `PWTERM_NO_STEALTH=1` disables it everywhere.

`pwterm doctor` reports whether stealth is active (`stealth   on — automation tells patched`). `tests/stealth.spec.js` verifies all of the above against the real browser.

**Limits, honestly:** this is a flag + runtime-patch layer, not a recompiled browser. Source-level projects (e.g. [CloakBrowser](https://github.com/CloakHQ/CloakBrowser)) patch canvas/WebGL/audio/TLS inside Chromium's C++ and pass the hardest suites (Cloudflare Turnstile, reCAPTCHA). pwterm's stealth clears the common client-side tells — verified green end-to-end on bot.sannysoft.com (UA, WebDriver+advanced document probes, Chrome, permissions, plugins, languages, WebGL vendor/renderer) — but not server-side TLS match or CDP-level detection. GPU, screen, and platform stay the real values on purpose — a coherent Termux/ARM identity beats a lopsided fake Windows one.

## The test suite

```bash
npm test                     # all specs
npm test -- tests/login.spec.js
npm test -- -g "TC2"         # filter by test name
npm test -- --headed         # needs Termux X11 + DISPLAY
npm run report               # open the last HTML report
```

`pwterm test` runs the same runner from anywhere inside the project.

| Spec | Covers |
|------|--------|
| `tests/example.spec.js` | network + offline DOM/form sanity checks |
| `tests/login.spec.js` | positive login, invalid username, invalid password |
| `tests/stealth.spec.js` | stealth layer: no automation tells, opt-out restores stock |
| `tests/vieneu-pipeline.spec.js` | local app, full flow: link → transcript → translate → dub (opt-in, slow) |

### The full pipeline (slow, opt-in)

`tests/vieneu-pipeline.spec.js` covers the whole product: paste a link into the Auto dialog, then download → transcript → Vietnamese translation → dub, and finally play the delivered file. It is skipped unless you hand it a link:

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

It asserts all four stages reach `done`, the transcript is Vietnamese (diacritic ratio, length sanity), the SRT is served, the result is an MP4 that reports `206` for a byte range, has a real audio track (via `ffprobe`, when installed), and decodes and plays in Chromium with the API's duration. A failed run keeps its project so the job log and partial transcript can be inspected; a passing run deletes it. `examples/vieneu-pipeline.yaml` is the manual version for `pwterm`.

This is a phone: take a wake-lock first (`termux-wake-lock`) or Android may kill the Studio during the dub. The test retries briefly, then fails with an explicit "the Studio stopped answering" message; after a restart the queue marks the job `interrupted` — that is the OS, not a translation bug.

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

## Why this needs special handling

`playwright` bundles browser binaries, and on Android its browser-path logic throws `Error: Unsupported platform: android`. This setup avoids all of it:

- `playwright-core` — no browser downloads at all.
- `PLAYWRIGHT_BROWSERS_PATH=0` — disables Playwright's default cache/platform logic.
- System Chromium from the Termux X11 repo, passed via `executablePath`.

`install.sh` automates every part of this, including the bin shim below.

### Why `npm install -g .` needs a shim on Termux

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

## Termux gotchas (learned the hard way)

1. **`npx playwright` / `node_modules/.bin/*` don't work.** Termux has no `/usr/bin/env`, so every npm bin shebang fails with `bad interpreter`. The `test` script calls the CLI directly instead: `node ./node_modules/@playwright/test/cli.js test`. termux-exec *can* fix it, but `LD_PRELOAD` must be set in the parent shell (via `~/.bashrc` and a new session) — setting it only for the child does nothing. `pwterm` itself sidesteps the issue with a shim (`scripts/termux-shim.js`).
2. **`PLAYWRIGHT_BROWSERS_PATH=0` must be in the shell env, not only `.env`.** The runner's registry resolves its cache dir at import time — before `playwright.config.js` (and its `dotenv`) loads. Hence it's exported in the npm scripts. In standalone scripts, `require('dotenv/config')` on line 1 is early enough.
3. **No `/tmp`.** Write scratch files to the project dir or `$PREFIX/tmp`.
4. **Headless needs no display.** X11 is only for `--headed` / `--ui`.
5. **Android Chrome is not usable** — it lacks the CDP surface Playwright needs. Use Termux's Chromium.

## Project structure

```
install.sh             # one-shot installer (Chromium, node, CLI, shim, .env, doctor)
.env                   # Termux paths (no secrets)
playwright.config.js   # testDir, list reporter, system-Chromium launchOptions + stealth flags
index.js               # standalone scrape demo (npm start)
tests/                 # specs (+ fixtures.js: stealth context for the runner)
bin/pwterm.js          # CLI entry point
src/                   # cli, flow runner, interactive shell, doctor, stealth
scripts/               # Termux postinstall shim
examples/login.yaml    # sample flow
```

## License

MIT — see [LICENSE](LICENSE). Built on [Jobians/playwright-termux](https://github.com/Jobians/playwright-termux) — the original Chromium + `playwright-core` workaround. This repo adds the `@playwright/test` runner, config, tests, the `pwterm` CLI, and the Termux notes above.

# playwright-automation

Playwright end-to-end tests running on **Termux (Android)** against a system-installed Chromium — no Playwright browser downloads, no root.

Fork of [Jobians/playwright-termux](https://github.com/Jobians/playwright-termux), extended into a working test project: `@playwright/test` runner, config, and real specs (a public login-exercise site).

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

Current suite:

| Spec | Covers |
|------|--------|
| `tests/example.spec.js` | network + offline DOM/form sanity checks |
| `tests/login.spec.js` | positive login, invalid username, invalid password |

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

1. **`npx playwright` / `node_modules/.bin/*` don't work.** Termux has no `/usr/bin/env`, so every npm bin shebang fails with `bad interpreter`. The `test` script calls the CLI directly instead: `node ./node_modules/@playwright/test/cli.js test`. Adding termux-exec's `LD_PRELOAD` did **not** fix this.
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
```

## Credit

Built on [Jobians/playwright-termux](https://github.com/Jobians/playwright-termux) (MIT) — the original Chromium + `playwright-core` workaround. This repo adds the `@playwright/test` runner, config, tests, and the Termux notes above.

# pwterm (repo: dhhieu113pro/pwterm)

## Tests are Playwright — always

- Full suite: `npm test` (the script sets `PLAYWRIGHT_BROWSERS_PATH=0` and uses system Chromium).
- One file: `npm test -- tests/foo.spec.js`. Headed: `npm run test:headed`.
- Never add jest/vitest or a second runner to this repo.
- Termux has no `/usr/bin/env`, so invoke Node directly when a shebang fails:
  `node ./node_modules/@playwright/test/cli.js test` (the npm scripts already do).
- Artifacts and reports: `artifacts/`, `npm run report`.

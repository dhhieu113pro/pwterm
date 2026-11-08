# pwterm (repo: dhhieu113pro/pwterm)

## Tests are Playwright — always

- Full suite: `npm test` (the script sets `PLAYWRIGHT_BROWSERS_PATH=0` and uses system Chromium).
- One file: `npm test -- tests/foo.spec.js`. Headed: `npm run test:headed`.
- Never add jest/vitest or a second runner to this repo.
- Specs needing the local Studio: start it (`vieneu-studio start`) then
  `VIENEU_STUDIO_URL=http://127.0.0.1:7861 npm test -- tests/vieneu-studio.spec.js`.
  The full pipeline spec is opt-in via `VIENEU_E2E_PIPELINE_URL`.
- Termux has no `/usr/bin/env`, so invoke Node directly when a shebang fails:
  `node ./node_modules/@playwright/test/cli.js test` (the npm scripts already do).
- Artifacts and reports: `artifacts/`, `npm run report`.

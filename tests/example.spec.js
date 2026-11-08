const { test, expect } = require('./fixtures');

test('loads a page and reads its title', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example Domain/);
});

test('renders DOM and can type into a form', async ({ page }) => {
  await page.setContent(`
    <form>
      <input id="q" />
      <button type="button" onclick="document.title = document.getElementById('q').value">Go</button>
    </form>
  `);
  await page.fill('#q', 'playwright-termux');
  await page.click('button');
  await expect(page).toHaveTitle('playwright-termux');
});

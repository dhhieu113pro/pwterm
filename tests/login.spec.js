const { test, expect } = require('@playwright/test');

const URL = 'https://practicetestautomation.com/practice-test-login/';
const VALID = { username: 'student', password: 'Password123' };

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
  });

  // TC1 - positive: valid credentials log the user in
  test('TC1: valid credentials log in successfully', async ({ page }) => {
    await page.fill('#username', VALID.username);
    await page.fill('#password', VALID.password);
    await page.click('#submit');

    await expect(page).toHaveURL(/logged-in-successfully/);
    await expect(page.locator('h1')).toHaveText('Logged In Successfully');
    await expect(page.getByRole('link', { name: /log out/i })).toBeVisible();
    await expect(page.locator('#error')).toHaveCount(0);
  });

  // TC2 - negative username: error shown, no session created
  test('TC2: invalid username shows username error', async ({ page }) => {
    await page.fill('#username', 'incorrectUser');
    await page.fill('#password', VALID.password);
    await page.click('#submit');

    await expect(page.locator('#error')).toHaveText('Your username is invalid!');
    await expect(page).toHaveURL(URL);
    await expect(page.getByRole('link', { name: /log out/i })).toHaveCount(0);
  });

  // TC3 - negative password: error shown, no session created
  test('TC3: invalid password shows password error', async ({ page }) => {
    await page.fill('#username', VALID.username);
    await page.fill('#password', 'incorrectPassword');
    await page.click('#submit');

    await expect(page.locator('#error')).toHaveText('Your password is invalid!');
    await expect(page).toHaveURL(URL);
    await expect(page.getByRole('link', { name: /log out/i })).toHaveCount(0);
  });
});

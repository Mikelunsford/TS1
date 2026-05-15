import { test, expect } from '@playwright/test';

test('login page loads at 200 with the brand', async ({ page }) => {
  const response = await page.goto('/login');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Team1' })).toBeVisible();
});

test('unauthenticated visitor is redirected to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

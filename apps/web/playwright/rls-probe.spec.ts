import { test, expect } from '@playwright/test';

/**
 * Cross-tenant RLS probe — release-blocker.
 *
 * Wave 0 stub: this spec exists so `pnpm test:rls` is wired into CI from
 * day zero. The full test sees an Org A user attempt to read Org B data
 * and asserts the API returns NOT FOUND (404), never FORBIDDEN (403),
 * never leaks any data. That implementation lands in Wave 1 when org
 * fixtures exist.
 *
 * See TS1/05-suggestions/02-SECURITY-HARDENING.md §cross-tenant probe
 *     TS1/03-workspace/00-SHARED-CONTEXT.md (RLS-from-day-zero).
 */

test.skip('cross-tenant probe returns NOT FOUND (Wave 1+)', async ({ page }) => {
  await page.goto('/');
  expect(page.url()).toContain('/login');
});

test('Wave 0 placeholder shell renders', async ({ page }) => {
  await page.goto('/');
  // The unauthenticated guard should bounce us to /login.
  await expect(page).toHaveURL(/\/login$/);
});

import { test, expect } from '@playwright/test';

test('renders the main page header', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Archive.org Batch Editor' })).toBeVisible();
});

test('shows search and user items buttons', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /My items/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Search/i })).toBeVisible();
});

test('activity log section renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Activity Log')).toBeVisible();
});

test('Cmd+A does not fire on an empty item list', async ({ page }) => {
  await page.goto('/');
  // Press Cmd+A with no items loaded — should not throw
  await page.keyboard.press('Meta+a');
  // Page should still be functional
  await expect(page.getByRole('heading', { name: 'Archive.org Batch Editor' })).toBeVisible();
});

test('Escape key does not throw on an empty selection', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Archive.org Batch Editor' })).toBeVisible();
});

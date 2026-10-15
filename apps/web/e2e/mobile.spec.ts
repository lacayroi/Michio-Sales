import { expect, test } from '@playwright/test';

test('mobile: menu opens as a drawer', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email hoặc số điện thoại').fill('sale2@michio.local');
  await page.getByLabel('Mật khẩu').fill('Michio@123');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByTestId('kpi').first()).toBeVisible();

  await page.getByRole('button', { name: 'Mở menu' }).click();
  const nav = page.getByRole('navigation', { name: 'Menu chính' });
  await nav.getByRole('link', { name: 'Lead' }).click();
  await expect(page).toHaveURL(/\/leads$/);
  await expect(page.getByRole('heading', { name: 'Lead' })).toBeVisible();
});

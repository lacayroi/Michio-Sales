// M5: chăm khách & báo cáo — dashboard S3, báo cáo S12 + Excel, chỉ tiêu, chuyển giao S14, audit S19,
// khách cần chăm S8, việc của tôi S11. Report numbers themselves are checked against a fixture in
// packages/core (care-reports.int.test.ts); here we check the screens work end to end on seed data.
import { expect, type Page, test } from '@playwright/test';
import { login, SALES } from './helpers';

const logout = (page: Page) => page.getByRole('button', { name: 'Đăng xuất' }).click();

test('owner: dashboard, reports with Excel export, monthly targets', async ({ page }) => {
  await login(page, 'owner@michio.local');
  await expect(page.getByTestId('revenue-chart')).toBeVisible();
  await expect(page.getByText('So sánh sales tháng này')).toBeVisible();

  await page.goto('/bao-cao');
  await expect(page.getByTestId('report-summary')).toContainText('Lead mới');
  const tabs = page.getByRole('navigation', { name: 'Loại báo cáo' });
  for (const tab of ['Phễu', 'So sánh sales', 'Doanh số', 'Khách hàng', 'Sản phẩm', 'Lý do thua', 'Tốc độ phản hồi']) {
    await tabs.getByRole('link', { name: tab, exact: true }).click();
    await expect(page.getByTestId('report-table')).toBeVisible();
  }
  // A wider period on the revenue report, then Excel.
  await tabs.getByRole('link', { name: 'Doanh số', exact: true }).click();
  const from = new Date(Date.now() - 180 * 86_400_000 + 7 * 3600_000).toISOString().slice(0, 10);
  await page.getByLabel('Từ').fill(from);
  await page.getByRole('button', { name: 'Xem' }).click();
  await expect(page.getByTestId('report-table').locator('tbody tr')).not.toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Xuất Excel' }).click();
  expect((await download).suggestedFilename()).toMatch(/^bao-cao-revenue-\d{4}-\d{2}-\d{2}\.xlsx$/);

  await tabs.getByRole('link', { name: 'Chỉ tiêu', exact: true }).click();
  const input = page.getByLabel('Chỉ tiêu Lê Thị Hạnh');
  await input.fill('180000000');
  await page.getByRole('button', { name: /Lưu chỉ tiêu tháng/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã lưu chỉ tiêu' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Chỉ tiêu Lê Thị Hạnh')).toHaveValue('180000000');
});

test('sales: customers needing care and own tasks', async ({ page }) => {
  await login(page, SALES['Lê Thị Hạnh']);
  await page.goto('/khach-can-cham');
  await expect(page.getByTestId('attention-list').locator('li').first()).toBeVisible();

  await page.goto('/viec-cua-toi?tab=today');
  await page.getByRole('button', { name: 'Thêm việc' }).click();
  const dialog = page.getByRole('dialog', { name: 'Thêm việc' });
  await dialog.getByLabel('Việc cần làm').fill('Gọi Shop E2E hỏi đơn tháng sau');
  await dialog.getByRole('button', { name: 'Tạo' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã tạo việc' })).toBeVisible();
  // Default due = now + 1 h: still today, unless the suite runs in the last hour before midnight (VN).
  const vnDay = (t: number) => new Date(t + 7 * 3600_000).toISOString().slice(0, 10);
  await page.goto(`/viec-cua-toi?tab=${vnDay(Date.now()) === vnDay(Date.now() + 3600_000) ? 'today' : 'upcoming'}`);
  const row = page.getByTestId('task-list').locator('li', { hasText: 'Gọi Shop E2E hỏi đơn tháng sau' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /^Xong việc/ }).click();
  await expect(page.getByRole('status').filter({ hasText: /Đã xong việc V\d+/ })).toBeVisible();
  await page.goto('/viec-cua-toi?tab=done');
  await expect(page.getByTestId('task-list')).toContainText('Gọi Shop E2E hỏi đơn tháng sau');

  // Reports for a salesperson: own numbers only, no Excel.
  await page.goto('/bao-cao');
  await expect(page.getByText('Số liệu của riêng bạn.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Xuất Excel' })).toHaveCount(0);
});

test('owner hands over a salesperson’s customers, and the audit log shows it', async ({ page }) => {
  await login(page, 'owner@michio.local');
  await page.goto('/chuyen-giao');
  await page.getByLabel('Nhân viên cần chuyển').selectOption({ label: 'Vũ Ngọc Ánh (Kinh doanh)' });
  await page.getByRole('button', { name: 'Tiếp' }).click();
  const preview = page.getByTestId('transfer-preview');
  await expect(preview).toContainText('Khách phụ trách');
  await page.getByRole('button', { name: 'Tiếp' }).click();
  await page.getByLabel('Người nhận').selectOption({ label: 'Phạm Quốc Huy' });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Xác nhận chuyển giao' }).click();
  await expect(page.getByTestId('transfer-result')).toContainText('Đã chuyển xong', { timeout: 30_000 });
  await expect(page.getByTestId('transfer-result')).toContainText('Phạm Quốc Huy');

  await page.goto('/audit-log?action=transfer.run');
  await expect(page.getByTestId('audit-table')).toContainText('transfer.run');
  await expect(page.getByTestId('audit-table')).toContainText('Nguyễn Minh Đức');
  await logout(page);

  // The receiver got the list (web bell; Zalo Bot delivery is covered by M2 tests).
  await login(page, SALES['Phạm Quốc Huy']);
  const bell = await page.request.get('/api/v1/notifications');
  expect(JSON.stringify(await bell.json())).toContain('từ Vũ Ngọc Ánh');
});

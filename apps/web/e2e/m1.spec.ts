// M1 Definition of Done: website form (mock) → lead assigned in < 10 s; AC 6.3 flows in the real UI.
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { login, postFormLead, SALES, uniquePhone } from './helpers';

test.describe('website form → lead', () => {
  test('form submission is assigned by round robin in < 10 s', async ({ request }) => {
    const phone = uniquePhone();
    const started = Date.now();
    const res = await postFormLead(request, { phone });
    const elapsed = Date.now() - started;
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ duplicate: false });
    expect(Object.keys(SALES)).toContain(body.assignedTo);
    expect(elapsed).toBeLessThan(10_000);

    // Same phone again, different format → no new lead.
    const again = await postFormLead(request, { phone: `+84 ${phone.slice(1)}` });
    expect(again.status()).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true, leadId: body.leadId });
  });

  test('rejects bad API keys; honeypot creates nothing', async ({ request }) => {
    const bad = await request.post('/api/v1/public/leads', { headers: { 'X-Api-Key': 'nope' }, data: { fullName: 'x', phone: '0912345678' } });
    expect(bad.status()).toBe(401);
    const bot = await postFormLead(request, { website: 'http://spam.example' });
    expect(bot.status()).toBe(202);
    expect(await bot.json()).toEqual({ ok: true });
    const invalid = await postFormLead(request, { phone: '123' });
    expect(invalid.status()).toBe(422);
  });
});

test('sales sees a new lead in real time and accepts it', async ({ page, request }) => {
  await login(page, SALES['Lê Thị Hạnh']);
  await expect(page.getByRole('heading', { name: 'Việc của bạn hôm nay' })).toBeVisible();

  // Rotation: post until one lands on Lê Thị Hạnh (at most 3 with 3 available sales).
  let code: number | null = null;
  for (let i = 0; i < 3 && code === null; i++) {
    const r = await (await postFormLead(request, { fullName: `Realtime ${i}` })).json();
    if (r.assignedTo === 'Lê Thị Hạnh') code = r.code;
  }
  expect(code).not.toBeNull();

  // No reload: SSE triggers a refresh of the server-rendered list.
  const card = page.getByTestId('pending-leads').locator('div', { hasText: `#${code} ·` }).first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('unread-count')).toBeVisible();

  await card.getByRole('button', { name: 'Nhận' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Đã nhận lead #${code}` })).toBeVisible();
  await expect(page.getByTestId('pending-leads').getByText(`#${code} ·`)).toHaveCount(0);
});

test('owner: quick lead, then transfer it to another sales', async ({ page }) => {
  await login(page, 'owner@michio.local');
  await page.getByTestId('quick-lead').click();
  const dialog = page.getByRole('dialog', { name: '+ Lead nhanh' });
  await dialog.getByLabel('Số điện thoại *').fill(uniquePhone());
  await dialog.getByLabel('Tên khách / shop *').fill('Chị Hoa - shop mẹ bé Hải Phòng');
  await dialog.getByLabel('Ghi chú').fill('quan tâm matcha, bánh kẹo');
  await dialog.getByRole('button', { name: 'Tạo lead' }).click();

  await expect(page).toHaveURL(/\/leads\/[a-z0-9]+$/);
  await expect(page.getByRole('heading', { name: /Lead #\d+ · Chị Hoa/ })).toBeVisible();
  await expect(page.getByText(/phụ trách: /)).toBeVisible();
  await expect(page.getByTestId('assignment-history')).toContainText('Xoay vòng');

  await page.getByRole('button', { name: 'Chuyển cho…' }).click();
  const assign = page.getByRole('dialog', { name: 'Giao / chuyển lead' });
  await assign.getByLabel('Người nhận').selectOption({ index: 1 });
  await assign.getByRole('button', { name: 'Giao' }).click();
  await expect(page.getByTestId('assignment-history')).toContainText('Chuyển giao');
});

test('assignment rules: "Thử luật" shows who would receive a lead', async ({ page }) => {
  await login(page, 'owner@michio.local');
  await page.goto('/chia-lead');
  await expect(page.getByTestId('rule-card')).toHaveCount(1);
  const sim = page.getByTestId('simulator');
  await sim.getByLabel('Mức nhập').selectOption('GT_50M');
  await sim.getByRole('button', { name: 'Thử' }).click();
  await expect(page.getByTestId('simulation-result')).toContainText(/giao cho .+ \(lead nóng\)/);
});

test('owner confirms the 2026 holiday list from the home reminder', async ({ page }) => {
  await login(page, 'owner@michio.local');
  await page.getByTestId('holiday-reminder').click();
  await expect(page.getByTestId('holidays')).toContainText('Ngày Văn hóa Việt Nam');
  await expect(page.getByTestId('holidays')).toContainText('24/11/2026');
  await page.getByRole('button', { name: /Xác nhận lịch nghỉ lễ/ }).click();
  await expect(page.getByText(/Đã xác nhận lịch nghỉ lễ/).first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByTestId('holiday-reminder')).toHaveCount(0);
});

test('import Excel: preview errors, then background import', async ({ page }) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Khach si');
  ws.addRow(['Tên người liên hệ*', 'Số điện thoại*', 'Tên shop/doanh nghiệp', 'Mô hình kinh doanh', 'Ngày đơn gần nhất (dd/mm/yyyy)', 'Số đơn đã mua']);
  ws.addRow(['Anh Tuấn', uniquePhone(), 'Minimart Tuấn', 'Minimart / siêu thị mini', '01/10/2026', 2]);
  ws.addRow(['Chị Mai', uniquePhone(), 'Cafe Mai', 'Quán cafe / đồ uống', '', '']);
  ws.addRow(['', 'abc', '', 'Bán xe', '', '']);
  const file = path.join(tmpdir(), `import-e2e-${Date.now()}.xlsx`);
  writeFileSync(file, Buffer.from(await wb.xlsx.writeBuffer()));

  await login(page, 'owner@michio.local');
  await page.goto('/khach-hang/import');
  await page.getByLabel('File Excel (.xlsx)').setInputFiles(file);
  await page.getByRole('button', { name: '1. Kiểm tra file' }).click();
  const preview = page.getByTestId('import-preview');
  await expect(preview).toContainText('2 hợp lệ');
  await expect(preview).toContainText('1 lỗi');
  await expect(preview).toContainText('Mô hình kinh doanh "Bán xe" không khớp');
  await page.getByRole('button', { name: '2. Nhập 2 khách' }).click();
  await expect(page.getByTestId('import-status')).toContainText('Hoàn tất: 2 khách mới', { timeout: 20_000 });

  await page.goto('/khach-hang?q=Minimart%20Tu%E1%BA%A5n');
  await expect(page.getByRole('link', { name: 'Minimart Tuấn' })).toBeVisible();
});

test('Đặt lại mật khẩu: owner resets, sales must change it at next login', async ({ page }) => {
  await login(page, 'owner@michio.local');
  await page.goto('/nguoi-dung');
  const row = page.getByTestId('user-row').filter({ hasText: 'Vũ Ngọc Ánh' });
  await row.getByRole('button', { name: 'Đặt lại mật khẩu' }).click();
  await page.getByRole('button', { name: 'Tạo mật khẩu tạm' }).click();
  const temp = (await page.getByTestId('temp-password').textContent())?.trim() ?? '';
  expect(temp).toMatch(/^[A-Za-z2-9]{10}$/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login/);

  // Old password no longer works.
  await page.getByLabel('Email hoặc số điện thoại').fill(SALES['Vũ Ngọc Ánh']);
  await page.getByLabel('Mật khẩu').fill('Michio@123');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.locator('form').getByRole('alert')).toBeVisible();

  await login(page, SALES['Vũ Ngọc Ánh'], temp);
  await expect(page).toHaveURL(/\/doi-mat-khau$/);
  // Every other page bounces back until the password is changed.
  await page.goto('/leads');
  await expect(page).toHaveURL(/\/doi-mat-khau$/);

  await page.getByLabel('Mật khẩu tạm').fill(temp);
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill('MatKhauMoi#2026');
  await page.getByLabel('Nhập lại mật khẩu mới').fill('MatKhauMoi#2026');
  await page.getByRole('button', { name: 'Đổi mật khẩu' }).click();
  await expect(page.getByRole('heading', { name: 'Việc của bạn hôm nay' })).toBeVisible();
});

test('manager can reset sales passwords but not the owner', async ({ page }) => {
  await login(page, 'manager@michio.local');
  await page.goto('/nguoi-dung');
  await expect(page.getByTestId('user-row').filter({ hasText: 'Lê Thị Hạnh' }).getByRole('button', { name: 'Đặt lại mật khẩu' })).toBeVisible();
  await expect(page.getByTestId('user-row').filter({ hasText: 'Nguyễn Minh Đức' }).getByRole('button', { name: 'Đặt lại mật khẩu' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Thêm người dùng' })).toHaveCount(0);
});

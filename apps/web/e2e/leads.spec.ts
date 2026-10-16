// M1 Definition of Done: form sỉ trên web → lead được chia < 10 giây; nhận / trả / giao; Lead nhanh; luật chia.
// Requires a seeded database, a running worker is optional.
import { expect, type Page, test } from '@playwright/test';

const PASSWORD = 'Michio@123';
const API_KEY = 'mk_test_michio_website_dev';
const SALES_EMAIL: Record<string, string> = {
  'Lê Thị Hạnh': 'sale1@michio.local',
  'Phạm Quốc Huy': 'sale2@michio.local',
  'Vũ Ngọc Ánh': 'sale3@michio.local',
};

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email hoặc số điện thoại').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByTestId('current-user')).toBeVisible();
}

const uniquePhone = () => `09${String(Date.now()).slice(-8)}`;

test('website form → lead assigned in < 10 s → sales accepts from the home screen', async ({ page, request }) => {
  const started = Date.now();
  const res = await request.post('/api/v1/public/leads', {
    headers: { 'X-Api-Key': API_KEY },
    data: {
      formType: 'WHOLESALE',
      fullName: 'Chị Hoa E2E',
      phone: uniquePhone(),
      shopName: 'Shop Mẹ & Bé Hoa',
      province: 'Hải Phòng',
      businessModel: 'Shop online',
      expectedOrderBand: '10–30 triệu',
      interestCategories: ['Matcha & Trà', 'Thực phẩm'],
      note: 'Muốn lấy matcha latte',
      website: '',
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(body.assignedTo).toBeTruthy();

  await login(page, SALES_EMAIL[body.assignedTo]!);
  const card = page.getByTestId('pending-leads').getByRole('listitem').filter({ hasText: `#${body.code}` });
  await expect(card).toContainText('Chị Hoa E2E');
  await card.getByRole('button', { name: 'Nhận lead' }).click();
  await expect(card).toHaveCount(0);

  await page.goto('/leads?tab=progress');
  await page.getByRole('link', { name: 'Chị Hoa E2E' }).first().click();
  await expect(page.getByRole('heading', { name: new RegExp(`Lead #${body.code}`) })).toBeVisible();
  await page.getByLabel('Nội dung').fill('Đã gọi tư vấn chính sách sỉ');
  await page.getByRole('button', { name: 'Lưu hoạt động' }).click();
  await expect(page.getByTestId('timeline')).toContainText('Đã gọi tư vấn chính sách sỉ');
});

test('sales returns a lead → it goes to another sales', async ({ page, request }) => {
  const res = await request.post('/api/v1/public/leads', { headers: { 'X-Api-Key': API_KEY }, data: { fullName: 'Anh Tùng E2E', phone: uniquePhone() } });
  const body = await res.json();
  await login(page, SALES_EMAIL[body.assignedTo]!);
  await page.goto(`/leads/${body.leadId}`);
  await page.getByRole('button', { name: 'Trả lại' }).click();
  await page.getByLabel('Lý do (không bắt buộc)').fill('Không đúng khu vực');
  await page.getByRole('dialog').getByRole('button', { name: 'Trả lại' }).click();
  await expect(page.getByRole('status')).toContainText('Đã trả lại lead →');
});

test('quick lead by a sales stays with them; owner reassigns it', async ({ page }) => {
  await login(page, 'sale2@michio.local');
  await page.getByRole('button', { name: 'Lead nhanh' }).first().click();
  const phone = uniquePhone();
  await page.getByLabel('Số điện thoại').fill(phone);
  await page.getByLabel('Tên khách').fill('Chị Mai Zalo E2E');
  await page.getByLabel('Ghi chú').fill('Quan tâm bánh kẹo');
  await page.getByRole('button', { name: 'Tạo lead' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Người phụ trách: Phạm Quốc Huy');

  // same phone again → duplicate, no new lead
  await page.getByRole('button', { name: 'Tạo lead khác' }).click();
  await page.getByLabel('Số điện thoại').fill(phone);
  await page.getByLabel('Tên khách').fill('Chị Mai');
  await page.getByRole('button', { name: 'Tạo lead' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Khách đã có lead đang mở');
  await page.getByRole('dialog').getByRole('link', { name: 'Mở lead' }).click();
  await expect(page.getByTestId('timeline')).toContainText('Liên hệ lại');
  const url = page.url();

  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await login(page, 'owner@michio.local');
  await page.goto(url);
  await page.getByRole('button', { name: 'Giao / chuyển' }).click();
  await page.getByLabel('Giao cho').selectOption({ label: 'Lê Thị Hạnh' });
  await page.getByRole('dialog').getByRole('button', { name: 'Giao' }).click();
  await expect(page.getByTestId('assignment-history')).toContainText('Lê Thị Hạnh');
});

test('owner: "Thử luật" shows who gets the next lead', async ({ page }) => {
  await login(page, 'owner@michio.local');
  await page.goto('/chia-lead');
  await expect(page.getByTestId('rules')).toContainText('Mặc định — xoay vòng');
  await page.getByLabel('Mức nhập').selectOption('GT_50M');
  await page.getByRole('button', { name: 'Thử', exact: true }).click();
  await expect(page.getByTestId('simulation')).toContainText('nhận lead');
});

test('manager resets a password → forced change at next login', async ({ page }) => {
  await login(page, 'manager@michio.local');
  await page.goto('/nguoi-dung');
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('user-row').filter({ hasText: 'viewer@michio.local' }).getByRole('button', { name: 'Đặt lại mật khẩu' }).click();
  const temp = (await page.getByTestId('temp-password').textContent())!.trim();
  expect(temp).toHaveLength(10);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Đăng xuất' }).click();

  await page.goto('/login');
  await page.getByLabel('Email hoặc số điện thoại').fill('viewer@michio.local');
  await page.getByLabel('Mật khẩu').fill(temp);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/doi-mat-khau$/);
  await page.getByLabel('Mật khẩu hiện tại (mật khẩu tạm)').fill(temp);
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Nhập lại mật khẩu mới').fill(PASSWORD);
  await page.getByRole('button', { name: 'Lưu mật khẩu mới' }).click();
  await expect(page.getByTestId('current-role')).toHaveText('Chỉ xem');
});

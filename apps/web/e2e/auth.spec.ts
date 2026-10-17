// M0 Definition of Done: đăng nhập theo 5 vai trò, menu đúng quyền.
// Requires a seeded database (pnpm db:seed) and a production build (pnpm build).
import { expect, type Page, test } from '@playwright/test';

const PASSWORD = 'Michio@123';

const ROLES = [
  {
    email: 'owner@michio.local',
    role: 'Chủ doanh nghiệp',
    menu: [
      'Trang chủ', 'Lead', 'Hộp thư', 'Pipeline', 'Khách hàng', 'Khách cần chăm', 'Báo giá', 'Đơn sỉ',
      'Việc của tôi', 'Báo cáo', 'Sản phẩm & bảng giá', 'Chia lead', 'Chuyển giao', 'Người dùng',
      'Cài đặt & Tích hợp', 'Audit log', 'Hồ sơ',
    ],
    forbidden: [],
  },
  {
    email: 'manager@michio.local',
    role: 'Quản lý',
    menu: [
      'Trang chủ', 'Lead', 'Hộp thư', 'Pipeline', 'Khách hàng', 'Khách cần chăm', 'Báo giá', 'Đơn sỉ',
      'Việc của tôi', 'Báo cáo', 'Sản phẩm & bảng giá', 'Chia lead', 'Chuyển giao', 'Người dùng',
      'Cài đặt & Tích hợp', 'Audit log', 'Hồ sơ',
    ],
    forbidden: ['/cai-dat/api-key'],
  },
  {
    email: 'sale1@michio.local',
    role: 'Kinh doanh',
    menu: ['Trang chủ', 'Lead', 'Hộp thư', 'Pipeline', 'Khách hàng', 'Khách cần chăm', 'Báo giá', 'Đơn sỉ', 'Việc của tôi', 'Báo cáo', 'Hồ sơ'],
    forbidden: ['/nguoi-dung', '/chia-lead', '/cai-dat', '/audit-log', '/san-pham'],
  },
  {
    email: 'ketoan@michio.local',
    role: 'Hỗ trợ',
    menu: ['Trang chủ', 'Lead', 'Pipeline', 'Khách hàng', 'Đơn sỉ', 'Việc của tôi', 'Báo cáo', 'Hồ sơ'],
    forbidden: ['/hop-thu', '/bao-gia', '/chia-lead'],
  },
  {
    email: 'viewer@michio.local',
    role: 'Chỉ xem',
    menu: ['Trang chủ', 'Lead', 'Pipeline', 'Khách hàng', 'Báo cáo', 'Hồ sơ'],
    forbidden: ['/don-hang', '/hop-thu', '/viec-cua-toi', '/cai-dat'],
  },
];

async function login(page: Page, identifier: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email hoặc số điện thoại').fill(identifier);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
}

test('unauthenticated users are redirected to login', async ({ page }) => {
  await page.goto('/leads');
  await expect(page).toHaveURL(/\/login\?next=%2Fleads/);
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
});

test('wrong password shows an error', async ({ page }) => {
  await login(page, 'viewer@michio.local', 'sai-mat-khau');
  await expect(page.locator('form').getByRole('alert')).toContainText('không đúng');
  await expect(page).toHaveURL(/\/login/);
});

for (const r of ROLES) {
  test(`${r.role}: đăng nhập, menu đúng quyền, chặn trang không được phép`, async ({ page }) => {
    await login(page, r.email);
    await expect(page.getByTestId('current-role')).toHaveText(r.role);

    const nav = page.getByRole('navigation', { name: 'Menu chính' });
    // Labels may carry an unread badge (e.g. "Hộp thư3").
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await expect(nav.getByRole('link')).toHaveText(r.menu.map((l) => new RegExp(`^${escape(l)}(\\d+|99\\+)?$`)));

    await expect(page.getByTestId('kpi').first()).toBeVisible();

    for (const path of r.forbidden) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/khong-co-quyen$/);
    }

    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
}

test('login by phone number', async ({ page }) => {
  await login(page, '0904 000 011');
  await expect(page.getByTestId('current-role')).toHaveText('Kinh doanh');
});

test('API rejects cross-origin mutations and unauthenticated calls', async ({ request }) => {
  const me = await request.get('/api/v1/me');
  expect(me.status()).toBe(401);
  const csrf = await request.patch('/api/v1/me/status', {
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    data: { status: 'BUSY' },
  });
  expect(csrf.status()).toBe(403);
});

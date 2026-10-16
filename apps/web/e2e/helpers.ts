import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PASSWORD = 'Michio@123';
export const API_KEY = 'mk_test_michio_website_dev'; // seeded (packages/db/prisma/seed.ts)

export const SALES = {
  'Lê Thị Hạnh': 'sale1@michio.local',
  'Phạm Quốc Huy': 'sale2@michio.local',
  'Vũ Ngọc Ánh': 'sale3@michio.local',
} as const;

export async function login(page: Page, identifier: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email hoặc số điện thoại').fill(identifier);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

let n = 0;
/** A fresh, valid, unique VN mobile number per call. */
export function uniquePhone() {
  n += 1;
  return `09${String((Date.now() % 10_000_000) * 10 + n).slice(-8).padStart(8, '0')}`;
}

export async function postFormLead(request: APIRequestContext, over: Record<string, unknown> = {}) {
  return request.post('/api/v1/public/leads', {
    headers: { 'X-Api-Key': API_KEY },
    data: {
      formType: 'WHOLESALE',
      fullName: 'Khách E2E',
      phone: uniquePhone(),
      shopName: 'Shop E2E',
      province: 'Hà Nội',
      businessModel: 'Shop online',
      expectedOrderBand: '10–30 triệu',
      interestCategories: ['Matcha & Trà'],
      note: 'Tạo bởi test e2e',
      website: '',
      ...over,
    },
  });
}

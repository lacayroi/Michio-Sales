// M3 Definition of Done (MOCK_INTEGRATIONS=true): tin nhắn Page → lead tự chia; sales trả lời từ web.
// The simulator posts a Meta-shaped webhook body through the real pipeline; replies go out through the
// worker's channel-outbound queue and the mock Graph client.
import { expect, type Page, test } from '@playwright/test';
import { login, SALES } from './helpers';

const logout = (page: Page) => page.getByRole('button', { name: 'Đăng xuất' }).click();

test('a Messenger message becomes an assigned lead; the sales replies from the inbox', async ({ page }) => {
  const psid = `e2e-${Date.now().toString(36)}`;
  const name = `Chị Thu E2E ${psid.slice(-4)}`;

  // Owner plays the customer (demo simulator → webhook pipeline).
  await login(page, 'owner@michio.local');
  await page.goto('/hop-thu');
  await page.getByRole('button', { name: 'Mô phỏng khách' }).click();
  const sim = page.getByTestId('fb-simulator');
  await sim.getByLabel('Mã khách (PSID)').fill(psid);
  await sim.getByLabel('Tên hiển thị').fill(name);
  await sim.getByLabel('Khách nhắn').fill('Shop ơi cho em xin bảng giá sỉ matcha');
  await sim.getByRole('button', { name: 'Gửi vào Page' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Khách đã nhắn vào Page' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The conversation shows up with a lead held by one of the 3 sales (round robin).
  const row = page.getByTestId('conversation-list').getByRole('link', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  const rowText = (await row.textContent()) ?? '';
  const assignee = Object.keys(SALES).find((n) => rowText.includes(n)) as keyof typeof SALES | undefined;
  expect(assignee, rowText).toBeTruthy();
  const code = rowText.match(/#(\d+)/)![1];
  await logout(page);

  // The assigned sales accepts and replies from the web.
  await login(page, SALES[assignee!]);
  await page.goto(`/leads?q=${code}`);
  await page.getByRole('link', { name: new RegExp(name) }).first().click();
  await page.getByRole('button', { name: 'Nhận' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: `Đã nhận lead #${code}` })).toBeVisible();

  await page.goto('/hop-thu');
  await expect(page.getByTestId('badge-hop-thu')).toBeVisible();
  await page.getByTestId('conversation-list').getByRole('link', { name: new RegExp(name) }).click();
  await expect(page.getByTestId('chat-title')).toHaveText(name);
  await expect(page.getByTestId('msg-in').last()).toContainText('bảng giá sỉ matcha');
  await expect(page.getByTestId('window-status')).toContainText('Nhắn được đến');

  // Quick reply with "/" → variables filled in.
  const box = page.getByLabel('Tin nhắn trả lời');
  await box.fill('/chao');
  await page.getByRole('option', { name: /\/chao/ }).click();
  await expect(box).toHaveValue(new RegExp(`xin chào ${name}.*Em là ${assignee}`));
  await page.getByRole('button', { name: 'Gửi', exact: true }).click();
  const out = page.getByTestId('msg-out').last();
  await expect(out).toContainText(`xin chào ${name}`);
  await expect(out).toContainText('Đã gửi', { timeout: 15_000 }); // worker → MessageGateway → mock Graph

  // Internal note is not sent to the customer.
  await page.getByRole('button', { name: 'Ghi chú nội bộ' }).click();
  await page.getByLabel('Ghi chú nội bộ').fill('Khách ở Hà Nội, hẹn gửi báo giá chiều nay');
  await page.getByRole('button', { name: 'Lưu ghi chú' }).click();
  await expect(page.getByTestId('note').last()).toContainText('hẹn gửi báo giá');

  // First outbound message counted as first contact: the lead no longer waits for contact.
  await page.goto(`/leads?q=${code}`);
  await page.getByRole('link', { name: new RegExp(name) }).first().click();
  await expect(page.getByText(/Khách nhắn Messenger/).first()).toBeVisible();
  await expect(page.getByText(/trả lời Messenger/).first()).toBeVisible();
});

test('owner sees the Facebook integration settings', async ({ page }) => {
  await login(page, 'owner@michio.local');
  await page.goto('/cai-dat/facebook');
  await expect(page.getByTestId('facebook-integration')).toContainText('Mô phỏng');
  await expect(page.getByTestId('facebook-page').first()).toContainText('Đang hoạt động');
  await expect(page.getByText('HUMAN_AGENT')).toBeVisible();
});

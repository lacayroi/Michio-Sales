// M2 Definition of Done (MOCK_INTEGRATIONS=true): người trực Zalo công ty tạo lead bằng `LEAD …`,
// sales nhận / hẹn / hoàn thành hoàn toàn qua Zalo. The simulator on /ho-so uses the real pipeline
// (WebhookEvent → command → reply through the mock Zalo client).
import { expect, type Page, test } from '@playwright/test';
import { login, SALES, uniquePhone } from './helpers';

async function linkBot(page: Page) {
  await page.goto('/ho-so');
  const status = page.getByTestId('zalo-bot-status');
  if ((await status.textContent())?.includes('Đã kết nối')) return;
  await page.getByRole('button', { name: 'Lấy mã kết nối' }).click();
  const code = (await page.getByTestId('link-code').textContent())!.trim();
  await say(page, code);
  await expect(page.getByTestId('zalo-bot-status')).toContainText('Đã kết nối');
}

async function say(page: Page, text: string) {
  const sim = page.getByTestId('bot-simulator');
  const before = await sim.locator('[data-from="bot"]').count();
  await sim.getByLabel('Tin nhắn gửi bot').fill(text);
  await sim.getByRole('button', { name: 'Gửi' }).click();
  await expect(sim.locator('[data-from="bot"]')).not.toHaveCount(before);
  // All bot messages since sending: unrelated notifications (e.g. the SLA sweeper on seeded leads) may
  // arrive in between, so the reply is not always the last bubble.
  const all = await sim.locator('[data-from="bot"]').allTextContents();
  return all.slice(before).join('\n');
}

const logout = (page: Page) => page.getByRole('button', { name: 'Đăng xuất' }).click();

test('Zalo duty person creates a lead with LEAD; the assigned sales accepts, schedules and completes via the bot', async ({ page }) => {
  await login(page, 'owner@michio.local');
  await linkBot(page);
  expect(await say(page, 'help')).toContain('LEAD <SĐT>');

  const created = await say(page, `LEAD ${uniquePhone()} Chị Mai E2E - shop mẹ bé Nam Định - quan tâm matcha`);
  const m = created.match(/Đã tạo lead #(\d+) · Chị Mai E2E → (.+?)(?: \(|\.)/);
  expect(m, created).not.toBeNull();
  const [, code, assignee] = m!;
  await logout(page);

  await login(page, SALES[assignee as keyof typeof SALES]);
  await linkBot(page);
  expect(await say(page, 'hôm nay')).toContain(`#${code} Chị Mai E2E`);
  expect(await say(page, `nhan ${code}`)).toContain(`Đã nhận lead #${code}`);
  expect(await say(page, `GOI ${code} đã gửi chính sách sỉ`)).toContain('Đã ghi nhận liên hệ');
  const hen = await say(page, `HEN ${code} mai 9h gọi lại chốt đơn`);
  expect(hen).toContain('📌 Đã hẹn');
  const taskCode = hen.match(/XONG (\d+)/)![1];
  expect(await say(page, `XONG ${taskCode}`)).toContain(`Đã xong việc V${taskCode}`);

  // The lead page reflects what was done on Zalo.
  await page.goto('/leads?q=Chị Mai E2E');
  await page.getByRole('link', { name: /Chị Mai E2E/ }).first().click();
  await expect(page.getByText('đã gửi chính sách sỉ').first()).toBeVisible();
});

test('sales returns a lead with TRA and pauses with NGHI', async ({ page }) => {
  await login(page, SALES['Phạm Quốc Huy']);
  await linkBot(page);
  expect(await say(page, 'NGHI')).toContain('tạm dừng');
  expect(await say(page, 'LAMVIEC')).toContain('Đã bật nhận lead');
  expect(await say(page, 'TRA 999999')).toContain('Không tìm thấy lead #999999');
  expect(await say(page, 'xin chào')).toContain('HELP');
});

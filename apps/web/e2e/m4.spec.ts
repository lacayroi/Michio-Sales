// M4 Definition of Done: tạo báo giá 20 dòng < 2 phút; PDF đúng thương hiệu; báo giá → đơn.
// PDFs are rendered by the worker's quote-pdf job (webServer starts the worker).
import { expect, type Page, test } from '@playwright/test';
import { login, SALES } from './helpers';

const logout = (page: Page) => page.getByRole('button', { name: 'Đăng xuất' }).click();

test('sales builds a 20-line quote in under 2 minutes, gets the branded PDF, and turns it into an order', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, SALES['Lê Thị Hạnh']);
  // A customer this salesperson owns (OWN scope).
  const customers = await (await page.request.get('/api/v1/customers?limit=1&lifecycle=REPEAT,NEW_CUSTOMER')).json();
  const customer = customers.items[0];
  expect(customer, 'seeded customer for sale1').toBeTruthy();

  const started = Date.now();
  await page.goto(`/bao-gia/moi?customerId=${customer.id}`);
  await expect(page.getByTestId('quote-customer')).toContainText(customer.shopName ?? customer.contactName);
  const search = page.getByLabel('Tìm sản phẩm để thêm');
  for (let n = 1; n <= 20; n++) {
    await search.fill(`-${String(n).padStart(3, '0')}`); // seeded SKUs MC-XXX-001 … are unique by number
    await expect(page.getByRole('listbox', { name: 'Kết quả tìm sản phẩm' })).toBeVisible();
    await search.press('Enter');
    await expect(page.getByTestId('quote-lines').locator('tbody tr')).toHaveCount(n);
  }
  await expect(page.getByTestId('quote-lines').getByText('₫').first()).toBeVisible(); // prices resolved
  await page.getByRole('button', { name: 'Lưu báo giá' }).click();
  await expect(page).toHaveURL(/\/bao-gia\/[a-z0-9]+$/);
  const elapsed = Date.now() - started;
  expect(elapsed, `20-line quote took ${Math.round(elapsed / 1000)} s`).toBeLessThan(120_000);
  const code = (await page.getByTestId('quote-code').textContent())!.trim();
  expect(code).toMatch(/^BG-\d{4}-\d{6}$/);

  // Branded PDF from the worker (logo + Be Vietnam Pro), downloadable for Zalo.
  const quoteUrl = page.url();
  const quoteId = quoteUrl.split('/').pop()!;
  const pdf = await page.request.get(`/api/v1/quotes/${quoteId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.toString('latin1')).toContain('BeVietnamPro');
  expect(bytes.toString('latin1')).toContain('/Subtype /Image'); // logo

  // Send (manual → downloads the PDF to forward on Zalo).
  await page.getByRole('button', { name: 'Gửi báo giá' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Đánh dấu đã gửi & tải PDF' }).click();
  expect((await download).suggestedFilename()).toBe(`${code}.pdf`);
  await page.goto(quoteUrl);
  await expect(page.getByText('Đã gửi', { exact: true })).toBeVisible();

  // Customer agrees → one click to an order.
  await page.getByRole('button', { name: 'Khách đồng ý' }).click();
  await expect(page.getByText('Khách đồng ý', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Chuyển thành đơn' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Tạo đơn' }).click();
  await expect(page).toHaveURL(/\/don-hang\/[a-z0-9]+$/);
  const orderCode = (await page.getByTestId('order-code').textContent())!.trim();
  expect(orderCode).toMatch(/^DH-\d{4}-\d{6}$/);
  await logout(page);

  // Accounting marks it paid and delivered.
  await login(page, 'ketoan@michio.local');
  await page.goto(`/don-hang?q=${orderCode}`);
  await page.getByRole('link', { name: orderCode }).click();
  const panel = page.getByTestId('fulfillment');
  await panel.getByLabel('Thanh toán').selectOption('PAID');
  await panel.getByRole('button', { name: 'Lưu thanh toán' }).click();
  await expect(page.getByText('Đã thanh toán').first()).toBeVisible();
  await panel.getByLabel('Giao hàng').selectOption('DELIVERED');
  await panel.getByLabel('Mã vận đơn').fill('GHN-E2E-1');
  await panel.getByRole('button', { name: 'Lưu giao hàng' }).click();
  await expect(page.getByText('Đã giao').first()).toBeVisible();
});

test('owner: pipeline board, products & price lists, settings', async ({ page }) => {
  await login(page, 'owner@michio.local');
  await page.goto('/pipeline');
  await expect(page.getByTestId('column-BAO_GIA')).toBeVisible();
  await expect(page.getByTestId('deal-card').first()).toBeVisible();

  await page.goto('/san-pham?tab=bang-gia');
  await page.getByTestId('price-list').first().click();
  await expect(page.getByTestId('price-items').locator('tbody tr').first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Xuất Excel' }).click();
  expect((await download).suggestedFilename()).toMatch(/^bang-gia-.+\.xlsx$/);

  await page.goto('/cai-dat/woocommerce');
  await page.getByRole('button', { name: 'Đồng bộ ngay' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã bắt đầu đồng bộ' })).toBeVisible();
  await expect.poll(async () => (await page.request.get('/api/v1/integrations/woocommerce').then((r) => r.json())).counts.products, { timeout: 20_000 }).toBeGreaterThan(0);

  await page.goto('/cai-dat/cong-ty');
  await expect(page.getByLabel('Tên công ty')).toHaveValue(/Michio/);
});

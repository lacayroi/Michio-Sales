// Runs the exact mu-plugin published in docs/wordpress-snippet.md inside PHP 8.3 with mocked
// WordPress / Contact Form 7 / WPForms, then feeds the captured requests into lead intake (SPEC 5.1).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { PublicLeadPayload, toLeadIntake } from '@michio/integrations';
import { describe, expect, it } from 'vitest';
import { createTestOrg, testDb } from '../test/fixtures';
import { intakeLead } from './leads';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const HARNESS = path.join(ROOT, 'packages/integrations/test/wordpress/harness.php');

interface Captured {
  url: string;
  args: { timeout: number; blocking: boolean; headers: Record<string, string>; body: string; data_format: string };
}

function extractPlugin(): string {
  const md = readFileSync(path.join(ROOT, 'docs/wordpress-snippet.md'), 'utf8');
  // Normalize CRLF (Windows checkouts) so the block regex matches everywhere.
  const blocks = [...md.replace(/\r\n/g, '\n').matchAll(/```php\n([\s\S]*?)```/g)].map((m) => m[1] as string);
  const plugin = blocks.find((b) => b.includes('Plugin Name: Michio Sales Hub'));
  if (!plugin) throw new Error('mu-plugin block not found in docs/wordpress-snippet.md');
  return plugin;
}

function runPhp(scenario: 'default' | 'whitelist'): { requests: Captured[]; failureBubbled: boolean } {
  // Files go in over stdin: no bind mount, so it works with Docker Desktop's file-sharing limits.
  const input = JSON.stringify({ plugin: extractPlugin(), harness: readFileSync(HARNESS, 'utf8'), scenario });
  const bootstrap =
    '$d=json_decode(stream_get_contents(STDIN),true);file_put_contents("/tmp/plugin.php",$d["plugin"]);' +
    'file_put_contents("/tmp/harness.php",$d["harness"]);$argv=["harness.php","/tmp/plugin.php",$d["scenario"]];require "/tmp/harness.php";';
  const env = { ...process.env };
  const desktopSock = path.join(homedir(), '.docker/desktop/docker.sock');
  if (!env.DOCKER_HOST && !existsSync('/var/run/docker.sock') && existsSync(desktopSock)) env.DOCKER_HOST = `unix://${desktopSock}`;
  const out = execFileSync(
    'docker',
    ['run', '--rm', '-i', '--network', 'none', 'php:8.3-cli', 'php', '-d', 'display_errors=stderr', '-r', bootstrap],
    { env, input, encoding: 'utf8', timeout: 120_000 },
  );
  return JSON.parse(out);
}

describe('WordPress mu-plugin (Contact Form 7 + WPForms)', () => {
  const result = runPhp('default');

  it('sends exactly the two wholesale/agent forms; skips unrelated forms and missing phones', () => {
    expect(result.requests).toHaveLength(2);
  });

  it('posts JSON with X-Api-Key, 5 s timeout and non-blocking', () => {
    for (const r of result.requests) {
      expect(r.url).toBe('https://hub.test/api/v1/public/leads');
      expect(r.args).toMatchObject({ timeout: 5, blocking: false, data_format: 'body' });
      expect(r.args.headers).toEqual({ 'Content-Type': 'application/json', 'X-Api-Key': 'mk_test_harness' });
    }
  });

  it('a network error never breaks the form submission', () => {
    expect(result.failureBubbled).toBe(false);
  });

  it('Contact Form 7 payload matches Phụ lục B', () => {
    const body = JSON.parse(result.requests[0]!.args.body);
    expect(body).toEqual({
      formType: 'WHOLESALE',
      pageUrl: 'https://michiovietnam.com/si-hang-nhat/?utm_source=facebook&utm_medium=cpc&utm_campaign=si-thang11',
      fullName: 'Nguyễn Thị Hoa',
      phone: '0912 345 678',
      shopName: 'Shop Mẹ & Bé Hoa',
      email: 'hoa@example.com',
      province: 'Hải Phòng',
      businessModel: 'Shop online',
      expectedOrderBand: '10–30 triệu',
      interestCategories: ['Matcha & Trà', 'Thực phẩm'],
      note: 'Muốn lấy matcha latte và bánh kẹo cho bé',
      website: '',
      utm: { source: 'facebook', medium: 'cpc', campaign: 'si-thang11' },
    });
  });

  it('WPForms payload is matched by Vietnamese labels and detected as an agent form', () => {
    const body = JSON.parse(result.requests[1]!.args.body);
    expect(body).toMatchObject({
      formType: 'AGENT',
      fullName: 'Trần Văn Bình',
      phone: '0983.111.222',
      shopName: 'Công ty TNHH Bình An',
      province: 'Đà Nẵng',
      businessModel: 'Doanh nghiệp / đối tác phân phối',
      expectedOrderBand: 'Trên 50 triệu',
      interestCategories: ['Đồ uống', 'Gia dụng'],
      note: 'Muốn làm đại lý miền Trung',
    });
  });

  it('MICHIO_HUB_FORMS whitelist overrides URL detection and filters other forms', () => {
    const wl = runPhp('whitelist');
    // Only CF7 #123 is listed (as AGENT): the WPForms form and the /lien-he/ form are skipped,
    // and the second CF7 #123 submission has no phone, so exactly one request goes out.
    expect(wl.requests.map((r) => JSON.parse(r.args.body))).toEqual([expect.objectContaining({ formType: 'AGENT', fullName: 'Nguyễn Thị Hoa' })]);
  });

  it('captured payloads become assigned leads in Sales Hub', async () => {
    const org = await createTestOrg();
    const ctx = org.ctx();
    for (const r of result.requests) {
      const payload = PublicLeadPayload.parse(JSON.parse(r.args.body));
      const out = await intakeLead(ctx, toLeadIntake(payload));
      expect(out.assignment).toMatchObject({ status: 'ASSIGNED' });
    }
    const leads = await testDb().lead.findMany({ where: { orgId: org.orgId }, include: { customer: true }, orderBy: { code: 'asc' } });
    expect(leads.map((l) => [l.source, l.priority, l.customer.businessModel, l.customer.expectedOrderBand, l.customer.phone])).toEqual([
      ['WEBSITE_WHOLESALE_FORM', 'WARM', 'ONLINE_SHOP', 'B10_30M', '+84912345678'],
      ['WEBSITE_AGENT_FORM', 'HOT', 'DISTRIBUTOR', 'GT_50M', '+84983111222'],
    ]);
    expect(leads[0]!.campaign).toBe('si-thang11');
    expect(leads[1]!.customer.interestCategories).toEqual(['DRINK', 'HOUSEHOLD']);
  });
});

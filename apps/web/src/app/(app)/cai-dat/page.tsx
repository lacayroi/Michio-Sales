import { can } from '@michio/auth';
import { getCompanyProfile, getWorkingCalendar, listApiKeys, listHolidays, loadSettings } from '@michio/core';
import { prisma } from '@michio/db';
import { Card, CardTitle } from '@/components/ui/card';
import { navItem } from '@/lib/nav';
import { requireUser } from '@/lib/session';
import { ApiKeys } from './api-keys';
import { CompanyForm } from './company-form';
import { Holidays } from './holidays';
import { WorkingHours } from './working-hours';

const HREF = '/cai-dat';
export const metadata = { title: navItem(HREF).label };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await requireUser('settings.manage', 'integration.manage');
  const actor = { orgId: user.orgId, user, via: 'WEB' as const };
  const thisYear = new Date().getFullYear();
  const year = Number((await searchParams).year) || thisYear;
  const canSettings = can(user.role, 'settings.manage');
  const canIntegrations = can(user.role, 'integration.manage');
  const [weekly, holidays, settings, company, keys] = await Promise.all([
    getWorkingCalendar(prisma, user.orgId),
    listHolidays(prisma, user.orgId, year),
    loadSettings(prisma, user.orgId),
    getCompanyProfile(prisma, user.orgId),
    canIntegrations ? listApiKeys(prisma, actor) : Promise.resolve([]),
  ]);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Cài đặt & Tích hợp</h1>
      {canSettings && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Giờ làm việc</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Dùng để tính thời hạn nhận / liên hệ lead (SLA). Ngày không có khung giờ là ngày nghỉ.</p>
            <WorkingHours initial={weekly} />
          </Card>
          <Card id="ngay-le">
            <CardTitle>Ngày lễ năm {year}</CardTitle>
            <Holidays
              year={year}
              thisYear={thisYear}
              confirmed={settings['calendar.holidaysConfirmedYears'].includes(year)}
              items={holidays.map((h) => ({ id: h.id, date: h.date.toISOString().slice(0, 10), name: h.name }))}
            />
          </Card>
          <Card className="lg:col-span-2">
            <CardTitle>Thông tin công ty (in trên báo giá PDF)</CardTitle>
            <CompanyForm initial={{ name: company.name, ...company.profile }} />
          </Card>
        </div>
      )}
      {canIntegrations && (
        <Card>
          <CardTitle>API key cho form website</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Website gửi lead về <code className="rounded bg-muted px-1">POST /api/v1/public/leads</code> kèm header <code className="rounded bg-muted px-1">X-Api-Key</code>. Đoạn code mẫu cho WordPress: xem
            tài liệu <code className="rounded bg-muted px-1">docs/wordpress-snippet.md</code>.
          </p>
          <ApiKeys
            items={keys.map((k) => ({ id: k.id, name: k.name, source: k.source, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null }))}
          />
        </Card>
      )}
      <p className="text-sm text-muted-foreground">Kết nối Facebook, Zalo Bot, Zalo công ty và WooCommerce sẽ có ở các giai đoạn M2–M4.</p>
    </section>
  );
}

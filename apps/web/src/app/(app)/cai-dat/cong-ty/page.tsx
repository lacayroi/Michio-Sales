import { getCompanyProfile } from '@michio/core';
import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { serviceContext } from '@/lib/services';
import { CompanyForm } from './form';

export const metadata = { title: 'Thông tin công ty' };

/** SPEC 6.12 — thông tin công ty in trên PDF báo giá. */
export default async function CompanyPage() {
  const user = await requireUser('settings.manage');
  const ctx = serviceContext(user);
  const p = await getCompanyProfile(ctx.db, ctx.orgId);
  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div>
        <Link href="/cai-dat" className="text-sm text-muted-foreground hover:underline">← Cài đặt</Link>
        <h1 className="mt-1 text-2xl font-semibold">Thông tin công ty</h1>
        <p className="text-sm text-muted-foreground">In trên đầu / chân trang PDF báo giá sỉ.</p>
      </div>
      <CompanyForm initial={{
        legalName: p.legalName, address: p.address, hotline: p.hotline, zaloPhone: p.zaloPhone ?? '', website: p.website ?? '', email: p.email ?? '',
        facebookPage: p.facebookPage ?? '', taxCode: p.taxCode ?? '', bankName: p.bankName ?? '', bankAccount: p.bankAccount ?? '', bankAccountName: p.bankAccountName ?? '', quoteTerms: p.quoteTerms ?? '',
      }} />
    </section>
  );
}

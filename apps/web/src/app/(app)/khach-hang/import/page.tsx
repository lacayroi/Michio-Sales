import { assignableUsers } from '@michio/core';
import { prisma } from '@michio/db';
import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { ImportWizard } from './import-wizard';

export const metadata = { title: 'Import khách sỉ' };

export default async function ImportPage() {
  const user = await requireUser('import.manage');
  const users = await assignableUsers(prisma, user.orgId);
  return (
    <section className="max-w-3xl">
      <Link href="/khach-hang" className="text-sm text-muted-foreground hover:underline">
        ← Khách hàng
      </Link>
      <h1 className="mt-1 mb-2 text-2xl font-semibold">Import khách sỉ từ Excel</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Dùng để nhập danh sách khách sỉ đang có. Khách đã mua (có “Số đơn đã mua”) được giữ lịch sử và lịch nhắc tái đặt; khách chưa mua được tạo lead nguồn “Import”. SĐT đã có trong hệ thống chỉ được bổ sung thông tin còn trống.
      </p>
      <ImportWizard users={users.filter((u) => u.role === 'SALES').map((u) => ({ id: u.id, fullName: u.fullName }))} />
    </section>
  );
}

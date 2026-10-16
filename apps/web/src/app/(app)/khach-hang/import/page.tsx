import { listUsers } from '@michio/core';
import Link from 'next/link';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { ImportWizard } from './import-wizard';

export const metadata = { title: 'Import khách sỉ' };

export default async function ImportPage() {
  const user = await requireUser('import.manage');
  const users = (await listUsers(serviceContext(user))).filter((u) => u.role === 'SALES' && u.status !== 'INACTIVE');
  return (
    <section className="max-w-4xl">
      <Link href="/khach-hang" className="text-sm text-muted-foreground hover:underline">← Khách hàng</Link>
      <h1 className="mb-1 mt-1 text-2xl font-semibold">Import danh sách khách sỉ</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Dùng{' '}
        <a href="/api/v1/imports/template" download className="font-medium text-primary hover:underline dark:text-brand-green">file mẫu</a> (Phụ lục A). Hệ thống kiểm tra từng dòng trước, chỉ nhập khi bạn xác nhận. Khách trùng SĐT sẽ được cập nhật thay vì tạo mới.
      </p>
      <ImportWizard users={users.map((u) => ({ id: u.id, fullName: u.fullName }))} />
    </section>
  );
}

import { listUsers } from '@michio/core';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { TransferWizard } from './wizard';

export const metadata = { title: 'Chuyển giao' };

/** S14 — chuyển khách, lead, báo giá, việc của một sales sang người khác (SPEC 6.10). */
export default async function TransferPage() {
  const user = await requireUser('transfer.manage');
  const users = await listUsers(serviceContext(user));
  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Chuyển giao khách</h1>
        <p className="text-sm text-muted-foreground">Khi nhân viên nghỉ hoặc đổi việc: chuyển toàn bộ khách đang phụ trách, lead đang xử lý, báo giá chưa chốt và việc còn mở. Mọi thay đổi ghi audit log.</p>
      </div>
      <TransferWizard users={users.filter((u) => u.role === 'SALES' || u.role === 'MANAGER' || u.role === 'OWNER').map((u) => ({ id: u.id, fullName: u.fullName, role: u.role, status: u.status }))} />
    </section>
  );
}

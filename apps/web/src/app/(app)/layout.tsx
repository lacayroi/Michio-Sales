import { ROLE_LABELS } from '@michio/shared';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { navFor } from '@/lib/nav';
import { requireUser } from '@/lib/session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <AppShell
      items={navFor(user.role)}
      user={{ fullName: user.fullName, roleLabel: ROLE_LABELS[user.role], status: user.status }}
    >
      {children}
    </AppShell>
  );
}

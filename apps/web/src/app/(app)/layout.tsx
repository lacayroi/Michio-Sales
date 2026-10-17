import { can } from '@michio/auth/permissions';
import { unreadConversationCount } from '@michio/core';
import { ROLE_LABELS } from '@michio/shared';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { navFor } from '@/lib/nav';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const unread = can(user.role, 'conversation.view') ? await unreadConversationCount(serviceContext(user)) : 0;
  return (
    <AppShell
      items={navFor(user.role)}
      user={{ fullName: user.fullName, roleLabel: ROLE_LABELS[user.role], status: user.status }}
      canCreateLead={can(user.role, 'lead.create')}
      isSales={user.role === 'SALES'}
      badges={{ '/hop-thu': unread }}
    >
      {children}
    </AppShell>
  );
}

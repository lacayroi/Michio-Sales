'use client';

import { Menu, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import type { NavItem } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { NavIcon } from './nav-icon';
import { NotificationBell } from './notification-bell';
import { QuickLeadButton } from './quick-lead';
import { UserMenu, type UserMenuProps } from './user-menu';

const GROUP_LABELS: Record<NavItem['group'], string | null> = { main: null, admin: 'Quản trị', account: null };

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = (['main', 'admin', 'account'] as const)
    .map((g) => ({ g, items: items.filter((i) => i.group === g) }))
    .filter((x) => x.items.length);
  return (
    <nav aria-label="Menu chính" className="flex flex-col gap-4">
      {groups.map(({ g, items: groupItems }) => (
        <div key={g} className="flex flex-col gap-0.5">
          {GROUP_LABELS[g] && (
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{GROUP_LABELS[g]}</p>
          )}
          {groupItems.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
              >
                <NavIcon name={item.icon} className="size-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AppShell({
  items,
  user,
  quickLead,
  children,
}: {
  items: NavItem[];
  user: UserMenuProps;
  /** null = no "+ Lead nhanh" (no lead.create permission) */
  quickLead: { isSales: boolean } | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="min-h-dvh">
      <div className="h-1 bg-header" aria-hidden />
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur">
        <button
          type="button"
          className="-ml-1 rounded-lg p-2 hover:bg-muted lg:hidden"
          aria-label={open ? 'Đóng menu' : 'Mở menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
        <Link href="/" className="flex items-center gap-2" aria-label="Michio Sales Hub — Trang chủ">
          <Image src="/brand/logo.png" alt="Michio" width={104} height={40} priority className="h-9 w-auto" />
          <span className="hidden text-sm font-semibold text-muted-foreground sm:inline">Sales Hub</span>
        </Link>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {quickLead && <QuickLeadButton isSales={quickLead.isSales} />}
          <NotificationBell />
          <UserMenu {...user} />
        </div>
      </header>

      <div className="flex">
        <aside className="sticky top-[60px] hidden h-[calc(100dvh-60px)] w-60 shrink-0 overflow-y-auto border-r border-border bg-surface p-3 lg:block">
          <NavList items={items} />
        </aside>

        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button type="button" aria-label="Đóng menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-surface p-3 shadow-xl">
              <NavList items={items} onNavigate={() => setOpen(false)} />
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
